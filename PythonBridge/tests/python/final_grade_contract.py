"""Final-grade integration tests against the current schema; all writes roll back."""
import sys,base64,json,unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from db import get_raw_cursor
from packaging_fields import consume
from auth import AccessContext
import packaging_api as batches
import raw_material_api as raw
import product_grades_api as products
from product_grades import GradeSave
from opportunity_grade_snapshot import validate_snapshot

class FinalGrades(unittest.TestCase):
 def setUp(self):
  self.connection=get_raw_cursor();self.cur=self.connection.__enter__();self.addCleanup(self.cleanup)
  self.cur.execute('SET NOCOUNT ON; BEGIN TRANSACTION')
  actor,user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1").fetchone()
  self.ctx=AccessContext(actor,user,frozenset({'Admin'}))
  def execute(sql,args):
   self.cur.execute(sql,*args);sets=consume(self.cur)
   for rows in sets:
    for row in rows:
     for key,value in list(row.items()):
      if isinstance(value,(bytes,bytearray)):row[key]=base64.b64encode(value).decode()
   return sets
  for module in [batches,products]:
   p=patch.object(module,'execute',execute);p.start();self.addCleanup(p.stop)
 def cleanup(self):
  try:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  finally:self.connection.__exit__(None,None,None)
 def grade(self,final=False,parent=None):
  result=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command='C',GradeName='Final-'+uuid4().hex[:12],FinalGrade=final,ParentGradeID=parent)]),self.ctx)['results'][0]
  return result
 def material(self,grade):
  return raw.material_save(raw.RawMaterialBatch(rows=[dict(RowNum=1,Command='C',MaterialName='Final regression',UnitOfMeasure='EA',GradeID=grade)]),self.ctx)['results'][0]
 def test_root_final_grade_links_directly_to_material_and_snapshot(self):
  grade=self.grade(True);self.assertEqual(grade['Status'],'OK',grade)
  material=self.material(grade['NewID']);self.assertEqual(material['Status'],'OK',material)
  snapshot={'items':[dict(ParentID='0',ID=1,RawGradeID=grade['NewID'],RawMaterialID=material['NewID'],Grade='ignored',RatioPct='100')]}
  validate_snapshot(self.cur,snapshot)
  self.assertEqual(snapshot['items'][0]['RawMaterialName'],'Final regression')
 def test_nonfinal_grade_cannot_be_assigned_material_even_without_children(self):
  grade=self.grade();self.assertEqual(grade['Status'],'OK',grade)
  result=self.material(grade['NewID'])
  self.assertEqual(result['Status'],'ERROR',result)
  self.assertIn('final grade',result['Message'].lower())
 def test_final_grade_cannot_have_child(self):
  parent=self.grade(True);self.assertEqual(parent['Status'],'OK',parent)
  result=self.grade(True,parent['NewID'])
  self.assertEqual(result['Status'],'ERROR',result)
 def test_parent_with_children_cannot_be_final(self):
  parent=self.grade();child=self.grade(True,parent['NewID']);self.assertEqual(child['Status'],'OK',child)
  result=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command='U',ID=parent['NewID'],RowVersion=parent['NewRowVersion'],GradeName='Parent',FinalGrade=True)]),self.ctx)['results'][0]
  self.assertEqual(result['Status'],'ERROR',result)
 def test_assigned_final_grade_cannot_be_unchecked(self):
  grade=self.grade(True);self.assertEqual(self.material(grade['NewID'])['Status'],'OK')
  result=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command='U',ID=grade['NewID'],RowVersion=grade['NewRowVersion'],GradeName='Still final',FinalGrade=False)]),self.ctx)['results'][0]
  self.assertEqual(result['Status'],'ERROR',result)
 def test_snapshot_rejects_material_on_nonfinal_grade(self):
  grade=self.grade(False);self.assertEqual(grade['Status'],'OK')
  snapshot={'items':[dict(ParentID='0',ID=1,RawGradeID=grade['NewID'],RawMaterialID=2147483647,Grade='ignored',RatioPct='100')]}
  with self.assertRaisesRegex(ValueError,'final grade'):validate_snapshot(self.cur,snapshot)
 def test_omitted_flag_preserves_existing_final_grade_on_update(self):
  grade=self.grade(True);self.assertEqual(grade['Status'],'OK')
  result=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command='U',ID=grade['NewID'],RowVersion=grade['NewRowVersion'],GradeName='Still final')]),self.ctx)['results'][0]
  self.assertEqual(result['Status'],'OK',result)
  self.assertTrue(self.cur.execute('SELECT FinalGrade FROM dbo.RawGrade WHERE ID=?',grade['NewID']).fetchval())
 def test_root_final_material_saves_in_product_version(self):
  grade=self.grade(True);material=self.material(grade['NewID']);self.assertEqual(material['Status'],'OK',material)
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active'").fetchval()
  if customer is None:self.skipTest('Active customer needed')
  product=self.cur.execute('INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?,?,100,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())','FG-'+uuid4().hex[:12],'Final-grade product',customer,self.ctx.user_id).fetchval()
  version=base64.b64encode(self.cur.execute('SELECT RowVersion FROM dbo.Product WHERE ID=?',product).fetchval()).decode()
  items=[dict(ParentID='0',ID=1,RawGradeID=grade['NewID'],RawMaterialID=material['NewID'],Grade='Root',RatioPct=100)]
  result=products.save(GradeSave(ProductRowVersion=version,Status='Draft',items=items),product,self.ctx)
  self.assertGreater(result['ID'],0)
  self.assertEqual(self.cur.execute('SELECT RawMaterialID FROM dbo.ProductGradeItem WHERE VersionID=?',result['ID']).fetchval(),material['NewID'])
