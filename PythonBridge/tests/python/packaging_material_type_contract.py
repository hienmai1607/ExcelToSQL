"""Rollback-only Packaging Material type assignment contracts."""
import io
import json
import re
import sys
import unittest
import zipfile
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4
import packaging_field_foundation_contract as foundation
ROOT=foundation.ROOT
sys.path.insert(0,str(ROOT/"core"))
import packaging_api as api
import packaging_master_api as masters
import packaging_master_excel_api as excel
from raw_material_api import RawMaterialBatch
from auth import AccessContext
from pydantic import ValidationError
from fastapi import HTTPException

class MaterialTypes(unittest.TestCase):
 cleanup=foundation.PackagingFoundation.cleanup
 def setUp(self):
  foundation.PackagingFoundation.setUp(self)
  self.cur.execute("SET QUOTED_IDENTIFIER ON")
  for _ in range(2):
   for batch in re.split(r"^GO\s*$",(ROOT/"sql/53_packaging_material_type.sql").read_text(),flags=re.M|re.I):
    if batch.strip():
     self.cur.execute(batch)
     while self.cur.nextset():pass
  for batch in re.split(r'^GO\s*$',(ROOT/'sql/75_packaging_material_child_types.sql').read_text(),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
  self.name="MaterialType-"+uuid4().hex[:12]
  self.unit=self.cur.execute("SELECT TOP(1) UoMCode FROM dbo.UoM WHERE Status='Active' AND LEN(UoMCode)<=20").fetchval()
  self.types=[]
  self.parent=self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy) VALUES('Primary',?,'Count',0,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.name+'-parent',self.actor).fetchval()
  for order in ("Primary","Secondary"):
   self.types.append(self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy,ParentTypeID) VALUES(?,?,'Count',0,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",order,self.name,self.actor,self.parent).fetchval())
  @contextmanager
  def cursor():yield self.cur
  mock=patch.object(api,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
 def save(self,**values):
  data=dict(RowNum=1,Command="C",MaterialName=self.name,UnitOfMeasure=self.unit,**values)
  return api.material_save(api.MaterialBatch(rows=[data]),self.ctx)["results"][0]
 def update(self,saved,**values):
  data=dict(RowNum=1,Command="U",ID=saved["NewID"],RowVersion=saved["NewRowVersion"],MaterialName=self.name,UnitOfMeasure=self.unit)
  return api.material_save(api.MaterialBatch(rows=[{**data,**values}]),self.ctx)["results"][0]
 def current_type(self,id):
  return self.cur.execute("SELECT PackagingTypeID FROM dbo.PackagingMaterial WHERE ID=?",id).fetchval()
 def test_create_update_preserve_clear_and_block(self):
  created=self.save(PackagingTypeID=self.types[0]);self.assertEqual(created["Status"],"OK",created)
  self.assertRegex(created["NewMaterialCode"],r"^PKG-\d{10}$")
  kept=self.update(created,MaterialName=self.name+' renamed');self.assertEqual(kept["Status"],"OK",kept)
  self.assertEqual(self.current_type(created["NewID"]),self.types[0])
  changed=self.update(kept,PackagingTypeID=self.types[1]);self.assertEqual(changed["Status"],"OK",changed)
  self.assertEqual(self.current_type(created["NewID"]),self.types[1])
  cleared=self.update(changed,PackagingTypeID=None);self.assertEqual(cleared["Status"],"OK",cleared)
  self.assertIsNone(self.current_type(created["NewID"]))
  blocked=self.update(cleared,Command="D");self.assertEqual(blocked["Status"],"OK",blocked)
 def test_blocked_existing_assignment_survives_but_cannot_be_new(self):
  created=self.save(PackagingTypeID=self.types[0])
  self.cur.execute("UPDATE dbo.PackagingType SET Status='Block' WHERE ID=?",self.types[0])
  kept=self.update(created);self.assertEqual(kept["Status"],"OK",kept)
  self.assertEqual(self.current_type(created["NewID"]),self.types[0])
  self.assertEqual(self.save(PackagingTypeID=self.types[0])["Status"],"ERROR")
 def test_invalid_type_rolls_back_material_fields(self):
  created=self.save(PackagingTypeID=self.types[0])
  bad=self.update(created,PackagingTypeID=2147483647,MaterialName="Must not save")
  self.assertEqual(bad["Status"],"ERROR",bad)
  row=self.cur.execute("SELECT MaterialName,PackagingTypeID FROM dbo.PackagingMaterial WHERE ID=?",created["NewID"]).fetchone()
  self.assertEqual(tuple(row),(self.name,self.types[0]))
 def test_optional_assignment_stale_version_and_strict_schema(self):
  created=self.save();self.assertIsNone(self.current_type(created["NewID"]))
  self.update(created,PackagingTypeID=self.types[0])
  self.assertEqual(self.update(created,PackagingTypeID=self.types[1])["Status"],"ERROR")
  for value in (-1,0):
   with self.assertRaises(ValidationError):self.save(PackagingTypeID=value)
  with self.assertRaises(ValidationError):RawMaterialBatch(rows=[dict(RowNum=1,Command="C",PackagingTypeID=self.types[0])])
 def test_table_read_lookup_sort_and_raw_material_isolation(self):
  created=self.save(PackagingTypeID=self.types[1])
  data=masters.read("materials",1,25,self.name,None,None,None,None,None,json.dumps([dict(column="PackagingType",direction="asc")]),self.ctx)
  self.assertEqual(data["rows"][0]["PackagingType"],self.name)
  self.assertEqual(data["rows"][0]["PackagingTypeID"],self.types[1])
  self.assertEqual(len([r for r in masters.lookups(self.ctx,"materials")["packagingTypes"] if r["ID"] in self.types]),2)
  self.assertNotIn("PackagingType",excel.COLUMNS["raw-materials"])
  self.assertNotIn("PackagingType",excel.CONFIG["raw-materials"]["editable"])
 def test_excel_qualified_name_ambiguity_and_unrelated_edits(self):
  payload=excel.prepare("materials",excel.Edit(row=3,command="C",changes=dict(MaterialName=self.name,UnitOfMeasure=self.unit,PackagingType="Primary / "+self.name)),{},self.ctx)
  created=api.material_save(payload,self.ctx)["results"][0];self.assertEqual(created["Status"],"OK",created)
  source=excel.sources("materials",[created["NewID"]],self.ctx)[created["NewID"]]
  update=excel.prepare("materials",excel.Edit(row=3,command="U",id=created["NewID"],version=created["NewRowVersion"],changes={"MaterialName":self.name+' renamed'}),source,self.ctx)
  self.assertNotIn("PackagingTypeID",update.rows[0].model_fields_set)
  self.assertEqual(api.material_save(update,self.ctx)["results"][0]["Status"],"OK")
  self.assertEqual(self.current_type(created["NewID"]),self.types[0])
  with self.assertRaisesRegex(ValueError,"ambiguous"):
   excel.prepare("materials",excel.Edit(row=4,command="C",changes=dict(MaterialName=self.name,UnitOfMeasure=self.unit,PackagingType=self.name)),{},self.ctx)
 def test_excel_column_is_editable(self):
  body=excel.View(layout=dict(columns=["MaterialName","PackagingType"],filters=[]))
  blob=excel.build("materials",body,dict(rows=[],total=0),"http://localhost:8000")
  with zipfile.ZipFile(io.BytesIO(blob)) as z:
   text=z.read("xl/worksheets/sheet1.xml").decode()
   self.assertIn("Packaging Type",text)
   self.assertNotIn("Packaging Type [display]",text)
   self.assertNotIn('Description',text)
 def test_roots_and_non_leaf_children_rejected_and_description_preserved(self):
  self.assertEqual(self.save(PackagingTypeID=self.parent)['Status'],'ERROR')
  created=self.save(PackagingTypeID=self.types[0]);self.assertEqual(created['Status'],'OK')
  self.cur.execute("UPDATE dbo.PackagingMaterial SET Description='Historical description' WHERE ID=?",created['NewID'])
  created['NewRowVersion']=api.base64.b64encode(self.cur.execute('SELECT RowVersion FROM dbo.PackagingMaterial WHERE ID=?',created['NewID']).fetchval()).decode()
  kept=self.update(created);self.assertEqual(kept['Status'],'OK',kept)
  self.assertEqual(self.cur.execute('SELECT Description FROM dbo.PackagingMaterial WHERE ID=?',created['NewID']).fetchval(),'Historical description')
  self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy,ParentTypeID) VALUES('Primary',?,'Count',0,?,?)",self.name+'-grandchild',self.actor,self.types[0])
  self.assertEqual(self.save(PackagingTypeID=self.types[0])['Status'],'ERROR')
  self.assertEqual(self.update(kept)['Status'],'OK')
 def test_roles(self):
  for role in ("Packaging","PackagingManager"):
   name="material-role-"+uuid4().hex[:12]
   actor=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",name).fetchval()
   self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)",actor,role)
   ctx=AccessContext(actor,name,frozenset({role}))
   self.assertIn("packagingTypes",masters.lookups(ctx,"materials"))
   body=api.MaterialBatch(rows=[dict(RowNum=1,Command="C",MaterialName=self.name,UnitOfMeasure=self.unit,PackagingTypeID=self.types[0])])
   if role=="Packaging":self.assertEqual(api.material_save(body,ctx)["results"][0]["Status"],"OK")
   else:
    with self.assertRaises(HTTPException) as caught:api.material_save(body,ctx)
    self.assertEqual(caught.exception.status_code,403)

if __name__=="__main__":unittest.main()
