"""Snapshot migration and request creation tests; local test database, rollback only."""
import re
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from packaging_field_foundation_contract import PackagingFoundation, ROOT
import sys
sys.path.insert(0,str(ROOT/"core"))
import packaging_api
from request_views import item_read

class Snapshots(unittest.TestCase):
    setup_base=PackagingFoundation.setUp
    cleanup=PackagingFoundation.cleanup
    request=PackagingFoundation.request
    def drain(self):
        while self.cur.nextset(): pass
    def migrate(self):
        for batch in re.split(r"^GO\s*$",(ROOT/"sql/25_packaging_request_snapshots.sql").read_text(encoding="utf-8"),flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                self.drain()
    def setUp(self):
        self.setup_base()
        self.cur.execute("UPDATE dbo.OpportunityItem SET PackagingType='Pouch',ShelfLifeDays=365 WHERE ID=?",self.item)
        self.olditem=self.request()
        self.req=self.cur.execute("SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.olditem).fetchval()
        self.migrate()

    def test_migration_marker_and_repeatability(self):
        row=self.cur.execute("SELECT SnapshotOrigin,PackagingType,ShelfLifeDays,SnapshotCapturedAt FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.olditem).fetchone()
        self.assertEqual(tuple(row)[:3],("Migration","Pouch",365))
        self.migrate()
        self.assertEqual(self.cur.execute("SELECT SnapshotCapturedAt FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.olditem).fetchval(),row[3])

    def test_source_edits_do_not_change_request_or_sorted_read(self):
        before=self.cur.execute("SELECT ProductName,WeightGrams,PackagingType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.olditem).fetchone()
        self.cur.execute("UPDATE dbo.Product SET ProductName=ProductName+' revised',WeightGrams=WeightGrams+1 WHERE ID=?",self.product)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE ID=?",self.olditem)
        self.cur.execute("UPDATE dbo.OpportunityItem SET PackagingType='Bottle' WHERE ID=?",self.item)
        @contextmanager
        def cursor(): yield self.cur
        with patch.object(packaging_api,"get_raw_cursor",cursor):
            data=item_read(self.username,self.req,1,200,None,None,'[]')
        row=data["rows"][0]
        self.assertEqual((row["ProductName"],row["WeightGrams"],row["PackagingType"]),tuple(before))
        self.assertEqual(row["SnapshotOrigin"],"Migration")

    def test_snapshot_change_rejected(self):
        import pyodbc
        with self.assertRaisesRegex(pyodbc.Error,"52981"):
            self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PackagingType='Changed' WHERE ID=?",self.olditem)

    def test_response_save_allowed(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMType='Film',ResponseNotes='Answer' WHERE ID=?",self.olditem)
        self.assertEqual(self.cur.execute("SELECT FirstPMType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.olditem).fetchval(),"Film")

    def test_create_captures_new_values_with_actor_and_currency(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE ID=?",self.olditem)
        self.cur.execute("UPDATE dbo.OpportunityItem SET PackagingType='Bottle',ShelfLifeDays=200 WHERE ID=?",self.item)
        self.cur.execute("UPDATE dbo.Opportunity SET CurrencyID=(SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'),ExchangeRateToVND=1 WHERE ID=?",self.opp)
        self.cur.execute("""
          DECLARE @Rows dbo.PackagingRequestSelectionType,@Version VARBINARY(8),@Key UNIQUEIDENTIFIER=NEWID(),@Due DATE=DATEADD(DAY,7,SYSUTCDATETIME());
          INSERT @Rows SELECT ID,RowVersion,'Special request' FROM dbo.OpportunityItem WHERE ID=?;
          SELECT @Version=RowVersion FROM dbo.Opportunity WHERE ID=?;
          EXEC dbo.usp_PackagingRequest_Create @Username=?,@OpportunityID=?,@ExpectedRowVersion=@Version,@CreationKey=@Key,@ResponseDue=@Due,@Items=@Rows;
        """,self.item,self.opp,self.username,self.opp)
        header=self.cur.fetchone()
        self.drain()
        row=self.cur.execute("SELECT SnapshotOrigin,PackagingType,ShelfLifeDays,WeightGrams,SourceProductRowVersion FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=?",header.ID).fetchone()
        self.assertEqual(tuple(row)[:3],("Request","Bottle",200))
        self.assertIsNotNone(row[3])
        self.assertEqual(len(row[4]),8)
        hdr=self.cur.execute("SELECT SourceCurrencyCode,SourceExchangeRateToVND,SnapshotOrigin FROM dbo.PackagingConfigurationRequest WHERE ID=?",header.ID).fetchone()
        self.assertEqual(tuple(map(str,hdr)),("VND","1.000000","Request"))
        self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE RequestID=? AND FieldName='PackagingType' AND ChangedBy=? AND Source='User'",header.ID,self.username).fetchval(),0)
        self.cur.execute("EXEC dbo.usp_PackagingRequest_Grid_Read @Username=?,@RequestID=?",self.username,header.ID)
        excel=self.cur.fetchone()
        self.assertEqual(excel.PackagingType,"Bottle")
        self.assertEqual(excel.SnapshotOrigin,"Request")
        self.drain()

if __name__=="__main__": unittest.main()
