"""Shared output UoM contracts. Live SQL fixtures always roll back."""
import sys,json,unittest,uuid
from pathlib import Path
from decimal import Decimal as D
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from formula_output_units import output_unit_factor,converted_output
from fastapi import HTTPException
import formula_roles_contract as foundation
import packaging_dimension_api as dimensions

class OutputUnitMath(unittest.TestCase):
 def setUp(self):
  self.units={1:dict(ID=1,UoMCode="mm2",Status="Active"),2:dict(ID=2,UoMCode="m2",Status="Active")}
 def test_both_roles_use_the_same_maintained_conversion(self):
  lookup=Mock(return_value=dict(ID=9,Factor=D(".000001")))
  factor,metadata=output_unit_factor(dict(ConversionOutputUoMID=1),self.units,"m2",lookup)
  self.assertEqual(converted_output(D(45000),factor),D(".045"))
  self.assertEqual(converted_output(D(500000),factor),D(".5"))
  self.assertEqual(metadata["Conversion"]["ID"],9)
  lookup.assert_called_once_with("mm2","m2")
 def test_same_unit_and_legacy_do_not_need_a_conversion(self):
  lookup=Mock(side_effect=AssertionError("Unexpected conversion"))
  self.assertEqual(output_unit_factor({},self.units,"m2",lookup),(D(1),None))
  self.assertEqual(output_unit_factor(dict(ConversionOutputUoMID=2),self.units,"m2",lookup)[0],D(1))
 def test_missing_blocked_and_invalid_conversions_fail(self):
  for conversion in (None,dict(Factor=D(0)),dict(Factor=D("NaN"))):
   with self.subTest(conversion=conversion),self.assertRaises(ValueError):
    output_unit_factor(dict(ConversionOutputUoMID=1),self.units,"m2",lambda *_:conversion)
  self.units[1]["Status"]="Block"
  with self.assertRaises(ValueError):
   output_unit_factor(dict(ConversionOutputUoMID=1),self.units,"m2",lambda *_:None)
 def test_normalized_output_cannot_round_to_zero(self):
  with self.assertRaises(ValueError):converted_output(D(".0000000001"),D(1))

class OutputUnitSQL(unittest.TestCase):
 cleanup=foundation.FormulaRolesSQL.cleanup
 apply=foundation.FormulaRolesSQL.apply
 batch=foundation.FormulaRolesSQL.batch
 edit=foundation.FormulaRolesSQL.edit
 request=foundation.FormulaRolesSQL.request
 activate=foundation.FormulaRolesSQL.activate
 create_mix=foundation.FormulaRolesSQL.create_mix
 save_fields=foundation.FormulaRolesSQL.save_fields
 dim_rv=foundation.FormulaRolesSQL.dim_rv
 payload=foundation.FormulaRolesSQL.payload
 preview=foundation.FormulaRolesSQL.preview
 save=foundation.FormulaRolesSQL.save
 price_row=foundation.FormulaRolesSQL.price_row
 maintain=foundation.FormulaRolesSQL.maintain
 def migrate(self,name):
  foundation.FormulaRolesSQL.migrate(self,name)
  if name in ("80_packaging_formula_roles.sql","81_packaging_child_dimensions.sql"):
   foundation.FormulaRolesSQL.migrate(self,"100_packaging_conversion_output_uom.sql")
 def definition(self,**values):
  if values.get("PackagingTypeID") is not None and values.get("PackagingTypeID")==getattr(self,"child",None):
   self.cur.execute("UPDATE dbo.PackagingType SET FinalComponent=1 WHERE ID=?",self.child)
  return foundation.FormulaRolesSQL.definition(self,**values)
 def setUp(self):
  foundation.FormulaRolesSQL.setUp(self)
  self.code="OUT-"+uuid.uuid4().hex[:12]
  self.output=self.cur.execute("INSERT dbo.UoM(UoMCode,CreatedBy) VALUES(?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.code,self.actor).fetchval()
  self.conversion=self.cur.execute("INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,CreatedBy) VALUES(?,?,.000001,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.output,self.units["m2"],self.material,self.actor).fetchval()
 def shared(self):
  return self.definition(ID=self.override,RowVersion=self.dim_rv(self.override),PackagingTypeID=self.child,
   ParentDimensionID=self.dimension,ParentDimensionRowVersion=self.dim_rv(),
   ConvertFromParentFormula="(D2*2+25)*D1",ConvertFromSupplierFormula="D1*D2",ConversionOutputUoMID=self.output)
 def test_shared_output_saves_previews_and_normalizes_both_prices(self):
  row=dimensions.save(self.shared(),self.ctx)["row"]
  self.assertEqual(self.cur.execute("SELECT ConversionOutputUoMID FROM dbo.PackagingDimension WHERE ID=?",row["ID"]).fetchval(),self.output)
  values=self.shared().model_dump(exclude={"ID","RowVersion","Status","FormulaReviewed"})
  for role,d1,d2,expected in (("ConvertFromParentFormula",200,100,D(45000)),("ConvertFromSupplierFormula",1000,500,D(500000))):
   result=dimensions.preview_formula(dimensions.FormulaRoleTest(**values,FormulaRole=role,TestD1=d1,TestD2=d2),self.ctx)
   self.assertEqual(D(result["Value"]),expected);self.assertEqual(result["OutputUnit"],self.code)
  self.maintain()
  result=self.preview()
  self.assertEqual(D(result["components"][0]["Area"]),D(".045"))
  self.assertEqual(D(result["components"][0]["Factor"]),D(".5"))
  self.assertEqual(D(result["UnitPrice"]),D(900))
  self.assertEqual(self.save(self.payload(),result)["results"][0]["Status"],"OK")
  snapshot=json.loads(self.cur.execute("SELECT SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1",self.req).fetchval())
  component=snapshot["components"][0]
  self.assertEqual(component["Dimension"]["ConversionOutputUoMID"],self.output)
  self.assertEqual(component["Conversion"]["Dimension"]["ConversionOutputUoMID"],self.output)
  self.assertEqual(component["Dimension"]["FormulaOutputConversion"]["Conversion"]["ID"],self.conversion)
  self.assertEqual(result["ParentGeometryMetrics"],{"AreaM2":"0.020000000","VolumeM3":"0.005000000"})
 def test_missing_conversion_blocks_supplier_price(self):
  dimensions.save(self.shared(),self.ctx)
  self.cur.execute("UPDATE dbo.UnitConversion SET Status='Block' WHERE ID=?",self.conversion)
  from packaging_api import price_save,PackagingPriceBatch
  with self.assertRaises(HTTPException) as error:
   price_save(PackagingPriceBatch(rows=[self.price_row(SupplierDimensionID=self.override,SupplierDimensionRowVersion=self.dim_rv(self.override),SupplierD1=1000,SupplierD2=500)]),self.ctx)
  self.assertEqual(error.exception.status_code,422)
  self.assertIn("conversion",str(error.exception.detail))
 def test_conversion_change_invalidates_cached_supplier_price(self):
  dimensions.save(self.shared(),self.ctx);self.maintain()
  self.cur.execute("UPDATE dbo.UnitConversion SET Factor=.000002 WHERE ID=?",self.conversion)
  with self.assertRaises(HTTPException) as error:self.preview()
  self.assertEqual(error.exception.status_code,409)
 def test_migration_is_rerunnable_without_changing_business_versions(self):
  before=tuple(self.cur.execute("SELECT RowVersion,ConversionOutputUoMID FROM dbo.PackagingDimension WHERE ID=?",self.override).fetchone())
  self.migrate("100_packaging_conversion_output_uom.sql")
  self.assertEqual(before,tuple(self.cur.execute("SELECT RowVersion,ConversionOutputUoMID FROM dbo.PackagingDimension WHERE ID=?",self.override).fetchone()))
  self.assertIsNone(before[1])
if __name__=="__main__":unittest.main()
