"""Read-only grade-copy integration checks using rollback-only fixtures."""
import unittest,base64
from uuid import uuid4
from final_grade_contract import FinalGrades
from product_grades import GradeSave
from fastapi import HTTPException
import product_grades_api as products

class GradeCopy(unittest.TestCase):
 setUp=FinalGrades.setUp
 cleanup=FinalGrades.cleanup
 grade=FinalGrades.grade
 material=FinalGrades.material

 def source(self,status='Active'):
  grade=self.grade(True);material=self.material(grade['NewID'])
  self.assertEqual(material['Status'],'OK',material)
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active'").fetchval()
  product=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?,'Copy source',400,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",'GC-'+uuid4().hex[:12],customer,self.ctx.user_id).fetchval()
  token=base64.b64encode(self.cur.execute('SELECT RowVersion FROM dbo.Product WHERE ID=?',product).fetchval()).decode()
  items=[dict(ParentID='0',ID=1,Grade='source',RawGradeID=grade['NewID'],RawMaterialID=material['NewID'],RatioPct='100')]
  version=products.save(GradeSave(ProductRowVersion=token,Status=status,items=items),product,self.ctx)['ID']
  return product,version,grade['NewID'],material['NewID']

 def test_copy_is_complete_and_read_only(self):
  product,version,grade,material=self.source()
  before=self.cur.execute('SELECT RowVersion FROM dbo.Product WHERE ID=?',product).fetchval()
  result=products.grade_copy(product,self.ctx)
  self.assertEqual(result['product']['ID'],product)
  self.assertEqual(result['product']['Version'],1)
  self.assertEqual(result['items'][0]['RawGradeID'],grade)
  self.assertEqual(result['items'][0]['RawMaterialID'],material)
  self.assertEqual(str(result['items'][0]['RatioPct']),'100.00')
  self.assertNotIn('VersionID',result['items'][0])
  self.assertEqual(before,self.cur.execute('SELECT RowVersion FROM dbo.Product WHERE ID=?',product).fetchval())
  self.assertIn(product,[r['ID'] for r in products.grade_copy_sources(self.ctx)['rows']])
 def test_draft_versions_are_not_copy_sources(self):
  product,version,grade,material=self.source('Draft')
  self.assertNotIn(product,[r['ID'] for r in products.grade_copy_sources(self.ctx)['rows']])
  with self.assertRaises(HTTPException) as error:products.grade_copy(product,self.ctx)
  self.assertEqual(error.exception.status_code,404)
 def test_blocked_product_is_not_a_copy_source(self):
  product,version,grade,material=self.source()
  self.cur.execute("UPDATE dbo.Product SET Status='Block' WHERE ID=?",product)
  self.assertNotIn(product,[r['ID'] for r in products.grade_copy_sources(self.ctx)['rows']])
  with self.assertRaises(HTTPException):products.grade_copy(product,self.ctx)
