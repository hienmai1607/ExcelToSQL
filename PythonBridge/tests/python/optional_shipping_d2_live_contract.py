"""Current-schema Shipping D1/D3 regressions. Desktop test only; every fixture rolls back."""
import sys
import unittest
from contextlib import ExitStack
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
import db
from auth import AccessContext
from fastapi import HTTPException
from pydantic import ValidationError
import packaging_type_api as types
import packaging_dimension_api as dims
import packaging_api as pkg
import pkg_pricing_api as pricing


class OptionalShippingD2(unittest.TestCase):
 def setUp(self):
  if db.DB_NAME!='test' or db.DB_SERVER.lower() not in ('desktop-5bgmjsc','localhost','.'):
   self.skipTest('Desktop test database only')
  self.stack=ExitStack()
  self.addCleanup(self.stack.close)
  self.cur=self.stack.enter_context(db.get_raw_cursor())
  self.cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
  self.stack.callback(lambda:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
  self.stack.enter_context(db.reuse_transaction(self.cur.connection))
  actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.ctx=AccessContext(actor,name,frozenset({'Admin'}))
  self.mm=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='mm' AND Status='Active'").fetchval()
  row=types.packaging_type_save(types.PackagingTypeBatch(rows=[dict(RowNum=1,Command='C',PackagingType='QA optional D2 '+uuid4().hex[:10],PackagingOrders=['Primary'],Shipping=True,FinalComponent=True,CopyDim=True,PriceBasis='Count',Status='Active')]),self.ctx)['results'][0]
  self.assertEqual(row['Status'],'OK',row)
  self.kind=row['NewID']

 def definition(self,**changes):
  return dict(PackagingTypeID=self.kind,D1='Dia',D2=None,D3='Height',D1UoMID=self.mm,D2UoMID=None,D3UoMID=self.mm,OccupiedM2Formula='D1*D1/1000000',OccupiedM3Formula='D1*D1*D3/1000000000',Status='Active',**changes)

 def test_optional_d2_material_can_be_selected_and_priced(self):
  definition=dims.save(dims.DimensionSave(**self.definition()),self.ctx)['row']
  row=pkg.material_save(pkg.MaterialBatch(rows=[dict(RowNum=1,Command='C',PackagingTypeID=self.kind,MaterialName='QA diameter-height',UnitOfMeasure='EA',MaterialDimensionID=definition['ID'],MaterialDimensionRowVersion=definition['RowVersion'],MaterialD1=150,MaterialD2=None,MaterialD3=500,TareWeight='.2',TareWeightBasis='kg/EA',Status='Active')]),self.ctx)['results'][0]
  self.assertEqual(row['Status'],'OK',row)
  usd=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  quote=pkg.price_save(pkg.PackagingPriceBatch(rows=[dict(RowNum=1,Command='C',MaterialID=row['NewID'],CurrencyID=usd,PriceBasis='EA',QuantityFrom=0,UnitPrice=20,ExchangeRateToUSD=1,EffectiveFrom='2020-01-01',Status='Active')]),self.ctx)['results'][0]
  self.assertEqual(quote['Status'],'OK',quote)
  root,paths,units,definitions,prices=pricing.catalog(self.cur,self.kind,'Primary')
  selected=next(p for p in prices if p['PriceID']==quote['NewID'])
  body=pricing.Calculation(PackagingOrder='Primary',PackagingTypeID=self.kind,components=[dict(PriceID=selected['PriceID'],PriceRowVersion=pricing.encode(selected['PriceRowVersion']),Quantity=1)])
  unit_map={r['ID']:r for r in units};definition_map={r['ID']:r for r in definitions}
  hydrated=pricing.hydrate_copy(self.cur,body,root,prices,definition_map,unit_map)
  self.assertEqual((hydrated.D1,hydrated.D2,hydrated.D3),(150,None,500))
  _,height,_=pricing.parent_geometry(self.cur,hydrated,root,definition_map,unit_map,final_layer=True)
  self.assertEqual(height,500)

 def test_volume_preview_uses_only_defined_d1_and_d3(self):
  payload={k:v for k,v in self.definition().items() if k not in ('Status','OccupiedM2Formula','OccupiedM3Formula')}
  result=dims.preview_volume(dims.VolumeTest(**payload,VolumeFormula='D1*D1*D3/1000000000',TestD1=150,TestD3=500),self.ctx)
  self.assertEqual(Decimal(result['CubicMeters']),Decimal('.01125'))

 def test_shipping_type_update_keeps_optional_d2_definition_valid(self):
  dims.save(dims.DimensionSave(**self.definition()),self.ctx)
  self.cur.execute('UPDATE dbo.PackagingType SET Shipping=1 WHERE ID=?',self.kind)
  self.assertEqual(self.cur.execute('SELECT D3Name FROM dbo.PackagingDimension WHERE PackagingTypeID=?',self.kind).fetchval(),'Height')

 def test_formula_referencing_blank_d2_rejected_by_model_and_sql(self):
  values={**self.definition(),'OccupiedM2Formula':'D1*D2/1000000'}
  with self.assertRaises(ValidationError):dims.DimensionSave(**values)
  with self.assertRaises(HTTPException):dims.save(dims.DimensionSave.model_construct(**values),self.ctx)

 def test_shipping_still_requires_height(self):
  values={**self.definition(),'D3':None,'D3UoMID':None,'OccupiedM3Formula':None}
  with self.assertRaises(HTTPException):dims.save(dims.DimensionSave(**values),self.ctx)


if __name__=='__main__':unittest.main()
