"""Regression boundaries for response-owned loading data and pallet access."""
import json
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from auth import AccessContext
from workspace_access import enforce_route
import load_planning_api as api


class PalletRouteAccess(unittest.TestCase):
    def test_assigned_packaging_editor_can_reach_catalog_preview_and_save(self):
        ctx=AccessContext(1,'PIC',frozenset({'Packaging'}),{'requests':'edit'})
        for path,method in [('/api/pallet-pricing/items/1','GET'),('/api/pallet-pricing/items/1/preview','POST'),('/api/pallet-pricing/items/1/save','POST')]:
            with self.subTest(path=path):enforce_route(ctx,path,method)

    def test_display_user_cannot_save_and_unrelated_page_cannot_read(self):
        for ctx,path,method in [
            (AccessContext(1,'Reader',frozenset({'Opportunity'}),{'requests':'display'}),'/api/pallet-pricing/items/1/save','POST'),
            (AccessContext(2,'Other',frozenset({'Product'}),{'products':'edit'}),'/api/pallet-pricing/items/1','GET')]:
            with self.assertRaises(HTTPException) as error:enforce_route(ctx,path,method)
            self.assertEqual(error.exception.status_code,403)

class ResponseOwnedLoading(unittest.TestCase):
    def setUp(self):
        self.saved=dict(ConfigurationRequest='Pallet load',CartonsPerLayer=5,ResponseMaxPalletHeightMM=1140,ResponsePalletStacking='Single',ResponsePalletSize='1200x800mm')
        self.assembly=dict(ID=9,PalletSize='1200x800mm',Dimensions=dict(length=1200,width=800,height=140),TareKG='20',UnitUSDPrice='15')
        self.weight='10'
        self.body=api.Preview(ContainerID=1,ContainerRowVersion='AAAAAAAAAAE=',Inputs=dict(
            carton=dict(length=400,width=300,height=200),carton_kg='.001',
            pallet=dict(length=1,width=1,height=1),pallet_kg=0,
            container=dict(length=1,width=1,height=1),cartons_per_layer=1,
            max_pallet_height=20000,double_stack=True,stackable=True,pallet_payload_kg=1))
    def select(self,cur,sql,*args):
        if 'ContainerTypeMaster' in sql:return [[dict(RowVersion=b'\0'*7+b'\1',Code='20DC',Specifications=json.dumps(dict(length=5900,width=2350,height=2390,payload_kg=28000)))]]
        if ' Snapshot' in sql:return [[dict(Snapshot=json.dumps(self.assembly) if self.assembly else None,ResponsePalletSize=self.saved['ResponsePalletSize'])]]
        return [[self.saved]]
    def calculate(self):
        with patch.object(api,'select',side_effect=self.select),patch.object(api,'response_dimensions',return_value=dict(length=400,width=300,height=200)),patch('packaging_weight.response_weights',side_effect=lambda *args:dict(CartonGrossWeightKG=self.weight)):
            return api.calculate(None,self.body,1)
    def test_saved_response_overrides_fabricated_weight_count_height_and_stacking(self):
        inputs,result=self.calculate()
        self.assertEqual(inputs.weight_source,'response')
        self.assertEqual(float(inputs.carton_kg),10)
        self.assertEqual(inputs.cartons_per_layer,5)
        self.assertEqual(float(inputs.max_pallet_height),1140)
        self.assertFalse(inputs.double_stack)
        self.assertFalse(inputs.stackable)
        self.assertIsNone(inputs.pallet_payload_kg)
        self.assertEqual(result['cartons_per_pallet'],25)
        self.assertEqual(result['gross_kg'],2970)
    def test_saved_double_stacking_and_pallet_snapshot_override_client_choices(self):
        self.saved['ResponsePalletStacking']='Double'
        self.body.Inputs.double_stack=False
        self.body.Inputs.stackable=False
        self.body.PalletPriceID=123
        inputs,result=self.calculate()
        self.assertTrue(inputs.double_stack)
        self.assertTrue(inputs.stackable)
        self.assertEqual(float(inputs.pallet_kg),20)
        self.assertEqual(result['loaded_units'],22)

    def test_unknown_saved_gross_cannot_be_replaced_by_manual_weight(self):
        self.weight=None
        with self.assertRaises(HTTPException):self.calculate()
    def test_pallet_requires_saved_assembly_and_response_count(self):
        self.assembly=None
        with self.assertRaises(HTTPException):self.calculate()
        self.setUp();self.saved['CartonsPerLayer']=None
        with self.assertRaises(HTTPException):self.calculate()
    def test_floor_still_uses_saved_weight_and_discards_pallet_overrides(self):
        self.saved['ConfigurationRequest']='Floor load'
        self.body.Inputs.mode='floor'
        inputs,_=self.calculate()
        self.assertEqual(inputs.weight_source,'response')
        self.assertEqual(float(inputs.carton_kg),10)
        self.assertIsNone(inputs.pallet)
        self.assertFalse(inputs.double_stack)
