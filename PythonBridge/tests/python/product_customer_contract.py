"""SQL ownership integration tests; all business fixtures roll back."""
import json
import sys
import unittest
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import pyodbc
from packaging_fields import consume

class Ownership(unittest.TestCase):
 def setUp(self):
  self.conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  self.addCleanup(self.cleanup)
  self.c=self.conn.cursor()
  self.c.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
  self.actor,self.user=self.c.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID").fetchone()
  customers=self.c.execute("SELECT TOP(2) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchall()
  self.a,self.b=[r[0] for r in customers]
 def cleanup(self):
  try:self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.conn.close()
 def product(self,customer):
  self.c.execute("""DECLARE @r dbo.ProductBatchType;
   INSERT @r(RowNum,Command,ProductName,WeightValue,WeightUnit) VALUES(1,'C',?,100,'g');
   EXEC dbo.usp_Product_Batch @r,?,0,?;""","Owner test "+uuid4().hex,self.user,customer)
  return consume(self.c)[0][0]
 def opportunity(self,customer):
  self.c.execute("""INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,CreatedBy)
   VALUES(?,?,'Ownership test','2026-09-01','2026-10-01',?); SELECT CONVERT(INT,SCOPE_IDENTITY());""","T-"+uuid4().hex[:16],customer,self.actor)
  return self.c.fetchval()
 def item(self,opp,product):
  self.c.execute("""INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,CreatedBy)
   VALUES(?,?,'Ownership test',100,?);""",opp,product,self.actor)
 def test_product_requires_customer(self):
  r=self.product(None)
  self.assertEqual(r["Status"],"ERROR")
  self.assertIn("Customer is required",r["Message"])
 def test_matching_customer_allowed(self):
  r=self.product(self.a)
  self.assertEqual(r["Status"],"OK",r)
  self.item(self.opportunity(self.a),r["NewID"])
 def test_cross_customer_rejected(self):
  r=self.product(self.a)
  with self.assertRaisesRegex(pyodbc.Error,"Product must belong"):
   self.item(self.opportunity(self.b),r["NewID"])
 def test_product_owner_cannot_change_after_use(self):
  r=self.product(self.a);self.item(self.opportunity(self.a),r["NewID"])
  with self.assertRaisesRegex(pyodbc.Error,"Customer cannot change"):
   self.c.execute("UPDATE dbo.Product SET CustomerID=? WHERE ID=?",self.b,r["NewID"])
 def test_header_customer_cannot_bypass_rule(self):
  r=self.product(self.a);opp=self.opportunity(self.a);self.item(opp,r["NewID"])
  with self.assertRaisesRegex(pyodbc.Error,"Customer cannot change"):
   self.c.execute("UPDATE dbo.Opportunity SET CustomerID=? WHERE ID=?",self.b,opp)
 def test_partial_excel_update_and_rowversion(self):
  r=self.product(self.a)
  self.c.execute("EXEC dbo.usp_Product_Fields_Save ?,?,?,?,0",self.user,r["NewID"],r["NewRowVersion"],json.dumps({"CustomerID":self.b}))
  consume(self.c)
  self.assertEqual(self.c.execute("SELECT CustomerID FROM dbo.Product WHERE ID=?",r["NewID"]).fetchval(),self.b)
  with self.assertRaisesRegex(pyodbc.Error,"Concurrency conflict"):
   self.c.execute("EXEC dbo.usp_Product_Fields_Save ?,?,?,?,0",self.user,r["NewID"],r["NewRowVersion"],'{"CustomerID":1}')
 def test_api_rejects_cross_customer_document(self):
  from contextlib import contextmanager
  from unittest.mock import patch
  import packaging_fields
  from main import opportunity_batch
  from schemas import OpportunityBatchRequest
  product=self.product(self.a)["NewID"]
  currency=self.c.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
  key="T-"+uuid4().hex[:16]
  body=OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command="C",OpportunityNumber=key,CustomerID=self.b,OpportunityDesc="API ownership",BidOpen="2026-09-01",BidClose="2026-10-01",CurrencyID=currency,ExchangeRateToVND=1)],item_rows=[dict(RowNum=2,Command="C",OpportunityNumber=key,ProductID=product,ItemDescription="Test",AnnualUnit=100)])
  @contextmanager
  def cursor():yield self.c
  with patch.object(packaging_fields,"get_raw_cursor",cursor):
   result=opportunity_batch(body,self.user,True,frozenset({"Admin"}))
  results=result["header_results"]+result["item_results"]
  self.assertTrue(results)
  self.assertTrue(all(r["Status"]=="ERROR" for r in results),result)
  self.assertIn("Product must belong",str(result))
 def test_lookup_excludes_unassigned(self):
  self.c.execute("EXEC dbo.usp_OpportunityProductLookup_Read ?",self.user)
  rows=consume(self.c)[0]
  self.assertTrue(all(r["CustomerID"] is not None for r in rows))
if __name__=="__main__":unittest.main()
