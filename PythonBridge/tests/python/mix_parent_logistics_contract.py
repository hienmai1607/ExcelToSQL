"""Mix ownership and request-time structure snapshots; all fixtures roll back."""
import json
import unittest
from unittest.mock import patch
from uuid import uuid4
from db import bytes_to_b64
from container_profiles_contract import ProfileFixture
import opportunity_mix_sql_contract as mix
from opportunity_views import sorted_grid
from request_views import item_read
from packaging_fields import consume
from pkg_pricing import Calculation
import pkg_pricing_api as pricing
from fastapi import HTTPException


class MixPricing(unittest.TestCase):
    def test_server_uses_item_parent_not_a_browser_shipping_override(self):
        payload=Calculation(PackagingOrder="Secondary",PackagingTypeID=1,LayerCount=2,
            components=[dict(PriceID=1,PriceRowVersion="AAAAAAAAAAE=",Quantity=1)])
        for parent,shipping in ((None,False),(42,False),(42,True)):
            with self.subTest(parent=parent,shipping=shipping),patch.object(pricing,"authorize"), \
             patch.object(pricing,"pricing_context",return_value={"Request":{"ConfirmedLayerCount":2,"ParentItemID":parent}}), \
             patch.object(pricing,"catalog",return_value=({"ID":1,"Shipping":shipping},{},[],[],[])), \
             patch.object(pricing,"parent_geometry",side_effect=RuntimeError("geometry reached")) as geometry:
                if parent is None:
                    with self.assertRaisesRegex(HTTPException,"Shipping type"):
                        pricing.calculate(None,type("Context",(),{"username":"Admin"})(),1,payload)
                    geometry.assert_not_called()
                else:
                    with self.assertRaisesRegex(RuntimeError,"geometry reached"):
                        pricing.calculate(None,type("Context",(),{"username":"Admin"})(),1,payload)
                    self.assertFalse(geometry.call_args.kwargs["final_layer"])


class MixLogisticsSQL(ProfileFixture, unittest.TestCase):
    batch=mix.OpportunityMixSQL.batch
    activate=mix.OpportunityMixSQL.activate
    create_mix=mix.OpportunityMixSQL.create_mix
    edit=mix.OpportunityMixSQL.edit
    request=mix.OpportunityMixSQL.request

    def setUp(self):
        ProfileFixture.setUp(self)
        for migration in ("73_packaging_type_shipping.sql","84_packaging_container_layers.sql",
                          "85_packaging_container_shipping_height.sql","86_mix_parent_logistics.sql"):
            self.migrate(migration)
        self.create_mix()
        self.cur.execute("UPDATE dbo.PackagingType SET Shipping=1 WHERE ID=?",self.types["Secondary"])
        self.nonshipping=self.cur.execute("""INSERT dbo.PackagingType
            (PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy)
            VALUES('Secondary',?,'Count',0,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            "MIX-JAR-"+uuid4().hex[:12],self.actor).fetchval()
        self.item=self.parent;self.save_fields(WebPackagingRequirements=True,ContainerRequest="Dry",
            ConfigurationRequest="Both",PalletSize=self.size,PalletStacking="Double",MaxPalletHeightMM=1900,
            PackagingLayerCount=2,PrimaryTypeID=self.types["Primary"],SecondaryTypeID=self.types["Secondary"],
            NumberOfPrimary=2)
        self.item=self.cur.execute("SELECT TOP(1) ID FROM dbo.OpportunityItem WHERE OpportunityID=? AND ParentItemID IS NULL AND ID<>? ORDER BY ID",self.opp,self.parent).fetchval()
        child=self.batch(self.edit(self.child,WebPackagingRequirements=True,PackagingLayerCount=2,
            PrimaryTypeID=self.types["Primary"],SecondaryTypeID=self.nonshipping,NumberOfPrimary=12))
        self.assertEqual(child["item_results"][0]["Status"],"OK",child)

    def test_child_inherits_parent_even_when_requested_alone_and_request_is_frozen(self):
        rows=sorted_grid(self.username,1,25,"[]",opportunity_number=self.number)["rows"]
        child=next(row for row in rows if row["ItemID"]==self.child)
        self.assertEqual((child["ContainerRequest"],child["ConfigurationRequest"],child["PalletSize"],
            child["PalletStacking"],child["MaxPalletHeightMM"]),("Dry","Both",self.size,"Double",1900))
        request=self.request([self.child]);req=request["items"][0]["ID"]
        row=item_read(self.username,request["header"]["ID"],1,25,None,None,"[]")["rows"][0]
        self.assertEqual((row["ContainerRequest"],row["ConfigurationRequest"],row["PalletSize"],
            row["MaxPalletHeightMM"]),("Dry","Both",self.size,1900))
        self.cur.execute("UPDATE dbo.OpportunityItem SET ContainerRequest='Reefer',MaxPalletHeightMM=1800 WHERE ID=?",self.parent)
        self.assertEqual(tuple(self.cur.execute("SELECT ContainerRequest,MaxPalletHeightMM FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchone()),("Dry",1900))

    def test_child_shipping_exception_applies_to_response_but_parent_still_requires_shipping(self):
        request=self.request([self.child]);req=request["items"][0]["ID"]
        name=self.cur.execute("SELECT PackagingType FROM dbo.PackagingType WHERE ID=?",self.nonshipping).fetchval()
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
        self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",
            self.username,req,version,json.dumps(dict(ResponseLayerCount=2,SecondPMType=name)))
        consume(self.cur)
        version=self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchval()
        with self.assertRaisesRegex(Exception,"Shipping type"): self.cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",self.username,self.parent,version,json.dumps(dict(WebPackagingRequirements=True,SecondaryTypeID=self.nonshipping)))

    def test_child_configuration_is_rejected_by_api(self):
        rejected=self.batch(self.edit(self.child,ConfigurationRequest="Floor load"))
        self.assertEqual(rejected["item_results"][0]["Status"],"ERROR",rejected)

    def test_child_response_api_saves_its_nonshipping_packaging(self):
        request=self.request([self.child]);self.req=request["items"][0]["ID"]
        name=self.cur.execute("SELECT PackagingType FROM dbo.PackagingType WHERE ID=?",self.nonshipping).fetchval()
        self.save(ResponseLayerCount=2,SecondPMType=name,UnitsPerCarton=12)
        self.assertEqual(self.cur.execute("SELECT SecondPMType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),name)

    def test_child_response_cannot_override_parent_palletization(self):
        request=self.request([self.child]);req=request["items"][0]["ID"]
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
        with self.assertRaisesRegex(Exception,"parent mix"):
            self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",
                self.username,req,version,json.dumps(dict(ResponseMaxPalletHeightMM=1200)))

    def test_child_configuration_is_rejected_by_direct_sql(self):
        version=self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.child).fetchval()
        with self.assertRaisesRegex(Exception,"parent mix"):
            self.cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",
                self.username,self.child,version,json.dumps(dict(ConfigurationRequest="Floor load")))

    def test_mix_structure_captures_quantity_and_child_grades_without_master_writes(self):
        request=self.request([self.parent]);req=request["items"][0]["ID"]
        row=item_read(self.username,request["header"]["ID"],1,25,None,None,"[]")["rows"][0]
        snapshot=json.loads(row["ProductMixSnapshot"])
        self.assertEqual(snapshot["MixVersionID"],self.mix_version)
        self.assertEqual(len(snapshot["items"]),1)
        self.assertEqual(snapshot["items"][0]["ProductID"],self.product)
        self.assertEqual(str(snapshot["items"][0]["UnitQuantity"]),"0.125")
        self.assertIn("items",snapshot["items"][0]["ProductGradeSnapshot"])
        self.cur.execute("UPDATE dbo.Product SET ProductName='Changed Master name' WHERE ID=?",self.product)
        reread=item_read(self.username,request["header"]["ID"],1,25,None,None,"[]")["rows"][0]
        self.assertEqual(reread["ProductMixSnapshot"],row["ProductMixSnapshot"])
        with self.assertRaisesRegex(Exception,"immutable"):
            self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ProductMixSnapshot=N'{}' WHERE ID=?",req)

    def test_migration_rerun_keeps_existing_rows_and_versions(self):
        before=list(self.cur.execute("SELECT ID,ProductMixSnapshot,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID"))
        for _ in range(2):self.migrate("86_mix_parent_logistics.sql")
        self.assertEqual(before,list(self.cur.execute("SELECT ID,ProductMixSnapshot,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")))


if __name__=="__main__":
    unittest.main()
