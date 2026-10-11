"""Category Master against local SQL Server. All test changes roll back."""
import sys, unittest, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
from db import get_raw_cursor, DB_SERVER, DB_NAME

class CategorySQL(unittest.TestCase):
 def setUp(self):
  if DB_SERVER.lower() not in {"localhost",".","desktop-5bgmjsc"} or DB_NAME.lower()!="test":
   raise RuntimeError("Category SQL tests are restricted to the local test database.")
  self.context=get_raw_cursor();self.cur=self.context.__enter__()
  self.cur.execute("BEGIN TRANSACTION")
  self.addCleanup(self.cleanup)
  self.apply()
  self.actor=self.cur.execute("SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID").fetchval()
  self.product=self.cur.execute("SELECT TOP(1) ID FROM dbo.Product ORDER BY ID").fetchval()
  if not self.actor or not self.product:self.skipTest("Requires an active Admin and existing Product.")
 def cleanup(self):
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  self.context.__exit__(None,None,None)
 def apply(self):
  for batch in re.split(r"^GO\s*$",(ROOT/"sql/97_product_category_master.sql").read_text(),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
 def create(self,name):
  row=self.cur.execute("EXEC dbo.usp_ProductCategory_Save ?,NULL,NULL,?,'Active'",self.actor,name).fetchone()
  while self.cur.nextset():pass
  return row.ID,bytes(row.RowVersion)
 def test_seed_and_repeat_preserve_product_values(self):
  before=[tuple(r) for r in self.cur.execute("SELECT ID,Category FROM dbo.Product ORDER BY ID").fetchall()]
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.Product p WHERE NULLIF(LTRIM(RTRIM(Category)),N'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.ProductCategory c WHERE c.CategoryName=LTRIM(RTRIM(p.Category)) COLLATE Latin1_General_100_CI_AS)").fetchval(),0)
  self.apply()
  self.assertEqual(before,[tuple(r) for r in self.cur.execute("SELECT ID,Category FROM dbo.Product ORDER BY ID").fetchall()])
 def test_blocked_category_retained_but_not_reactivated_on_repeat(self):
  id,rv=self.create("Category regression blocked")
  self.cur.execute("UPDATE dbo.Product SET Category=? WHERE ID=?","Category regression blocked",self.product)
  self.cur.execute("EXEC dbo.usp_ProductCategory_Save ?,?,?,?,'Block'",self.actor,id,rv,"Category regression blocked")
  while self.cur.nextset():pass
  self.cur.execute("UPDATE dbo.Product SET Category=Category WHERE ID=?",self.product)
  self.apply()
  self.assertEqual(self.cur.execute("SELECT Status FROM dbo.ProductCategory WHERE ID=?",id).fetchval(),"Block")
 def test_unknown_category_rejected(self):
  with self.assertRaises(Exception) as error:self.cur.execute("UPDATE dbo.Product SET Category=? WHERE ID=?","Unknown regression category",self.product)
  self.assertIn("Choose an active Category",str(error.exception))
 def test_new_assignment_of_blocked_category_rejected(self):
  id,rv=self.create("Category regression blocked")
  self.cur.execute("EXEC dbo.usp_ProductCategory_Save ?,?,?,?,'Block'",self.actor,id,rv,"Category regression blocked")
  while self.cur.nextset():pass
  with self.assertRaises(Exception) as error:self.cur.execute("UPDATE dbo.Product SET Category=? WHERE ID=?","Category regression blocked",self.product)
  self.assertIn("Choose an active Category",str(error.exception))
 def test_duplicate_case_insensitive(self):
  self.create("Category regression duplicate")
  with self.assertRaises(Exception) as error:self.create("category regression duplicate")
  self.assertIn("already exists",str(error.exception))
 def test_stale_version(self):
  id,rv=self.create("Category regression version")
  with self.assertRaises(Exception) as error:self.cur.execute("EXEC dbo.usp_ProductCategory_Save ?,?,?,?,'Block'",self.actor,id,b"\x00"*8,"Category regression version")
  self.assertIn("changed. Refresh",str(error.exception))
 def test_used_category_rename_rejected(self):
  id,rv=self.create("Category regression used")
  self.cur.execute("UPDATE dbo.Product SET Category=? WHERE ID=?","Category regression used",self.product)
  with self.assertRaises(Exception) as error:self.cur.execute("EXEC dbo.usp_ProductCategory_Save ?,?,?,?,'Active'",self.actor,id,rv,"Category regression renamed")
  self.assertIn("used by Products",str(error.exception))
if __name__=="__main__":unittest.main()
