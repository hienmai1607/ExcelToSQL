"""Mix parent layer orders are independent of Secondary/Tertiary master orders."""
import json
import unittest
from decimal import Decimal
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4
from fastapi import HTTPException
from db import bytes_to_b64
from pkg_pricing import Calculation
import packaging_api as batches
import pkg_pricing_api as pricing
import mix_parent_logistics_contract as foundation
from container_profiles_contract import ProfileFixture


class MixTypesSQL(ProfileFixture, unittest.TestCase):
    batch=foundation.MixLogisticsSQL.batch
    activate=foundation.MixLogisticsSQL.activate
    create_mix=foundation.MixLogisticsSQL.create_mix
    edit=foundation.MixLogisticsSQL.edit
    request=foundation.MixLogisticsSQL.request

    def setUp(self):
        foundation.MixLogisticsSQL.setUp(self)
        self.migrate("87_mix_packaging_type_orders.sql")
        self.tertiary=self.new_type("Tertiary",True)
        self.primary_only=self.new_type("Primary",False)
        self.cur.execute("INSERT dbo.PackagingTypeOrder VALUES(?,'Primary')",self.nonshipping)
        @contextmanager
        def cursor():
            fresh=self.conn.cursor()
            try:yield fresh
            finally:fresh.close()
        mocked=patch.object(pricing,"get_raw_cursor",cursor);mocked.start();self.addCleanup(mocked.stop)

    def new_type(self,order,shipping):
        return self.cur.execute("""INSERT dbo.PackagingType
            (PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy,Shipping)
            VALUES(?,?,'Count',0,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            order,"MIX-ORDER-"+uuid4().hex[:12],self.actor,shipping).fetchval()

    def parent_layers(self):
        self.item=self.parent
        self.save_fields(WebPackagingRequirements=True,PackagingLayerCount=3,
            PrimaryTypeID=self.types["Secondary"],SecondaryTypeID=self.tertiary,
            TertiaryTypeID=self.types["Secondary"],NumberOfPrimary=2,NumberOfSecondary=3)

    def test_parent_request_and_response_accept_secondary_and_tertiary_in_any_layer(self):
        self.parent_layers()
        created=self.request([self.parent]);self.req=created["items"][0]["ID"]
        names={id:self.cur.execute("SELECT PackagingType FROM dbo.PackagingType WHERE ID=?",id).fetchval()
            for id in (self.types["Secondary"],self.tertiary,self.nonshipping)}
        self.save(ResponseLayerCount=3,FirstPMType=names[self.tertiary],
            SecondPMType=names[self.nonshipping],ThirdPMType=names[self.types["Secondary"]])
        self.assertEqual(tuple(self.cur.execute("SELECT FirstPMType,SecondPMType,ThirdPMType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchone()),
            (names[self.tertiary],names[self.nonshipping],names[self.types["Secondary"]]))

    def test_parent_primary_only_type_is_rejected_by_request_save(self):
        self.item=self.parent
        with self.assertRaisesRegex(Exception,"Secondary/Tertiary"):
            self.save_fields(WebPackagingRequirements=True,PrimaryTypeID=self.primary_only)

    def test_parent_primary_only_type_is_rejected_by_response_save(self):
        created=self.request([self.parent]);req=created["items"][0]["ID"]
        name=self.cur.execute("SELECT PackagingType FROM dbo.PackagingType WHERE ID=?",self.primary_only).fetchval()
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
        with self.assertRaisesRegex(Exception,"Secondary/Tertiary"):
            self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",
                self.username,req,version,json.dumps(dict(FirstPMType=name)))

    def test_nonshipping_final_parent_type_is_still_rejected(self):
        self.item=self.parent
        with self.assertRaisesRegex(Exception,"Shipping type"):
            self.save_fields(WebPackagingRequirements=True,PackagingLayerCount=3,TertiaryTypeID=self.nonshipping)

    def test_order_policy_preserves_children_normal_products_and_multi_order_types(self):
        self.assertEqual(self.cur.execute("SELECT dbo.fn_OpportunityIsMixParent(?)",self.parent).fetchval(),True)
        self.assertEqual(self.cur.execute("SELECT dbo.fn_OpportunityIsMixParent(?)",self.child).fetchval(),False)
        for order in ("Primary","Secondary","Tertiary"):
            for type_id in (self.types["Secondary"],self.tertiary,self.nonshipping):
                self.assertEqual(pricing.catalog(self.cur,type_id,order,mix_parent=True)[0]["ID"],type_id)
            with self.assertRaises(HTTPException):pricing.catalog(self.cur,self.primary_only,order,mix_parent=True)
        with self.assertRaises(HTTPException):pricing.catalog(self.cur,self.types["Secondary"],"Primary")
        with self.assertRaises(HTTPException):pricing.catalog(self.cur,self.tertiary,"Secondary")
        self.assertEqual(pricing.catalog(self.cur,self.primary_only,"Primary")[0]["ID"],self.primary_only)

    def test_cross_order_pricing_options_preview_reference_and_atomic_save(self):
        self.parent_layers()
        created=self.request([self.parent]);self.req=created["items"][0]["ID"]
        root=self.types["Secondary"]
        component=self.cur.execute("""INSERT dbo.PackagingType
            (PackagingOrder,PackagingType,ParentTypeID,PriceBasis,TareWeight,CreatedBy)
            VALUES('Secondary',?,?,'Count',0,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            "MIX-COMP-"+uuid4().hex[:12],root,self.actor).fetchval()
        material=self.cur.execute("""INSERT dbo.PackagingMaterial
            (MaterialCode,MaterialName,UnitOfMeasure,PackagingTypeID,CreatedBy)
            VALUES(?,'Mix carton component','EA',?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            "MIX-PKG-"+uuid4().hex[:12],component,self.actor).fetchval()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
        price=self.cur.execute("""INSERT dbo.PackagingPrice
            (MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy,ExchangeRateToUSD)
            VALUES(?,?,'EA',1000,1000,'2020-01-01',?,25000);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            material,currency,self.actor).fetchval()
        payload=Calculation(PackagingOrder="Primary",PackagingTypeID=root,LayerCount=3,
            components=[dict(PriceID=price,PriceRowVersion=bytes_to_b64(self.cur.execute(
                "SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=?",price).fetchval()),Quantity=2)])
        options=pricing.options(self.req,root,"Primary",self.ctx)
        self.assertTrue(options["isMixParent"]);self.assertFalse(options["isMixChild"])
        result=pricing.preview(self.req,payload,self.ctx)["calculation"]
        self.assertEqual(Decimal(result["UnitPrice"]),Decimal(2000))
        self.assertIsNone(result["FinalLayerHeightMM"])
        self.assertIsInstance(pricing.references(self.req,root,"Primary",self.ctx)["references"],list)
        version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        saved=batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,
            RowVersion=version,FirstPMType=result["PackagingTypeName"],
            PricingCalculations=[payload.model_copy(update={"Fingerprint":result["Fingerprint"]})])]),self.ctx)
        self.assertEqual(saved["results"][0]["Status"],"OK")
        record=self.cur.execute("SELECT ID,PackagingOrder,PackagingTypeID FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1",self.req).fetchone()
        self.assertEqual((record[1],record[2]),("Primary",root))
        reference=pricing.reference(self.req,record[0],root,"Primary",self.ctx)
        self.assertEqual(reference["input"]["PackagingTypeID"],root)
        # A Secondary master type also works as the final Tertiary mix layer.
        final=payload.model_copy(update={"PackagingOrder":"Tertiary"})
        with self.assertRaisesRegex(HTTPException,"D3 Height"):
            pricing.preview(self.req,final,self.ctx)
        mm=self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode='mm'").fetchval()
        dimension=self.cur.execute("""INSERT dbo.PackagingDimension
            (PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,CreatedBy)
            VALUES(?,'Length','Width','Height',?,?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            root,mm,mm,mm,self.actor).fetchval()
        final=final.model_copy(update={"DimensionID":dimension,"D3":Decimal(140),
            "DimensionRowVersion":bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?",dimension).fetchval())})
        final_result=pricing.preview(self.req,final,self.ctx)["calculation"]
        self.assertEqual(Decimal(final_result["FinalLayerHeightMM"]),Decimal(140))
        version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        saved=batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,
            RowVersion=version,ThirdPMType=final_result["PackagingTypeName"],
            PricingCalculations=[final.model_copy(update={"Fingerprint":final_result["Fingerprint"]})])]),self.ctx)
        self.assertEqual(saved["results"][0]["Status"],"OK")
        self.assertEqual(self.cur.execute("SELECT HeightMM FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),140)

    def test_migration_rerun_preserves_existing_rows_and_versions(self):
        before=list(self.cur.execute("SELECT ID,ProductMixSnapshot,FirstPMType,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID"))
        self.migrate("87_mix_packaging_type_orders.sql");self.migrate("87_mix_packaging_type_orders.sql")
        self.assertEqual(before,list(self.cur.execute("SELECT ID,ProductMixSnapshot,FirstPMType,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")))


if __name__=="__main__":unittest.main()
