"""Validation at the pallet-pricing calculation boundary."""
import unittest
from unittest.mock import patch
from decimal import Decimal
from fastapi import HTTPException
import pallet_pricing_api as api

class PalletPricing(unittest.TestCase):
    def setUp(self):
        self.rows=[dict(ID=1,RowVersion='price',MaterialRowVersion='material',PackagingOrder='Pallet',MaterialCode='PAL',Dimensions=dict(length='1200',width='800',height='140'),TareWeight='20',TareWeightBasis='kg/EA',CurrencyCode='USD',UnitPrice='10',UnitUSDPrice='10'),
                   dict(ID=2,RowVersion='price',MaterialRowVersion='material',PackagingOrder='Primary',MaterialCode='SHEET',Dimensions=None,TareWeight='1',TareWeightBasis='kg/m2',CurrencyCode='USD',UnitPrice='2',UnitUSDPrice='2')]
        self.body=api.Selection(PalletSize='1200x800mm',components=[dict(PriceID=1,RowVersion='price',MaterialRowVersion='material',Quantity=1),dict(PriceID=2,RowVersion='price',MaterialRowVersion='material',Quantity=2,AreaM2='.96')])
    def calc(self,body=None):
        with patch.object(api,'catalog',return_value=self.rows):return api.calculate(None,body or self.body)
    def test_area_consumption_and_cost(self):
        result=self.calc()
        self.assertEqual(Decimal(result['TareKG']),Decimal('21.92'))
        self.assertEqual(Decimal(result['UnitPrice']),14)
    def test_missing_tare_is_not_zero(self):
        self.rows[1]['TareWeight']=None
        self.assertIsNone(self.calc()['TareKG'])
        self.assertEqual(self.calc()['MissingTare'],['SHEET'])
    def test_invalid_selection(self):
        for change in ('size','duplicate','pallet-quantity','area','no-pallet','stale','currency'):
            with self.subTest(change=change):
                body=self.body.model_copy(deep=True)
                if change=='size':body.PalletSize='800x1200mm'
                elif change=='duplicate':body.components.append(body.components[1])
                elif change=='pallet-quantity':body.components[0].Quantity=2
                elif change=='area':body.components[1].AreaM2=None
                elif change=='no-pallet':body.components=body.components[1:]
                elif change=='stale':body.components[0].MaterialRowVersion='old'
                elif change=='currency':self.rows[1]['CurrencyCode']='VND'
                with self.assertRaises(HTTPException):self.calc(body)
