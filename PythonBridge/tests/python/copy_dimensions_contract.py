import sys,unittest
from pathlib import Path
from decimal import Decimal as D
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from copy_dimensions import copied_geometry,uses_copy
from pkg_pricing import Calculation
from packaging_type_api import PackagingTypeRow
from pydantic import ValidationError
from unittest.mock import patch
import pkg_pricing_api as api
from db import bytes_to_b64

class CopyDimensions(unittest.TestCase):
 def setUp(self):
  self.version=b"12345678"
  self.root=dict(ID=1,CopyDim=True,Shipping=True)
  self.dim=dict(ID=2,PackagingTypeID=1,ParentDimensionID=None,RowVersion=self.version,D1Name="Length",D2Name="Width",D3Name=None,D1UoMID=1,D2UoMID=1)
  self.price=dict(PriceID=3,PriceRowVersion=self.version,PackagingTypeID=1,MaterialDimensionID=2,MaterialDimensionRowVersion=self.version,MaterialD1=D(250),MaterialD2=D(150),CopyDim=True)
  self.units={1:dict(ID=1,UoMCode="mm"),2:dict(ID=2,UoMCode="cm")}
 def copied(self):return copied_geometry(self.root,self.price,{2:self.dim},self.units,lambda a,b:D(10))
 def test_copies_current_material_dimensions(self):
  target,values=self.copied();self.assertEqual(target["ID"],2);self.assertEqual(values,dict(D1=D(250),D2=D(150),D3=None))
 def test_missing_measurement_and_stale_definition_rejected(self):
  for change in ({"MaterialD1":None},{"MaterialDimensionRowVersion":b"87654321"},{"MaterialDimensionID":99}):
   with self.subTest(change=change):
    old=self.price;self.price={**old,**change}
    with self.assertRaises(HTTPException):self.copied()
    self.price=old
 def test_matches_names_and_converts_units(self):
  source={**self.dim, "ID":4,"PackagingTypeID":5,"ParentDimensionID":2,"D1Name":"Width","D2Name":"Length","D1UoMID":2,"D2UoMID":2}
  price={**self.price,"PackagingTypeID":5,"MaterialDimensionID":4,"MaterialD1":D(15),"MaterialD2":D(25)}
  _,values=copied_geometry(self.root,price,{2:self.dim,4:source},self.units,lambda a,b:D(10))
  self.assertEqual(values["D1"],250);self.assertEqual(values["D2"],150)
 def test_api_ignores_forged_manual_dimensions(self):
  payload=Calculation(PackagingOrder="Primary",PackagingTypeID=1,DimensionID=99,D1=999,
   components=[dict(PriceID=3,PriceRowVersion=bytes_to_b64(self.version),Quantity=1)])
  result=api.hydrate_copy(None,payload,self.root,[self.price],{2:self.dim},self.units)
  self.assertEqual(result.DimensionID,2);self.assertEqual(result.D1,250)
 def test_multiple_prices_rejected_and_noncopy_unaffected(self):
  payload=Calculation(PackagingOrder="Primary",PackagingTypeID=1,components=[
   dict(PriceID=id,PriceRowVersion=bytes_to_b64(self.version),Quantity=1) for id in (3,4)])
  with self.assertRaisesRegex(HTTPException,""):api.hydrate_copy(None,payload,self.root,[self.price],{2:self.dim},self.units)
  self.assertIs(api.hydrate_copy(None,payload,{"CopyDim":False},[{**self.price,"CopyDim":False}],{},{}),payload)
 def test_nonshipping_single_copies_its_own_material_geometry(self):
  root={**self.root,"Shipping":False}
  self.assertTrue(uses_copy(root,[self.price]))
  payload=Calculation(PackagingOrder="Secondary",PackagingTypeID=1,D1=999,components=[dict(PriceID=3,PriceRowVersion=bytes_to_b64(self.version),Quantity=1)])
  result=api.hydrate_copy(None,payload,root,[self.price],{2:self.dim},self.units)
  self.assertEqual(result.DimensionID,2);self.assertEqual(result.D1,250)
  with self.assertRaisesRegex(HTTPException,""):
   api.hydrate_copy(None,payload,root,[self.price],{},self.units)
 def test_assembled_parent_keeps_manual_dimensions(self):
  root={**self.root,"CopyDim":False,"Shipping":False}
  price={**self.price,"CopyDim":False}
  payload=Calculation(PackagingOrder="Secondary",PackagingTypeID=1,D1=999,components=[dict(PriceID=3,PriceRowVersion=bytes_to_b64(self.version),Quantity=1)])
  self.assertIs(api.hydrate_copy(None,payload,root,[price],{},{}),payload)
 def test_copy_requires_single(self):
  self.assertFalse(PackagingTypeRow(RowNum=1,Command="C",PackagingType="Box",PackagingOrders=["Primary"],FinalComponent=False,CopyDim=True).CopyDim)


class CopyDimRootOnly(unittest.TestCase):
 def test_child_cannot_enable_copy_dim(self):
  self.assertFalse(PackagingTypeRow(RowNum=1,Command="C",PackagingType="Child",ParentTypeID=9,FinalComponent=True,CopyDim=True).CopyDim)

if __name__=="__main__":unittest.main()
