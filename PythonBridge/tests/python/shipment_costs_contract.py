"""Shipment USD precision, ownership, ports and PCR snapshots. SQL fixtures roll back."""
import json
import unittest
from unittest.mock import patch
from pydantic import ValidationError
from fastapi import HTTPException
from container_profiles_contract import ProfileFixture
import mix_parent_logistics_contract as logistics
from shipment_fields import ShipmentCostInfo
from packaging_fields import consume, ItemFields
from opportunity_views import sorted_grid
from request_views import item_read
from container_loading import container_types
import ports_api

class ShipmentModels(unittest.TestCase):
    def test_precision_and_bounds(self):
        self.assertEqual(ShipmentCostInfo(FreightUSDPerContainer="12.30").model_dump(mode="json")["FreightUSDPerContainer"],"12.30")
        for field,value in (("FreightUSDPerContainer","1.234"),("FreightUSDPerContainer","-1"),("DutyPct","100.01"),("InterestMonths",1.5),("InterestMonths",True),("ContainerSizeFT","40RC"),("Incoterm","CIF"),("Currency","AUD")):
            with self.subTest(field=field),self.assertRaises(ValidationError):
                ShipmentCostInfo(**{field:value})
        self.assertEqual(ItemFields(ShipmentCostInfo={"DutyPct":"12.50"}).ShipmentCostInfo.DutyPct,12.5)
    def test_revised_units_and_margin_exclusivity(self):
        ShipmentCostInfo(FloorLoadUSDPerMT="100",ImportClearanceCustomerPerPallet="150",InterestDays=30,PaymentTermDays=60,MarginMode="USDPerLb",MarginUSDPerLb=".5")
        for payload in (dict(InterestDays=1.5),dict(PaymentTermDays=-1),dict(MarginMode="Percent",MarginUSDPerLb="1"),dict(MarginPct="10",MarginUSDPerLb="1"),dict(FloorLoadUSDPerMT="1.234")):
            with self.subTest(payload=payload),self.assertRaises(ValidationError):ShipmentCostInfo(**payload)
    def test_port_code_is_no_longer_an_input(self):
        with self.assertRaises(ValidationError):
            ports_api.PortSave(CustomerID=1,MarketID=1,PortName="Seattle",PortCode="SEA")
    def test_mapping(self):
        for family,size,expected in (("Dry","20FT",("20DC",)),("Dry","40FT",("40DC","40HC")),("Reefer","20FT",("20RC",)),("Reefer","40FT",("40RHC",))):
            self.assertEqual(container_types(family,size),expected)
        self.assertEqual(len(container_types("Both")),5)
    def test_port_rowversion_and_write_access(self):
        from auth import AccessContext
        payload=ports_api.PortSave(ID=1,RowVersion="bad",CustomerID=1,MarketID=1,PortName="Seattle")
        with patch.object(ports_api,"execute") as execute,self.assertRaises(HTTPException):
            ports_api.save(payload,AccessContext(1,"Admin",frozenset({"Admin"})))
        execute.assert_not_called()
        with self.assertRaises(HTTPException):
            ports_api.save(payload,AccessContext(2,"Sales",frozenset({"Opportunity"})))

    def test_fresh_port_and_market_choices_do_not_mutate_lookup_cache(self):
        import main
        cached={"customers":[{"ID":1,"CustomerName":"Northstar"}],"products":[],"mix_children":[],"currencies":[]}
        with patch.object(main,"cached",return_value=cached),patch.object(main,"run_read_query",return_value=[]),patch.object(main,"opportunity_shipment_lookups",return_value=([{"ID":1,"MarketID":5}], [{"ID":11,"CustomerID":1,"MarketID":5}])):
            result=main.opportunity_lookups_read("Admin",True,frozenset())
        self.assertEqual(result["customers"][0]["MarketID"],5)
        self.assertEqual(result["ports"][0]["ID"],11)
        self.assertNotIn("ports",cached)
        self.assertNotIn("MarketID",cached["customers"][0])

class ShipmentSQL(ProfileFixture,unittest.TestCase):
    batch=logistics.MixLogisticsSQL.batch
    activate=logistics.MixLogisticsSQL.activate
    create_mix=logistics.MixLogisticsSQL.create_mix
    edit=logistics.MixLogisticsSQL.edit
    request=logistics.MixLogisticsSQL.request
    def setUp(self):
        logistics.MixLogisticsSQL.setUp(self)
        for name in ("87_mix_packaging_type_orders.sql","88_mix_same_config.sql","89_opportunity_shipment_costs.sql","90_port_name_only.sql","102_shipment_cost_units.sql"):
            self.migrate(name)
        self.market=self.cur.execute("SELECT MarketID FROM dbo.Customer WHERE ID=?",self.customer).fetchval()
    def fields(self,item,**values):
        version=self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",item).fetchval()
        self.cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",self.username,item,version,json.dumps(values))
        return consume(self.cur)
    def port(self,**values):
        data=dict(CustomerID=self.customer,MarketID=self.market,PortName="Shipment test port",Status="Active")
        data.update(values)
        return ports_api.save(ports_api.PortSave(**data),self.ctx)["rows"][0]

    def test_revised_units_sql_roundtrip_and_rerun(self):
        values=dict(FloorLoadUSDPerMT="100",ImportClearanceCustomerPerPallet="150",InterestDays=30,PaymentTermDays=60,MarginMode="USDPerLb",MarginUSDPerLb=".5")
        self.fields(self.parent,ShipmentCostInfo=values)
        before=tuple(self.cur.execute("SELECT RowVersion,ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchone())
        self.migrate("102_shipment_cost_units.sql")
        after=tuple(self.cur.execute("SELECT RowVersion,ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchone())
        self.assertEqual(before,after)
        for payload in (dict(InterestDays="1.5"),dict(MarginMode="Percent",MarginUSDPerLb="1"),dict(MarginPct="1",MarginUSDPerLb="2")):
            with self.subTest(payload=payload),self.assertRaises(Exception):
                self.cur.execute("EXEC dbo.usp_OpportunityShipment_Validate ?,?",self.parent,json.dumps(payload))
                consume(self.cur)
    def test_name_only_ports_and_migration_rerun_preserve_records(self):
        first=self.port()
        second=self.port(PortName="Another shipment port")
        self.assertNotEqual(first["ID"],second["ID"])
        self.assertIsNone(self.cur.execute("SELECT PortCode FROM dbo.PortOfEntry WHERE ID=?",first["ID"]).fetchval())
        before=self.cur.execute("SELECT ID,RowVersion FROM dbo.PortOfEntry ORDER BY ID").fetchall()
        self.migrate("90_port_name_only.sql")
        after=self.cur.execute("SELECT ID,RowVersion FROM dbo.PortOfEntry ORDER BY ID").fetchall()
        self.assertEqual([tuple(r) for r in before],[tuple(r) for r in after])
        rows=ports_api.read(search="",page=1,page_size=500,ctx=self.ctx)["rows"]
        self.assertTrue(any(r["ID"]==first["ID"] for r in rows))
        self.assertTrue(all("PortCode" not in r for r in rows))
        self.assertTrue(all("PortCode" not in r for r in ports_api.opportunity_shipment_lookups(self.username)[1]))
        with self.assertRaises(HTTPException):
            self.port()

    def test_excel_processing_cost_edits_keep_hidden_fields_and_pcr(self):
        import opportunity_excel_api as excel
        self.fields(self.parent,ShipmentCostInfo={"FreightUSDPerContainer":"100.00","DutyPct":"7.00","ContainerSizeFT":"20FT"})
        request=self.request([self.parent,self.child])
        def row(changes,item=None):
            item=item or self.parent
            data=next(r for r in excel.document_rows(self.ctx,self.opp) if r["ItemID"]==item)
            return excel.Edit(row=5,number=self.number,opportunity_id=self.opp,item_id=item,
                header_version=data["HeaderRowVersion"],item_version=data["ItemRowVersion"],item_changes=changes)
        before=self.cur.execute("SELECT ID,RowVersion,ShipmentContainerSizeFT FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=? ORDER BY ID",request["header"]["ID"]).fetchall()
        result=excel.save(excel.Batch(rows=[row({"FreightUSDPerContainer":"250.50","ContainerSizeFT":"40FT"})]),self.ctx)
        self.assertEqual(result["results"][0]["status"],"OK",result)
        saved=json.loads(self.cur.execute("SELECT ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchval())
        self.assertEqual(saved["FreightUSDPerContainer"],"250.50")
        self.assertEqual(saved["DutyPct"],"7.00")
        after=self.cur.execute("SELECT ID,RowVersion,ShipmentContainerSizeFT FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=? ORDER BY ID",request["header"]["ID"]).fetchall()
        self.assertEqual([tuple(r) for r in before],[tuple(r) for r in after])
        for changes,item in (({"ContainerRequest":"Reefer"},self.parent),({"ConfigurationRequest":"Floor load"},self.parent),({"DutyPct":"2.00"},self.child)):
            result=excel.save(excel.Batch(rows=[row(changes,item)]),self.ctx)
            self.assertEqual(result["results"][0]["status"],"ERROR",result)

    def test_save_read_inheritance_audit_and_clear(self):
        port=self.port()
        info=dict(Incoterm="FOB",PortOfEntryID=port["ID"],ContainerSizeFT="40FT",FreightUSDPerContainer="1234.50",DutyPct="7.25",InterestMonths=2)
        result=self.batch(self.edit(self.parent,ProductID=self.mix,AnnualUnit=10,ShipmentCostInfo=info))
        self.assertEqual(result["item_results"][0]["Status"],"OK",result)
        rows=sorted_grid(self.username,1,25,"[]",opportunity_number=self.number)["rows"]
        root=next(r for r in rows if r["ItemID"]==self.parent)
        child=next(r for r in rows if r["ItemID"]==self.child)
        self.assertEqual(child["ShipmentCostInfo"],root["ShipmentCostInfo"])
        self.assertEqual(json.loads(root["ShipmentCostInfo"])["FreightUSDPerContainer"],"1234.50")
        self.assertIsNone(self.cur.execute("SELECT ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.child).fetchval())
        self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='ShipmentCostInfo'",self.parent).fetchval(),0)
        self.fields(self.parent,ShipmentCostInfo=None)
        self.assertIsNone(self.cur.execute("SELECT ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchval())
    def test_child_ownership_and_direct_validation(self):
        with self.assertRaisesRegex(Exception,"Mix parent"):self.fields(self.child,ShipmentCostInfo=None)
        for value in ('[]','{"DutyPct":-1}','{"DutyPct":101}','{"InterestMonths":1.5}','{"FreightUSDPerContainer":"1.234"}','{"Incoterm":"BAD"}','{"DutyPct":1,"DutyPct":2}','{"Unknown":1}'):
            with self.subTest(value=value),self.assertRaises(Exception):
                self.cur.execute("EXEC dbo.usp_OpportunityShipment_Validate ?,?",self.parent,value)
    def test_port_filter_block_and_concurrency(self):
        port=self.port()
        customers,choices=ports_api.opportunity_shipment_lookups(self.username)
        self.assertTrue(any(r["ID"]==self.customer and r["MarketID"]==self.market for r in customers))
        self.assertTrue(any(r["ID"]==port["ID"] for r in choices))
        self.fields(self.parent,ShipmentCostInfo={"PortOfEntryID":port["ID"]})
        update=self.port(ID=port["ID"],RowVersion=port["RowVersion"],Status="Block")
        self.assertNotEqual(update["RowVersion"],port["RowVersion"])
        self.assertFalse(any(r["ID"]==port["ID"] for r in ports_api.opportunity_shipment_lookups(self.username)[1]))
        self.fields(self.parent,ShipmentCostInfo={"PortOfEntryID":port["ID"],"DutyPct":"2.00"})
        with self.assertRaisesRegex(Exception,"Customer and Market"):
            self.fields(self.item,ShipmentCostInfo={"PortOfEntryID":port["ID"]})
        market=self.cur.execute("SELECT TOP(1) ID FROM dbo.Market WHERE ID<>?",self.market).fetchval()
        if market:
            other=self.port(MarketID=market)
            with self.assertRaisesRegex(Exception,"Customer and Market"):
                self.fields(self.parent,ShipmentCostInfo={"PortOfEntryID":other["ID"]})
        with self.assertRaises(HTTPException) as error:self.port(ID=port["ID"],RowVersion=port["RowVersion"])
        self.assertEqual(error.exception.status_code,409)
    def test_snapshot_mapping_immutable_and_rerun(self):
        self.fields(self.parent,ShipmentCostInfo={"ContainerSizeFT":"20FT"})
        request=self.request([self.child])
        row=item_read(self.username,request["header"]["ID"],1,25,None,None,"[]")["rows"][0]
        self.assertEqual((row["ShipmentContainerSizeFT"],row["ContainerRequest"],row["ConfigurationRequest"]),("20FT","Dry","Both"))
        self.req=request["items"][0]["ID"]
        self.cur.execute("UPDATE dbo.OpportunityItem SET ShipmentCostInfo=? WHERE ID=?",json.dumps({"ContainerSizeFT":"40FT"}),self.parent)
        self.assertEqual(self.cur.execute("SELECT ShipmentContainerSizeFT FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),"20FT")
        self.fields(self.parent,ShipmentCostInfo={"ContainerSizeFT":"40FT"})
        request=self.request([self.parent]);self.req=request["items"][0]["ID"]
        with self.assertRaisesRegex(Exception,"Shipment size"):self.direct({"SelectedContainerType":"20DC"})
        self.direct({"SelectedContainerType":"40HC"})
        before=[tuple(r) for r in self.cur.execute("SELECT ID,ShipmentContainerSizeFT,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")]
        for _ in range(2):self.migrate("89_opportunity_shipment_costs.sql")
        self.assertEqual(before,[tuple(r) for r in self.cur.execute("SELECT ID,ShipmentContainerSizeFT,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")])
        with self.assertRaisesRegex(Exception,"immutable"):
            self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ShipmentContainerSizeFT='20FT' WHERE ID=?",self.req)


    def test_processing_parent_can_update_only_shipment_and_keeps_pcr_snapshot(self):
        self.fields(self.parent,ShipmentCostInfo={"ContainerSizeFT":"20FT"})
        request=self.request([self.parent,self.child])
        before=[tuple(r) for r in self.cur.execute("SELECT ID,ContainerRequest,ConfigurationRequest,ShipmentContainerSizeFT,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=? ORDER BY ID",request["header"]["ID"])]
        protected=tuple(self.cur.execute("SELECT ProductID,AnnualUnit,ContainerRequest,ConfigurationRequest,PrimaryTypeID,SecondaryTypeID FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchone())
        result=self.batch(self.edit(self.parent,ShipmentCostInfo={"Incoterm":"FOB","ContainerSizeFT":"40FT","FreightUSDPerContainer":"1200.50","MarginPct":"15.00"}))
        self.assertEqual(result["item_results"][0]["Status"],"OK",result)
        self.assertEqual(protected,tuple(self.cur.execute("SELECT ProductID,AnnualUnit,ContainerRequest,ConfigurationRequest,PrimaryTypeID,SecondaryTypeID FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchone()))
        self.assertEqual(before,[tuple(r) for r in self.cur.execute("SELECT ID,ContainerRequest,ConfigurationRequest,ShipmentContainerSizeFT,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=? ORDER BY ID",request["header"]["ID"])])
        rows=sorted_grid(self.username,1,25,"[]",opportunity_number=self.number)["rows"]
        child=next(row for row in rows if row["ItemID"]==self.child)
        self.assertEqual(json.loads(child["ShipmentCostInfo"])["FreightUSDPerContainer"],"1200.50")
        # Changing either frozen request field remains forbidden.
        rejected=self.batch(self.edit(self.parent,ProductID=self.mix,AnnualUnit=10,ContainerRequest="Reefer"))
        self.assertEqual(rejected["item_results"][0]["Status"],"ERROR",rejected)

    def test_processing_regular_shipment_only_save_requires_current_version(self):
        result=self.batch(self.edit(self.item,ShipmentCostInfo={"DutyPct":"3.50"}))
        self.assertEqual(result["item_results"][0]["Status"],"OK",result)
        stale=self.edit(self.item,ShipmentCostInfo={"DutyPct":"4.00"})
        stale["RowVersion"]="AAAAAAAAAAA="
        result=self.batch(stale)
        self.assertEqual(result["item_results"][0]["Status"],"ERROR",result)
        self.assertIn("Concurrency",result["item_results"][0]["Message"])

    def test_child_cannot_override_shipment_while_processing(self):
        self.request([self.parent,self.child])
        result=self.batch(self.edit(self.child,ShipmentCostInfo={"MarginPct":"10.00"}))
        self.assertEqual(result["item_results"][0]["Status"],"ERROR",result)
        self.assertIn("Mix parent",result["item_results"][0]["Message"])


    def test_processing_shipment_save_with_header_matches_editor_payload(self):
        from db import bytes_to_b64
        from main import opportunity_batch
        from schemas import OpportunityBatchRequest
        self.request([self.parent])
        header=self.cur.execute("SELECT ID,RowVersion,OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose FROM dbo.Opportunity WHERE ID=?",self.opp).fetchone()
        body=OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command="U",ID=header.ID,RowVersion=bytes_to_b64(header.RowVersion),OpportunityNumber=header.OpportunityNumber,CustomerID=header.CustomerID,OpportunityDesc=header.OpportunityDesc,BidOpen=str(header.BidOpen),BidClose=str(header.BidClose),ExchangeRateVNDPerUSD="25000",ExchangeRateCustomerCurrencyPerUSD="1")],item_rows=[self.edit(self.parent,ShipmentCostInfo={"ContainerSizeFT":"40FT","FreightUSDPerContainer":"500.00"})])
        result=opportunity_batch(body,self.username,True,self.ctx.scopes)
        self.assertEqual(result["header_results"][0]["Status"],"OK",result)
        self.assertEqual(result["item_results"][0]["Status"],"OK",result)

    def test_processing_loading_request_remains_locked(self):
        with self.assertRaisesRegex(Exception,"locked"):
            self.fields(self.item,ConfigurationRequest="Floor load")

if __name__=="__main__":
    unittest.main()
