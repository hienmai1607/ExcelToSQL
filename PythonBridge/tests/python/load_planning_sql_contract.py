"""Local test database only. Schema and business fixtures always roll back."""
import json
from decimal import Decimal
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from types import SimpleNamespace
from fastapi import HTTPException
import packaging_field_foundation_contract as foundation
from auth import AccessContext
from db import bytes_to_b64
import load_planning_api as api
from response_load_plan import apply_plan
import load_planning_contract as calculation_tests

class LoadPlanningSQL(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    request=foundation.PackagingFoundation.request
    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        for filename in ("108_container_load_plans.sql","109_pallet_packaging_order.sql","110_migrate_pallet_materials.sql","111_response_load_plan.sql","116_response_container_plans.sql"):
            self.cur.execute((foundation.ROOT/"sql"/filename).read_text(encoding="utf-8"))
            while self.cur.nextset():pass
        self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
        self.req=self.request()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=?,ConfigurationRequest='Pallet load',LengthMM=400,WidthMM=300,HeightMM=200 WHERE ID=?",self.actor,self.req)

        # Saved response sources required by item-scoped planning (no manual overrides).
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET WeightGrams=100,ResponseLayerCount=1,FirstPMType='Loading fixture',FirstPMMOQ=1,CartonsPerLayer=8,ResponseMaxPalletHeightMM=1140,ResponsePalletStacking='Single',ResponsePalletSize='1200x800mm' WHERE ID=?",self.req)
        kind=self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,FinalComponent,CreatedBy) VALUES('Primary','Loading fixture','Count',0,1,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.actor).fetchval()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
        self.cur.execute("""INSERT dbo.PkgPricingMaster(RequestItemID,PackagingOrder,PackagingTypeID,PackagingTypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,Fingerprint,InputJSON,SnapshotJSON,CreatedBy)
            VALUES(?,'Primary',?,'Loading fixture',CONVERT(DATE,SYSUTCDATETIME()),1,1,?,'USD',REPLICATE('a',64),'{}',?,?)""",self.req,kind,currency,json.dumps({'Tare':{'KG':'9.9'}}),self.actor)
        assembly=dict(PalletSize='1200x800mm',Dimensions=dict(length='1200',width='800',height='140'),TareKG='20',UnitPrice='15',UnitUSDPrice='15',CurrencyCode='USD',components=[])
        pallet=self.cur.execute("INSERT dbo.PalletPricingSnapshot(ItemID,SnapshotJSON,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?)",self.req,json.dumps(assembly),self.actor).fetchval()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PalletPricingID=? WHERE ID=?",pallet,self.req)
        self.version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        @contextmanager
        def cursor():yield self.cur
        import packaging_api,packaging_fields
        for module in (api,packaging_api,packaging_fields):
            mock=patch.object(module,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
        mock=patch.object(api,"api_cursor",cursor);mock.start();self.addCleanup(mock.stop)
        self.record=api.ContainerRecord(Code="TESTLOAD",Family="Dry",SizeFT=20,Specifications=dict(length=5900,width=2350,height=2390,payload_kg=28000))
        self.cid=api.save_container(self.record,self.ctx)["ID"]
        self.crv=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.ContainerTypeMaster WHERE ID=?",self.cid).fetchval())
    def payload(self):
        return api.SavePlan(ContainerID=self.cid,ContainerRowVersion=self.crv,ItemRowVersion=self.version,Inputs=calculation_tests.LoadingTests().inputs())
    def test_save_and_apply_snapshot(self):
        result=api.save(self.req,self.payload(),self.ctx)
        self.assertEqual(result["Result"]["loaded_units"],11)
        new=apply_plan(self.cur,SimpleNamespace(ID=self.req,LoadPlanID=result["ID"],model_fields_set={"LoadPlanID"}),self.actor)
        self.assertNotEqual(bytes_to_b64(new),self.version)
        self.assertEqual(self.cur.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),result["ID"])
        self.cur.execute("UPDATE dbo.ContainerTypeMaster SET Specifications=JSON_MODIFY(Specifications,'$.length',12000) WHERE ID=?",self.cid)
        saved=json.loads(self.cur.execute("SELECT Inputs FROM dbo.ContainerLoadPlan WHERE ID=?",result["ID"]).fetchval())
        self.assertEqual(float(saved["container"]["length"]),5900)
    def test_response_save_and_read_use_selected_plan(self):
        import packaging_api
        from request_views import item_read
        from opportunity_views import sorted_grid
        result=api.save(self.req,self.payload(),self.ctx)
        payload=packaging_api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=self.version,LoadPlanID=result["ID"])])
        response=packaging_api.response_save(payload,self.ctx)
        self.assertEqual(response["results"][0]["Status"],"OK")
        header=self.cur.execute("SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()
        row=item_read(self.username,header,1,25,None,None,"[]")["rows"][0]
        self.assertEqual(row["CalculatedCartonsPerContainer"],"440")
        self.assertEqual(json.loads(row["LoadPlanJSON"])["ID"],result["ID"])
        summary=json.loads(row["LoadPlanJSON"])["Result"]
        self.assertNotIn("pallet_layer",summary)
        self.assertNotIn("container_layer",summary)
        self.assertEqual(summary["cartons_per_layer"],8)
        number=self.cur.execute("SELECT OpportunityNumber FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval()
        opp=sorted_grid(self.username,1,25,"[]",opportunity_number=number)["rows"][0]
        self.assertEqual(opp["CalculatedCartonsPerContainer"],"440")

    def test_explicit_response_count_persists_in_saved_plan(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET CartonsPerLayer=5 WHERE ID=?",self.req)
        self.version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        payload=self.payload()
        payload=payload.model_copy(update={"Inputs":payload.Inputs.model_copy(update={"cartons_per_layer":1,"carton_kg":Decimal(".001"),"max_pallet_height":Decimal(20000),"double_stack":True,"stackable":True})})
        result=api.save(self.req,payload,self.ctx)
        self.assertEqual(result["Inputs"]["cartons_per_layer"],5)
        self.assertEqual(Decimal(result["Inputs"]["carton_kg"]),Decimal(10))
        self.assertEqual(Decimal(result["Inputs"]["max_pallet_height"]),Decimal(1140))
        self.assertFalse(result["Inputs"]["double_stack"])
        self.assertEqual(result["Result"]["cartons_per_layer"],5)
        self.assertEqual(result["Result"]["cartons_per_pallet"],25)
        snapshot=json.loads(self.cur.execute("SELECT Inputs FROM dbo.ContainerLoadPlan WHERE ID=?",result["ID"]).fetchval())
        self.assertEqual(snapshot["cartons_per_layer"],5)
        history=api.history(self.req,self.ctx)
        self.assertEqual(history["rows"][0]["Inputs"]["cartons_per_layer"],5)

    def test_stale_container_and_response_rejected(self):
        payload=self.payload().model_copy(update={"ContainerRowVersion":"AAAAAAAAAAA="})
        with self.assertRaises(HTTPException) as error:api.preview(self.req,payload,self.ctx)
        self.assertEqual(error.exception.status_code,409)
        payload=self.payload().model_copy(update={"ItemRowVersion":"AAAAAAAAAAA="})
        with self.assertRaises(Exception):api.save(self.req,payload,self.ctx)
    def test_cannot_apply_other_items_plan(self):
        result=api.save(self.req,self.payload(),self.ctx)
        with self.assertRaises(HTTPException):apply_plan(self.cur,SimpleNamespace(ID=-1,LoadPlanID=result["ID"],model_fields_set={"LoadPlanID"}),self.actor)
    def test_admin_can_save_without_assignment(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=NULL WHERE ID=?",self.req)
        self.version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        self.assertGreater(api.save(self.req,self.payload(),self.ctx)["ID"],0)
    def test_pallet_order_and_repeatable_migration(self):
        for _ in range(2):
            self.cur.execute((foundation.ROOT/"sql/109_pallet_packaging_order.sql").read_text())
            while self.cur.nextset():pass
            self.cur.execute((foundation.ROOT/"sql/110_migrate_pallet_materials.sql").read_text())
            while self.cur.nextset():pass
        self.cur.execute("EXEC dbo.usp_PackagingType_Batch ?,?",json.dumps([dict(RowNum=1,Command="C",PackagingType="Test Load Pallet",PackagingOrders=["Pallet"],FinalComponent=True,CopyDim=True)]),self.username)
        columns=[c[0] for c in self.cur.description];result=dict(zip(columns,self.cur.fetchone()))
        while self.cur.nextset():pass
        self.assertEqual(result["Status"],"OK",result)
        self.assertEqual(self.cur.execute("SELECT PackagingOrder FROM dbo.PackagingType WHERE ID=?",result["NewID"]).fetchval(),"Pallet")
    def test_display_role_cannot_write_container(self):
        ctx=AccessContext(self.actor,self.username,frozenset({"Packaging"}),{"containers":"display"})
        with self.assertRaises(HTTPException) as error:api.save_container(self.record,ctx)
        self.assertEqual(error.exception.status_code,403)


    def test_preview_follows_requirement_and_does_not_save(self):
        before=self.cur.execute("SELECT COUNT(*) FROM dbo.ContainerLoadPlan WHERE ItemID=?",self.req).fetchval()
        version=bytes(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        body=self.payload()
        self.assertEqual(api.preview(self.req,body,self.ctx)["Inputs"]["mode"],"pallet")
        body.Inputs=body.Inputs.model_copy(update={"mode":"floor"})
        with self.assertRaises(HTTPException) as error:api.preview(self.req,body,self.ctx)
        self.assertEqual(error.exception.status_code,422)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ContainerLoadPlan WHERE ItemID=?",self.req).fetchval(),before)
        self.assertEqual(bytes(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()),version)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ConfigurationRequest='Floor load' WHERE ID=?",self.req)
        self.assertEqual(api.preview(self.req,body,self.ctx)["Inputs"]["mode"],"floor")
        body.Inputs=body.Inputs.model_copy(update={"mode":"pallet"})
        with self.assertRaises(HTTPException):api.preview(self.req,body,self.ctx)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ConfigurationRequest='Both' WHERE ID=?",self.req)
        for mode in ("floor","pallet"):
            body.Inputs=body.Inputs.model_copy(update={"mode":mode})
            self.assertEqual(api.preview(self.req,body,self.ctx)["Inputs"]["mode"],mode)

    def test_confirmation_rejects_mode_conflict_without_saving(self):
        body=self.payload()
        body.Inputs=body.Inputs.model_copy(update={"mode":"floor"})
        before=self.cur.execute("SELECT COUNT(*) FROM dbo.ContainerLoadPlan WHERE ItemID=?",self.req).fetchval()
        with self.assertRaises(HTTPException) as error:api.save(self.req,body,self.ctx)
        self.assertEqual(error.exception.status_code,422)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ContainerLoadPlan WHERE ItemID=?",self.req).fetchval(),before)

    def test_tcb_uses_response_pallet_and_accessory_usd_total(self):
        import tcb_api
        item_id=self.cur.execute("SELECT OpportunityItemID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()
        self.cur.execute("UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?",json.dumps({"Inputs":{"PalletUSDPerEA":"15"}}),item_id)
        snapshot={"PalletSize":"1200x800mm","UnitPrice":"403000","CurrencyCode":"VND","UnitUSDPrice":"15.5"}
        price=self.cur.execute("INSERT dbo.PalletPricingSnapshot(ItemID,SnapshotJSON,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?)",self.req,json.dumps(snapshot),self.actor).fetchval()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ResponsePalletSize='1200x800mm',PalletPricingID=? WHERE ID=?",price,self.req)
        self.assertEqual(tcb_api.item_read(item_id,self.ctx)["DefaultPalletUSDPerEA"],Decimal("15.5"))
        with patch.object(tcb_api,"active_loss_masters",return_value=[]):
            read=tcb_api.read(item_id,self.ctx)
        self.assertEqual(Decimal(read["saved"]["Inputs"]["PalletUSDPerEA"]),Decimal("15.5"))
        snapshot["UnitUSDPrice"]=None
        self.cur.execute("UPDATE dbo.PalletPricingSnapshot SET SnapshotJSON=? WHERE ID=?",json.dumps(snapshot),price)
        self.assertIsNone(tcb_api.item_read(item_id,self.ctx)["DefaultPalletUSDPerEA"])

    def test_carton_dimensions_are_server_owned(self):
        body=self.payload()
        body.Inputs.carton=api.Dimensions(length=999,width=888,height=777)
        result=api.preview(self.req,body,self.ctx)
        self.assertEqual(float(result['Inputs']['carton']['length']),400)
        self.assertEqual(float(result['Inputs']['carton']['height']),200)

    def test_container_proposals_keep_separate_modes_and_saved_plans(self):
        import packaging_api
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ConfigurationRequest='Both' WHERE ID=?",self.req)
        self.version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        first=api.save(self.req,self.payload(),self.ctx)
        other=api.save_container(self.record.model_copy(update={'Code':'TESTLOAD2','SizeFT':40}),self.ctx)['ID']
        crv=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.ContainerTypeMaster WHERE ID=?',other).fetchval())
        body=self.payload().model_copy(update={'ContainerID':other,'ContainerRowVersion':crv})
        body.Inputs=body.Inputs.model_copy(update={'mode':'floor'})
        second=api.save(self.req,body,self.ctx)
        # Both permits independently confirmed pallet and floor proposals.
        response=packaging_api.response_save(packaging_api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=self.version,LoadPlanID=second['ID'],CartonsPerContainer=str(second['Result']['cartons']),ContainerLoadPlanIDs={self.cid:first['ID'],other:second['ID']})]),self.ctx)
        self.assertEqual(response['results'][0]['Status'],'OK')
        saved=dict(self.cur.execute('SELECT ContainerID,PlanID FROM dbo.ResponseContainerLoadPlan WHERE ItemID=?',self.req).fetchall())
        self.assertEqual(saved,{self.cid:first['ID'],other:second['ID']})
        from request_views import item_read
        request_id=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        row=item_read(self.username,request_id,1,25,None,None,'[]')['rows'][0]
        variants=json.loads(row['ContainerPlansJSON'])
        self.assertEqual({p['Inputs']['mode'] for p in variants},{'pallet','floor'})
        self.assertEqual({p['ID'] for p in variants},{first['ID'],second['ID']})

    def test_container_master_requires_admin_even_with_edit_permission(self):
        ctx=AccessContext(self.actor,self.username,frozenset({'Packaging'}),{'containers':'edit','requests':'edit'})
        with self.assertRaises(HTTPException) as error:api.save_container(self.record,ctx)
        self.assertEqual(error.exception.status_code,403)

    def test_feedback_container_not_limited_by_requested_family_or_size(self):
        import packaging_api
        # Create immutable request snapshots with these values, rather than editing a saved snapshot.
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE ID=?",self.req)
        request_id=self.cur.execute("""INSERT dbo.PackagingConfigurationRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerID,CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue)
            SELECT NEWID(),o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,o.BidOpen,o.BidClose,o.RowVersion,?,DATEADD(DAY,10,CONVERT(DATE,SYSUTCDATETIME()))
            FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=?; SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.opp).fetchval()
        self.req=self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy,ContainerRequest,ShipmentContainerSizeFT,ConfigurationRequest,LengthMM,WidthMM,HeightMM)
            SELECT ?,oi.ID,p.ID,p.ProductCode,p.ProductName,oi.ItemDescription,oi.AnnualUnit,oi.RowVersion,'Assigned',1,?,'20DC','20FT','Pallet load',400,300,200
            FROM dbo.OpportunityItem oi JOIN dbo.Product p ON p.ID=oi.ProductID WHERE oi.ID=?; SELECT CONVERT(INT,SCOPE_IDENTITY())""",request_id,self.actor,self.item).fetchval()
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        result=packaging_api.response_save(packaging_api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,SelectedContainerType='40RHC',ContainerLoadProfiles={'40RHC':dict(PalletsPerContainer=5)})]),self.ctx)
        self.assertEqual(result['results'][0]['Status'],'OK')


    def seed_selected_plan(self):
        inputs=calculation_tests.LoadingTests().inputs()
        result=api.plan(inputs)
        identity=self.cur.execute("INSERT dbo.ContainerLoadPlan(ItemID,ContainerID,Inputs,Result,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?,?,?)",self.req,self.cid,inputs.model_dump_json(),json.dumps(result),self.actor).fetchval()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET LoadPlanID=?,CartonsPerLayer=8 WHERE ID=?",identity,self.req)
        self.cur.execute("INSERT dbo.ResponseContainerLoadPlan(ItemID,ContainerID,PlanID,UpdatedBy) VALUES(?,?,?,?)",self.req,self.cid,identity,self.actor)
        return identity

    def test_excel_carton_edit_invalidates_selection_and_maps_but_keeps_history(self):
        import packaging_excel_api as excel
        import packaging_api
        identity=self.seed_selected_plan()
        version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        request=self.cur.execute("SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()
        source=dict(RequestID=request,ItemRowVersion=version,ItemStage='Assigned',PICUserID=self.actor,HeightMM=200,WidthMM=300,LengthMM=400)
        edit=excel.Edit(row=3,request_id=request,item_id=self.req,version=version,changes={'CartonsPerLayer':5})
        payload=excel.prepare(edit,source,self.ctx)
        self.assertNotIn('LoadPlanID',payload.rows[0].model_fields_set)
        saved=packaging_api.response_save(payload,self.ctx)['results'][0]
        self.assertEqual(saved['Status'],'OK')
        self.assertIsNone(self.cur.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ResponseContainerLoadPlan WHERE ItemID=?",self.req).fetchval(),0)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ContainerLoadPlan WHERE ID=?",identity).fetchval(),1)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ResponseLoadPlanHistory WHERE ItemID=? AND PreviousPlanID=? AND LoadPlanID IS NULL",self.req,identity).fetchval(),1)
        self.assertEqual(bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()),saved['NewRowVersion'])

    def test_notes_only_save_preserves_selected_plan(self):
        import packaging_api
        identity=self.seed_selected_plan()
        version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        packaging_api.response_save(packaging_api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,ResponseNotes='Unrelated edit')]),self.ctx)
        self.assertEqual(self.cur.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),identity)


    def test_full_form_cannot_reattach_plan_after_physical_change(self):
        import packaging_api
        identity=self.seed_selected_plan()
        version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        response=packaging_api.response_save(packaging_api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,CartonsPerLayer=5,LoadPlanID=identity,ContainerLoadPlanIDs={self.cid:identity})]),self.ctx)
        self.assertEqual(response['results'][0]['Status'],'OK')
        self.assertIsNone(self.cur.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ResponseContainerLoadPlan WHERE ItemID=?",self.req).fetchval(),0)

    def test_rejected_edit_keeps_plan_and_mappings(self):
        import packaging_api
        identity=self.seed_selected_plan()
        from response_load_plan import invalidate_changed_plans
        version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
        def failed_after_clear(cur,before,actor):
            invalidate_changed_plans(cur,before,actor)
            raise RuntimeError('Injected failure after invalidation')
        with patch('response_load_plan.invalidate_changed_plans',side_effect=failed_after_clear):
            with self.assertRaisesRegex(RuntimeError,'Injected failure'):
                packaging_api.response_save(packaging_api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,CartonsPerLayer=5)]),self.ctx)
        self.assertEqual(self.cur.execute("SELECT CartonsPerLayer FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),8)
        self.assertEqual(self.cur.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),identity)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ResponseContainerLoadPlan WHERE ItemID=?",self.req).fetchval(),1)

if __name__=="__main__":unittest.main()
