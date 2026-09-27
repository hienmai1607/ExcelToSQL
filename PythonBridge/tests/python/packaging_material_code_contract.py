"""Auto-code SQL contracts; all material fixtures roll back."""
import sys,unittest
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import pyodbc
from packaging_fields import consume
class Codes(unittest.TestCase):
 def setUp(self):
  self.conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  self.addCleanup(self.cleanup);self.c=self.conn.cursor();self.c.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
  self.user=self.c.execute("SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchval()
 def cleanup(self):
  try:self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.conn.close()
 def create(self,code=None):
  self.c.execute("""DECLARE @r dbo.PackagingMaterialBatchType;
   INSERT @r(RowNum,Command,MaterialCode,MaterialName,UnitOfMeasure) VALUES(1,'C',?,?,'EA');
   EXEC dbo.usp_PackagingMaterial_Batch @r,?;""",code,"Auto code "+uuid4().hex,self.user)
  return consume(self.c)[0][0]
 def update(self,r,code=None,token=None):
  self.c.execute("""DECLARE @r dbo.PackagingMaterialBatchType;
   INSERT @r(RowNum,Command,ID,RowVersionB64,MaterialCode,MaterialName,UnitOfMeasure)
   VALUES(1,'U',?,?,?,'Updated material','EA');
   EXEC dbo.usp_PackagingMaterial_Batch @r,?;""",r["NewID"],token or r["NewRowVersion"],code,self.user)
  return consume(self.c)[0][0]
 def test_unique_generated_codes(self):
  a,b=self.create(),self.create()
  self.assertEqual(a["Status"],"OK",a)
  self.assertRegex(a["NewMaterialCode"],r"^PKG-\d{10}$")
  self.assertNotEqual(a["NewMaterialCode"],b["NewMaterialCode"])
 def test_manual_create_rejected(self):
  self.assertEqual(self.create("MANUAL")["Status"],"ERROR")
 def test_update_preserves_code(self):
  r=self.create();u=self.update(r)
  self.assertEqual(u["Status"],"OK",u)
  self.assertEqual(u["NewMaterialCode"],r["NewMaterialCode"])
 def test_code_change_rejected(self):
  r=self.create();self.assertEqual(self.update(r,"OTHER")["Status"],"ERROR")
 def test_stale_update_rejected(self):
  r=self.create();self.update(r)
  self.assertEqual(self.update(r)["Status"],"ERROR")
if __name__=="__main__":unittest.main()
