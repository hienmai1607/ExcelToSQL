"""Product Mix SQL/API tests; business data is rolled back."""
import sys,json,unittest
from pathlib import Path
from uuid import uuid4
from contextlib import contextmanager
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import pyodbc
from packaging_fields import consume
from product_mix_api import MixSave
from pydantic import ValidationError

class MixContracts(unittest.TestCase):
 def test_mix_cannot_save_own_grade(self):
  with self.assertRaisesRegex(pyodbc.Error,"cannot maintain its own grades"):
   self.c.execute("EXEC dbo.usp_ProductGrade_Save ?,?,NULL,NULL,?,'Active',?",self.parent,self.user,self.token(self.parent),json.dumps([dict(ParentID="0",ID=1,Grade="Invalid parent grade",RatioPct=100)]))
 def test_child_grade_read_is_active_only(self):
  self.save()
  self.c.execute("EXEC dbo.usp_ProductGrade_Save ?,?,NULL,NULL,?,'Active',?",self.child,self.user,self.token(self.child),json.dumps([dict(ParentID="0",ID=1,Grade="Child active grade",RatioPct=100)]))
  consume(self.c)
  self.c.execute("EXEC dbo.usp_ProductGrade_Save ?,?,NULL,NULL,?,'Draft',?",self.child,self.user,self.token(self.child),json.dumps([dict(ParentID="0",ID=1,Grade="Hidden draft",RatioPct=100)]))
  consume(self.c)
  self.c.execute("EXEC dbo.usp_ProductMix_Grades_Read ?,?",self.parent,self.user)
  sets=consume(self.c)
  self.assertEqual(len(sets[2]),1)
  self.assertEqual(sets[2][0]["ProductID"],self.child)
  self.assertEqual(sets[2][0]["Grade"],"Child active grade")
 def test_child_without_active_grades_is_still_returned(self):
  self.save()
  self.c.execute("EXEC dbo.usp_ProductMix_Grades_Read ?,?",self.parent,self.user)
  rows=consume(self.c)[2]
  self.assertEqual(rows[0]["ProductID"],self.child)
  self.assertIsNone(rows[0]["GradeVersion"])
 def test_new_mix_cannot_embed_grade(self):
  from schemas import ProductBatchRequest
  with self.assertRaises(ValidationError):
   ProductBatchRequest(rows=[dict(RowNum=1,Command="C",IsMix=True,GradeVersion=dict(items=[dict(ParentID="0",ID=1,Grade="A",RatioPct=100)]))])
 def test_schema_rejects_duplicates_and_zero(self):
  for items in ([dict(ProductID=1,UnitQuantity=0,RowVersion="x")],[dict(ProductID=1,UnitQuantity=1,RowVersion="x")]*2):
   with self.assertRaises(ValidationError):MixSave(ProductRowVersion="x",items=items)
 def setUp(self):
  self.conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  self.addCleanup(self.cleanup);self.c=self.conn.cursor();self.c.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
  self.actor,self.user=self.c.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID").fetchone()
  self.customer=self.c.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchval()
  self.parent=self.product(True,0);self.child=self.product(False,100)
 def cleanup(self):
  try:self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.conn.close()
 def product(self,mix,weight):
  self.c.execute("INSERT dbo.Product(ProductCode,ProductName,CustomerID,WeightGrams,IsMix,CreatedBy) VALUES(?,?,?,?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())","T-"+uuid4().hex[:16],"Mix test "+uuid4().hex,self.customer,weight,mix,self.actor)
  return self.c.fetchval()
 def token(self,id):
  return self.c.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",id).fetchval()
 def save(self,status="Active",version=None,items=None):
  body=items or [dict(ProductID=self.child,UnitQuantity="2.5",RowVersion="0x"+self.token(self.child).hex())]
  self.c.execute("EXEC dbo.usp_ProductMix_Save ?,?,?,?,?,?,?",self.parent,self.user,version["ID"] if version else None,version["RowVersion"] if version else None,self.token(self.parent),status,json.dumps(body))
  return consume(self.c)[0][0]
 def test_activate_weight_and_single_active(self):
  a=self.save();self.assertEqual(float(self.c.execute("SELECT WeightGrams FROM dbo.Product WHERE ID=?",self.parent).fetchval()),250)
  b=self.save()
  self.assertNotEqual(a["ID"],b["ID"])
  self.assertEqual(self.c.execute("SELECT COUNT(*) FROM dbo.ProductMixVersion WHERE ProductID=? AND Status='Active'",self.parent).fetchval(),1)
 def test_draft_does_not_update_weight(self):
  self.save("Draft")
  self.assertEqual(self.c.execute("SELECT WeightGrams FROM dbo.Product WHERE ID=?",self.parent).fetchval(),0)
 def test_child_weight_recalculates_parent(self):
  self.save();old=self.token(self.parent)
  self.c.execute("UPDATE dbo.Product SET WeightGrams=120 WHERE ID=?",self.child)
  self.assertEqual(float(self.c.execute("SELECT WeightGrams FROM dbo.Product WHERE ID=?",self.parent).fetchval()),300)
  self.assertNotEqual(old,self.token(self.parent))
 def test_manual_weight_rejected(self):
  self.save()
  with self.assertRaisesRegex(pyodbc.Error,"calculated"):
   self.c.execute("UPDATE dbo.Product SET WeightGrams=99 WHERE ID=?",self.parent)
 def test_nested_mix_rejected(self):
  other=self.product(True,0)
  with self.assertRaisesRegex(pyodbc.Error,"Nested mixes"):
   self.save(items=[dict(ProductID=other,UnitQuantity=1,RowVersion="0x"+self.token(other).hex())])
 def test_customer_mismatch_rejected(self):
  other=self.c.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE ID<>? AND Status='Active'",self.customer).fetchval()
  self.c.execute("UPDATE dbo.Product SET CustomerID=? WHERE ID=?",other,self.child)
  with self.assertRaisesRegex(pyodbc.Error,"same Customer"):self.save()
 def test_active_version_immutable(self):
  a=self.save()
  with self.assertRaisesRegex(pyodbc.Error,"Create a new version"):self.save(version=a)
 def test_child_concurrency(self):
  stale=self.token(self.child);self.c.execute("UPDATE dbo.Product SET WeightGrams=101 WHERE ID=?",self.child)
  with self.assertRaisesRegex(pyodbc.Error,"child Product changed"):
   self.save(items=[dict(ProductID=self.child,UnitQuantity=1,RowVersion="0x"+stale.hex())])
 def test_api_create_mix_without_manual_weight(self):
  import packaging_fields
  from schemas import ProductBatchRequest
  from main import product_batch
  @contextmanager
  def cursor():yield self.c
  with patch.object(packaging_fields,"get_raw_cursor",cursor):
   result=product_batch(ProductBatchRequest(rows=[dict(RowNum=1,Command="C",ProductName="API mix "+uuid4().hex,Category="Test",CustomerID=self.customer,IsMix=True)]),self.user,True,frozenset({"Admin"}))
  self.assertEqual(result["results"][0]["Status"],"OK",result)
 def test_mix_cannot_become_nested_child_after_save(self):
  self.save()
  with self.assertRaisesRegex(pyodbc.Error,"normal Product"):
   self.c.execute("UPDATE dbo.Product SET IsMix=1,WeightGrams=0 WHERE ID=?",self.child)
if __name__=="__main__":unittest.main()
