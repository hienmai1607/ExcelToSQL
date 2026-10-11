"""Final component SQL/API contracts; all writes and migration changes roll back."""
import sys,json,re,unittest,uuid
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
from db import get_raw_cursor
from auth import AccessContext
import packaging_api as materials, packaging_type_api as types, packaging_master_api as masters
import packaging_master_excel_api as excel
from pkg_pricing_api import catalog,component_geometry,inherited_component
from pkg_pricing import Calculation,Component
from db import bytes_to_b64
class FinalComponentContract(unittest.TestCase):
 def setUp(self):
  self.scope=get_raw_cursor();self.cur=self.scope.__enter__()
  self.cur.execute("SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION")
  self.addCleanup(self.cleanup)
  for batch in re.split(r"^GO\s*$",(ROOT/"sql/99_packaging_final_component.sql").read_text(),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
  self.ctx=AccessContext(actor,name,frozenset({"Admin"}));self.name="FC-"+uuid.uuid4().hex[:12]
  self.unit=self.cur.execute("SELECT TOP(1) UoMCode FROM dbo.UoM WHERE Status='Active' AND LEN(UoMCode)<=20 ORDER BY CASE WHEN UoMCode='EA' THEN 0 ELSE 1 END").fetchval()
  @contextmanager
  def cursor():yield self.cur
  mocked=patch.object(materials,"get_raw_cursor",cursor);mocked.start();self.addCleanup(mocked.stop)
 def cleanup(self):
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  self.scope.__exit__(None,None,None)
 def kind(self,**values):
  row=dict(RowNum=1,Command="C",PackagingOrders=["Primary"],PackagingType=self.name,FinalComponent=True,**{})
  row.update(values)
  return types.packaging_type_save(types.PackagingTypeBatch(rows=[row]),self.ctx)["results"][0]
 def material(self,id):
  return materials.material_save(materials.MaterialBatch(rows=[dict(RowNum=1,Command="C",MaterialName=self.name,UnitOfMeasure=self.unit,PackagingTypeID=id)]),self.ctx)["results"][0]
 def update(self,root,**values):
  return self.kind(Command="U",ID=root["NewID"],RowVersion=root["NewRowVersion"],**values)
 def test_parentless_final_type_assigns_material_and_enters_pricing_catalog(self):
  root=self.kind();self.assertEqual(root["Status"],"OK",root)
  row=self.cur.execute("SELECT PriceBasis,FinalComponent,ParentTypeID FROM dbo.PackagingType WHERE ID=?",root["NewID"]).fetchone()
  self.assertEqual(tuple(row),("Count",True,None))
  material=self.material(root["NewID"]);self.assertEqual(material["Status"],"OK",material)
  _,paths,_,_,prices=catalog(self.cur,root["NewID"],"Primary")
  self.assertIn(root["NewID"],paths)
  self.assertIn(material["NewID"],[p["MaterialID"] for p in prices])
  lookup=masters.lookups(self.ctx,"materials")["packagingTypes"]
  self.assertTrue(next(t for t in lookup if t["ID"]==root["NewID"])["FinalComponent"])
  payload=excel.prepare("materials",excel.Edit(row=3,command="C",changes=dict(MaterialName=self.name+" Excel",UnitOfMeasure=self.unit,PackagingType=self.name)),{},self.ctx)
  self.assertEqual(payload.rows[0].PackagingTypeID,root["NewID"])
  currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  price=materials.price_save(materials.PriceBatch(rows=[dict(RowNum=1,Command="C",MaterialID=material["NewID"],CurrencyID=currency,BaseUoM=self.unit,QuantityFrom=0,UnitPrice="2.50",EffectiveFrom="2020-01-01")]),self.ctx)["results"][0]
  self.assertEqual(price["Status"],"OK",price)
  _,paths,units,definitions,prices=catalog(self.cur,root["NewID"],"Primary")
  chosen=next(p for p in prices if p["PriceID"]==price["NewID"])
  line=Component(PriceID=price["NewID"],PriceRowVersion=bytes_to_b64(chosen["PriceRowVersion"]),Quantity=2)
  definition_map={d["ID"]:d for d in definitions}
  payload=Calculation(PackagingOrder="Primary",PackagingTypeID=root["NewID"],components=[line])
  line,definition_map=inherited_component(line,payload,chosen,paths,definition_map,None)
  geometry=component_geometry(self.cur,line,chosen,paths,{u["ID"]:u for u in units if u["Status"]=="Active"},definition_map,None)
  self.assertIsNone(geometry["Area"]);self.assertEqual(geometry["Factor"],1)
 def test_non_final_type_cannot_be_assigned(self):
  root=self.kind(FinalComponent=False);self.assertEqual(root["Status"],"OK",root)
  self.assertEqual(self.material(root["NewID"])["Status"],"ERROR")
 def test_final_component_cannot_be_parent(self):
  root=self.kind();child=self.kind(ParentTypeID=root["NewID"],PackagingType=self.name+" child")
  self.assertEqual(child["Status"],"ERROR",child)
 def test_container_with_children_cannot_be_final(self):
  root=self.kind(FinalComponent=False)
  child=self.kind(ParentTypeID=root["NewID"],PackagingType=self.name+" child")
  self.assertEqual(child["Status"],"OK",child)
  current=self.cur.execute("SELECT RowVersion FROM dbo.PackagingType WHERE ID=?",root["NewID"]).fetchval()
  result=self.update({**root,"NewRowVersion":bytes_to_b64(current)},FinalComponent=True)
  self.assertEqual(result["Status"],"ERROR",result)
  self.assertEqual(self.material(child["NewID"])["Status"],"OK")
 def test_assigned_flag_cannot_be_cleared_and_existing_basis_is_preserved(self):
  root=self.kind(PriceBasis="Square meter");self.assertEqual(root["Status"],"OK",root)
  result=self.update(root,PackagingType=self.name+" renamed")
  self.assertEqual(result["Status"],"OK",result)
  self.assertEqual(self.cur.execute("SELECT PriceBasis FROM dbo.PackagingType WHERE ID=?",root["NewID"]).fetchval(),"Square meter")
  self.assertEqual(self.material(root["NewID"])["Status"],"OK")
  self.assertEqual(self.update(result,FinalComponent=False)["Status"],"ERROR")
 def test_rerun_preserves_flags_and_versions(self):
  root=self.kind()
  before=tuple(self.cur.execute("SELECT FinalComponent,RowVersion FROM dbo.PackagingType WHERE ID=?",root["NewID"]).fetchone())
  for batch in re.split(r"^GO\s*$",(ROOT/"sql/99_packaging_final_component.sql").read_text(),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  self.assertEqual(before,tuple(self.cur.execute("SELECT FinalComponent,RowVersion FROM dbo.PackagingType WHERE ID=?",root["NewID"]).fetchone()))
if __name__=="__main__":unittest.main()
