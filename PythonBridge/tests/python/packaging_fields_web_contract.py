"""Real SQL/API field saves, all schema and fixtures rolled back."""
import json
import re
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from packaging_field_foundation_contract import PackagingFoundation, ROOT
sys.path.insert(0,str(ROOT/"core"))
import main
import packaging_fields
import packaging_api
from schemas import ProductBatchRequest,OpportunityBatchRequest
from auth import AccessContext

class WebFields(PackagingFoundation):
    def setUp(self):
        super().setUp()
        sql=(ROOT/"sql/23_packaging_field_writes.sql").read_text(encoding="utf-8")
        for batch in re.split(r"^GO\s*$",sql,flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                while self.cur.nextset():pass
        @contextmanager
        def cursor():
            yield self.cur
        self.mock=patch.object(packaging_fields,"get_raw_cursor",cursor)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        read_mock=patch.object(packaging_api,"get_raw_cursor",cursor)
        read_mock.start()
        self.addCleanup(read_mock.stop)

    def test_product_create_roundtrip(self):
        code="P-"+uuid4().hex[:16]
        result=main.product_batch(ProductBatchRequest(rows=[dict(RowNum=1,Command="C",ProductCode=code,
            ProductName="Fields "+code,WeightValue=100,WeightUnit="g",Category="Nuts",Grade="A",MixRatioPct="25.50")]),
            self.username,True,frozenset())
        self.assertEqual(result["results"][0]["Status"],"OK",result)
        row=self.cur.execute("SELECT Category,Grade,MixRatioPct FROM dbo.Product WHERE ProductCode=?",code).fetchone()
        self.assertEqual(tuple(map(str,row)),("Nuts","A","25.50"))

    def test_category_required_and_insert_rolled_back(self):
        code="P-"+uuid4().hex[:16]
        result=main.product_batch(ProductBatchRequest(rows=[dict(RowNum=1,Command="C",ProductCode=code,
            ProductName="Fields "+code,WeightValue=100,WeightUnit="g")]),self.username,True,frozenset())
        self.assertEqual(result["results"][0]["Status"],"ERROR")
        self.assertIn("Category",result["results"][0]["Message"])
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.Product WHERE ProductCode=?",code).fetchval(),0)

    def test_opportunity_extended_save_and_version(self):
        from db import bytes_to_b64
        header=self.cur.execute("SELECT OpportunityNumber,RowVersion FROM dbo.Opportunity WHERE ID=?",self.opp).fetchone()
        version=self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
        body=OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command="U",ID=self.opp,OpportunityNumber=header[0],
            CustomerID=self.customer,OpportunityDesc="Web fields",BidOpen="2026-09-01",BidClose="2026-10-01",
            RowVersion=bytes_to_b64(header[1]),CurrencyID=currency,ExchangeRateToVND="1")],
            item_rows=[dict(RowNum=2,Command="U",ID=self.item,OpportunityNumber=header[0],ProductID=self.product,
            ItemDescription="New details",AnnualUnit=101,RowVersion=bytes_to_b64(version),
            PackagingType='Pouch "premium"',MaxPalletHeightM="1.250",ShelfLifeDays=365,RecycledContent="30%")])
        result=main.opportunity_batch(body,self.username,True,frozenset())
        self.assertEqual(result["header_results"][0]["Status"],"OK",result)
        self.assertEqual(result["item_results"][0]["Status"],"OK",result)
        values=self.cur.execute("SELECT PackagingType,MaxPalletHeightM,ShelfLifeDays,RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()
        self.assertEqual(values[0],'Pouch "premium"')
        self.assertEqual(str(values[1]),"1.250")
        self.assertEqual(values[2],365)
        self.assertEqual(bytes_to_b64(values[3]),result["item_results"][0]["NewRowVersion"])
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='PackagingType' AND ChangedBy=? AND Source='User'",self.item,self.username).fetchval(),1)

    def test_locked_item_api_returns_error_without_partial_header_save(self):
        from db import bytes_to_b64
        self.request()
        h=self.cur.execute("SELECT OpportunityNumber,RowVersion FROM dbo.Opportunity WHERE ID=?",self.opp).fetchone()
        rv=self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval()
        payload=OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command="U",ID=self.opp,OpportunityNumber=h[0],CustomerID=self.customer,OpportunityDesc="Must rollback",BidOpen="2026-09-01",BidClose="2026-10-01",RowVersion=bytes_to_b64(h[1]))],
            item_rows=[dict(RowNum=2,Command="U",ID=self.item,OpportunityNumber=h[0],ProductID=self.product,ItemDescription="Changed",AnnualUnit=300,RowVersion=bytes_to_b64(rv),PackagingType="Pouch")])
        result=main.opportunity_batch(payload,self.username,True,frozenset())
        self.assertEqual(result["item_results"][0]["Status"],"ERROR",result)
        self.assertEqual(result["header_results"][0]["Status"],"ERROR",result)

    def test_response_fields_save_and_submit(self):
        from db import bytes_to_b64
        req=self.request()
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
        body=packaging_api.ResponseBatch(rows=[dict(RowNum=1,ID=req,RowVersion=bytes_to_b64(version),
            FirstPMType="Film",SecondPMType="Carton",UnitsPerCarton=12,PackagingDescription="Test pack",
            FirstPMMOQ=0,SecondPMMOQ=50,LayersPerPallet=4)])
        ctx=AccessContext(username=self.username,user_id=self.actor,scopes=frozenset({"Admin"}))
        result=packaging_api.response_save(body,ctx)
        self.assertEqual(result["results"][0]["Status"],"OK")
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
        self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,'Pending Review',NULL",self.username,req,version)
        rows=packaging_fields.consume(self.cur)
        self.assertEqual(rows[0][0]["Stage"],"Pending Review")

    def test_enriched_grid_reads_and_request_response_source(self):
        from opportunity_views import sorted_grid
        from request_views import item_read
        req=self.request()
        # Direct fixture insertion represents a legacy request; snapshot it before reading.
        for batch in re.split(r"^GO\s*$",(ROOT/"sql/25_packaging_request_snapshots.sql").read_text(encoding="utf-8"),flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                while self.cur.nextset(): pass
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMType='Film' WHERE ID=?",req)
        opportunity=sorted_grid(self.username,1,500,"[]",opportunity_number=self.cur.execute("SELECT OpportunityNumber FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval())
        self.assertEqual(len(opportunity["rows"]),1)
        self.assertEqual(opportunity["rows"][0]["FirstPMType"],"Film")
        product=self.cur.execute("SELECT ProductName,WeightGrams FROM dbo.Product WHERE ID=?",self.product).fetchone()
        self.assertEqual(opportunity["rows"][0]["ProductName"],product[0])
        self.assertEqual(opportunity["rows"][0]["WeightGrams"],product[1])
        request_id=self.cur.execute("SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
        request=item_read(self.username,request_id,1,200,None,None,"[]")
        self.assertEqual(request["rows"][0]["FirstPMType"],"Film")
        self.assertEqual(request["rows"][0]["ProductName"],product[0])
        self.assertEqual(request["rows"][0]["WeightGrams"],product[1])
        self.assertIn("PackagingType",request["rows"][0])
        self.assertIn("CurrencyID",request["rows"][0])

    def test_new_request_requires_packaging_type(self):
        import pyodbc
        with self.assertRaisesRegex(pyodbc.Error,"52962"):
            self.cur.execute("""
                DECLARE @Items dbo.PackagingRequestSelectionType;
                INSERT @Items SELECT ID,RowVersion,NULL FROM dbo.OpportunityItem WHERE ID=?;
                DECLARE @RV VARBINARY(8)=(SELECT RowVersion FROM dbo.Opportunity WHERE ID=?),
                        @Key UNIQUEIDENTIFIER=NEWID(),@Due DATE=DATEADD(DAY,10,GETUTCDATE());
                EXEC dbo.usp_PackagingRequest_Create ?,?,@RV,@Key,@Due,@Items,NULL;
            """,self.item,self.opp,self.username,self.opp)

    def test_currency_lookup_scope(self):
        self.cur.execute("EXEC dbo.usp_OpportunityCurrencyLookup_Read ?",self.username)
        self.assertTrue(self.cur.fetchall())

if __name__=="__main__":unittest.main()
