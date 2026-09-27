"""USD rate writes, customer reference and audit tests; fixtures roll back."""
import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import vendor_contract as fixtures
from opportunity_views import sorted_grid
import pyodbc

class OpportunityRates(unittest.TestCase):
 setUpBase=fixtures.VendorContracts.setUp
 cleanup=fixtures.VendorContracts.cleanup
 def setUp(self):
  self.setUpBase()
  self.customer=self.c.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE CurrencyID IS NOT NULL AND Status='Active'").fetchval()
  self.opp=self.c.execute("INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy) VALUES('RATE-'+LEFT(CONVERT(VARCHAR(36),NEWID()),15),?,'Rates','2026-09-01','2026-10-01','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.customer,self.ctx.user_id).fetchval()
 def save(self,version=None,**fields):
  version=version or self.c.execute("SELECT RowVersion FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval()
  self.c.execute("EXEC dbo.usp_Opportunity_Fields_Save ?,?,?,?,0",self.ctx.username,self.opp,version,json.dumps(fields))
  result=self.c.fetchone()[0]
  while self.c.nextset():pass
  return result
 def test_two_rates_and_audit(self):
  self.save(ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1)
  r=self.c.execute("SELECT ExchangeRateVNDPerUSD,ExchangeRateCustomerCurrencyPerUSD,RateCustomerCurrencyID FROM dbo.Opportunity WHERE ID=?",self.opp).fetchone()
  self.assertEqual(r[0],25000);self.assertEqual(r[1],1)
  self.assertEqual(r[2],self.c.execute("SELECT CurrencyID FROM dbo.Customer WHERE ID=?",self.customer).fetchval())
  fields={x[0] for x in self.c.execute("SELECT FieldName FROM dbo.OpportunityChangeLog WHERE OpportunityID=? AND ChangedBy=?",self.opp,self.ctx.username)}
  self.assertTrue({"ExchangeRateVNDPerUSD","ExchangeRateCustomerCurrencyPerUSD"}<=fields)
 def test_stale_version_rejected(self):
  old=self.c.execute("SELECT RowVersion FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval()
  self.save(ExchangeRateVNDPerUSD=25000)
  with self.assertRaises(pyodbc.Error):self.save(old,ExchangeRateVNDPerUSD=26000)
 def test_customer_currency_is_joined_and_changed_currency_hides_stale_rate(self):
  self.save(ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1)
  number=self.c.execute("SELECT OpportunityNumber FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval()
  def read():return sorted_grid(self.ctx.username,1,25,"[]",opportunity_number=number)["rows"][0]
  self.assertIsNotNone(read()["CustomerCurrencyCode"])
  other=self.c.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE ID<>(SELECT CurrencyID FROM dbo.Customer WHERE ID=?)",self.customer).fetchval()
  self.c.execute("UPDATE dbo.Customer SET CurrencyID=? WHERE ID=?",other,self.customer)
  self.assertIsNone(read()["ExchangeRateCustomerCurrencyPerUSD"])
 def test_processing_header_cannot_edit_rates(self):
  self.c.execute("UPDATE dbo.Opportunity SET Stage='In progress' WHERE ID=?",self.opp)
  with self.assertRaises(pyodbc.Error):self.save(ExchangeRateVNDPerUSD=25000)
if __name__=="__main__":unittest.main()
