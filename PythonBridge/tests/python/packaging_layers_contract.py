"""Multi-order types, cumulative layers and Tertiary pricing. Every fixture rolls back."""
import json
import unittest
from decimal import Decimal
from pydantic import ValidationError
from fastapi import HTTPException
import pkg_pricing_contract as pricing
import web_requirement_sections_contract as requirements
import packaging_type_master_contract as types
from db import bytes_to_b64
from pkg_pricing import Calculation
import packaging_type_api as type_api
import packaging_api as batches
import pkg_pricing_api as calculator
import packaging_master_api as masters
from request_views import item_read

class Orders(unittest.TestCase):
    setUp=types.PackagingTypeMaster.setUp
    cleanup=types.PackagingTypeMaster.cleanup
    read=types.PackagingTypeMaster.read
    role=types.PackagingTypeMaster.role

    def save_type(self,orders,**values):
        row=dict(RowNum=1,Command='C',PackagingOrders=orders,PackagingType=self.name,PriceBasis='Count')
        return type_api.packaging_type_save(type_api.PackagingTypeBatch(rows=[{**row,**values}]),self.ctx)['results'][0]

    def test_multi_order_read_edit_and_legacy_update_preserves_membership(self):
        saved=self.save_type(['Tertiary','Primary','Secondary'])
        self.assertEqual(saved['Status'],'OK',saved)
        row=self.read()['rows'][0]
        self.assertEqual(row['PackagingOrders'],['Primary','Secondary','Tertiary'])
        changed=self.save_type(['Secondary','Tertiary'],Command='U',ID=row['ID'],RowVersion=row['RowVersion'])
        self.assertEqual(changed['Status'],'OK',changed)
        legacy=dict(RowNum=1,Command='U',ID=row['ID'],RowVersion=changed['NewRowVersion'],PackagingOrder='Secondary',
                    PackagingType=self.name,PriceBasis='Volume')
        result=type_api.packaging_type_save(type_api.PackagingTypeBatch(rows=[legacy]),self.ctx)['results'][0]
        self.assertEqual(result['Status'],'OK',result)
        self.assertEqual(self.read()['rows'][0]['PackagingOrders'],['Secondary','Tertiary'])
        self.assertEqual(self.read()['rows'][0]['ID'],row['ID'])

    def test_overlapping_name_conflict_but_disjoint_orders_allowed(self):
        self.assertEqual(self.save_type(['Primary','Tertiary'])['Status'],'OK')
        self.assertEqual(self.save_type(['Secondary'])['Status'],'OK')
        self.assertEqual(self.save_type(['Tertiary'])['Status'],'ERROR')

    def test_strict_order_list_validation(self):
        for orders in ([],['Primary','Primary'],['Quaternary'],None):
            with self.subTest(orders=orders),self.assertRaises(ValidationError):self.save_type(orders)
        with self.assertRaises(ValidationError):self.save_type(['Secondary'],PackagingOrder='Primary')

    def test_manager_can_read_but_not_maintain_orders(self):
        self.save_type(['Secondary','Tertiary'])
        manager=self.role('PackagingManager')
        self.assertEqual(self.read(ctx=manager)['rows'][0]['PackagingOrders'],['Secondary','Tertiary'])
        with self.assertRaises(HTTPException):
            type_api.packaging_type_save(type_api.PackagingTypeBatch(rows=[dict(RowNum=1,Command='C',
                PackagingOrders=['Tertiary'],PackagingType=self.name+'other',PriceBasis='Count')]),manager)

class RequestedLayers(unittest.TestCase):
    setUp=requirements.WebRequirementSections.setUp
    cleanup=requirements.WebRequirementSections.cleanup
    apply=requirements.WebRequirementSections.apply
    save_fields=requirements.WebRequirementSections.save_fields
    request=requirements.WebRequirementSections.request

    def all_order_type(self):
        id=self.types['Primary']
        self.cur.execute("INSERT dbo.PackagingTypeOrder VALUES(?,'Secondary'),(?,'Tertiary')",id,id)
        return id

    def test_all_orders_can_request_same_type_and_snapshot_tertiary(self):
        id=self.all_order_type()
        self.save_fields(PackagingLayerCount=3,PrimaryTypeID=id,SecondaryTypeID=id,TertiaryTypeID=id,
                         NumberOfPrimary=12,NumberOfSecondary=8,TertiaryTransparency='Opaque')
        created=self.request([self.item]);item=created['items'][0]['ID']
        row=item_read(self.username,created['header']['ID'],1,25,None,None,'[]')['rows'][0]
        self.assertEqual(row['RequestedLayerCount'],3);self.assertEqual(row['TertiaryTypeID'],id)
        self.assertEqual(row['NumberOfSecondary'],8);self.assertEqual(row['TertiaryTransparency'],'Opaque')
        old=row['TertiaryTypeName']
        self.cur.execute("UPDATE dbo.PackagingType SET PackagingType=PackagingType+' changed' WHERE ID=?",id)
        self.assertEqual(item_read(self.username,created['header']['ID'],1,25,None,None,'[]')['rows'][0]['TertiaryTypeName'],old)
        self.assertIsNone(self.cur.execute('SELECT ResponseLayerCount FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',item).fetchval())

    def test_lowering_requested_layers_clears_only_inactive_requirements(self):
        id=self.all_order_type()
        self.save_fields(PackagingLayerCount=3,PrimaryTypeID=id,SecondaryTypeID=id,TertiaryTypeID=id,
                         NumberOfPrimary=12,NumberOfSecondary=8,TertiaryTransparency='NA')
        self.save_fields(PackagingLayerCount=1)
        row=self.cur.execute('SELECT PackagingLayerCount,PrimaryTypeID,SecondaryTypeID,TertiaryTypeID,NumberOfPrimary,NumberOfSecondary,TertiaryTransparency FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchone()
        self.assertEqual(tuple(row),(1,id,None,None,None,None,None))

    def test_requested_snapshot_is_immutable(self):
        self.save_fields(PackagingLayerCount=1,PrimaryTypeID=self.types['Primary'])
        item=self.request([self.item])['items'][0]['ID']
        with self.assertRaisesRegex(Exception,'52981'):
            self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET RequestedLayerCount=3 WHERE ID=?',item)

    def test_processing_lock_protects_layer_count(self):
        self.save_fields(PrimaryTypeID=self.types['Primary']);self.request([self.item])
        with self.assertRaisesRegex(Exception,'52952'):
            self.cur.execute('UPDATE dbo.OpportunityItem SET PackagingLayerCount=3 WHERE ID=?',self.item)

    def test_default_two_layers_and_audit_for_new_fields(self):
        self.assertEqual(self.cur.execute('SELECT PackagingLayerCount FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchval(),2)
        self.save_fields(PackagingLayerCount=3,NumberOfSecondary=4)
        logged=self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName IN('PackagingLayerCount','NumberOfSecondary') AND ChangedBy=?",self.item,self.username).fetchval()
        self.assertEqual(logged,2)

class LayerPricing(unittest.TestCase):
    setUp=pricing.PricingSQL.setUp
    cleanup=pricing.PricingSQL.cleanup
    new_type=pricing.PricingSQL.new_type
    material=pricing.PricingSQL.material
    line=pricing.PricingSQL.line
    payload=pricing.PricingSQL.payload
    preview=pricing.PricingSQL.preview
    save=pricing.PricingSQL.save

    def response(self,**fields):
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        return batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,**fields)]),self.ctx)

    def tertiary(self):
        self.cur.execute("INSERT dbo.PackagingTypeOrder VALUES(?,'Tertiary'),(?,'Tertiary')",self.root,self.label_type)
        return Calculation(PackagingOrder='Tertiary',LayerCount=3,PackagingTypeID=self.root,components=[self.line(self.label_price,'2')])

    def test_tertiary_preview_save_quote_projection_and_history(self):
        payload=self.tertiary();result=self.preview(payload)
        self.assertEqual(Decimal(result['UnitPrice']),Decimal(20000))
        self.response(ResponseLayerCount=3,ThirdPMType=result['PackagingTypeName'],UnitsPerTertiary=5,
                      PricingCalculations=[payload.model_copy(update={'Fingerprint':result['Fingerprint']})])
        row=self.cur.execute('SELECT RequestedLayerCount,ResponseLayerCount,ThirdPMMOQ,UnitsPerTertiary FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchone()
        self.assertEqual(tuple(row),(2,3,Decimal(2500),5))
        header=calculator.history(self.req,self.ctx)['snapshots'][0]['header']
        self.assertEqual(header['PackagingOrder'],'Tertiary')
        self.assertEqual(json.loads(header['ContextSnapshotJSON'])['Request']['ConfirmedLayerCount'],3)
        request=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        projected=item_read(self.username,request,1,25,None,None,'[]')['rows'][0]
        self.assertEqual(Decimal(projected['TertiaryPricePerUnit']),Decimal(20000))
        self.assertEqual(projected['TertiaryPriceCurrencyCode'],'VND')

    def test_lower_confirmed_layers_supersedes_quote_without_deleting_history(self):
        payload=self.tertiary();result=self.preview(payload)
        self.response(ResponseLayerCount=3,ThirdPMType=result['PackagingTypeName'],UnitsPerTertiary=3,
                      PricingCalculations=[payload.model_copy(update={'Fingerprint':result['Fingerprint']})])
        self.response(ResponseLayerCount=1)
        row=self.cur.execute('SELECT RequestedLayerCount,ResponseLayerCount,ThirdPMType,ThirdPMMOQ,UnitsPerTertiary FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchone()
        self.assertEqual(tuple(row),(2,1,None,None,None))
        history=calculator.history(self.req,self.ctx)['snapshots']
        self.assertEqual(len(history),1);self.assertFalse(history[0]['header']['IsCurrent'])
        self.assertEqual(history[0]['components'][0]['Quantity'],'2')

    def test_tertiary_price_and_moq_cannot_be_forged(self):
        with self.assertRaises(ValidationError):self.response(TertiaryPricePerUnit=1)
        with self.assertRaises(HTTPException) as caught:self.response(ResponseLayerCount=3,ThirdPMMOQ=1)
        self.assertEqual(caught.exception.status_code,422)

    def test_inactive_calculation_cannot_be_saved(self):
        payload=self.tertiary();result=self.preview(payload)
        with self.assertRaises(HTTPException) as caught:
            self.response(ResponseLayerCount=2,ThirdPMType=result['PackagingTypeName'],
                PricingCalculations=[payload.model_copy(update={'Fingerprint':result['Fingerprint']})])
        self.assertEqual(caught.exception.status_code,422)

    def test_leaf_material_assignment_enforced_but_existing_parent_is_preserved(self):
        opts=masters.lookups(self.ctx,'materials')['packagingTypes']
        self.assertTrue(next(t for t in opts if t['ID']==self.root)['HasChildren'])
        self.assertFalse(next(t for t in opts if t['ID']==self.label_type)['HasChildren'])
        created=batches.material_save(batches.MaterialBatch(rows=[dict(RowNum=1,Command='C',MaterialName='parent rejected',
            UnitOfMeasure='EA',PackagingTypeID=self.root)]),self.ctx)['results'][0]
        self.assertEqual(created['Status'],'ERROR')
        self.cur.execute('UPDATE dbo.PackagingMaterial SET PackagingTypeID=? WHERE ID=?',self.root,self.label)
        rv=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingMaterial WHERE ID=?',self.label).fetchval())
        saved=batches.material_save(batches.MaterialBatch(rows=[dict(RowNum=1,Command='U',ID=self.label,RowVersion=rv,
            MaterialName='Existing parent unchanged',UnitOfMeasure='EA',PackagingTypeID=self.root)]),self.ctx)['results'][0]
        self.assertEqual(saved['Status'],'OK',saved)

    def test_one_layer_submission_does_not_require_secondary(self):
        self.response(ResponseLayerCount=1)
        payload=self.payload(self.line(self.label_price,'2'),LayerCount=1);self.save(payload,self.preview(payload))
        rv=self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,'Pending Review',NULL",self.username,self.req,rv)
        self.assertEqual(pricing.fields.consume(self.cur)[0][0]['Stage'],'Pending Review')

    def test_tertiary_requires_complete_confirmed_response_before_submission(self):
        self.response(ResponseLayerCount=3,FirstPMType=self.cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',self.root).fetchval())
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMMOQ=1,SecondPMType=FirstPMType,SecondPMMOQ=1,UnitsPerCarton=12 WHERE ID=?',self.req)
        rv=self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        with self.assertRaisesRegex(Exception,'52963'):
            self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,'Pending Review',NULL",self.username,self.req,rv)

if __name__=='__main__':unittest.main()

