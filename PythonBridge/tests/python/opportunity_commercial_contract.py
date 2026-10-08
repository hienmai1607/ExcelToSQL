"""Rollback-only SQL contracts for Opportunity grade snapshots and master quote selection."""
import sys,json,unittest,re
from pathlib import Path
from decimal import Decimal
from contextlib import contextmanager
from unittest.mock import patch
import pyodbc
from fastapi import HTTPException
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from auth import AccessContext
import tcb_api,packaging_api

class OpportunityCommercialSQL(unittest.TestCase):
 def setUp(self):
  self.conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  self.cur=self.conn.cursor()
  self.cur.execute("SET NOCOUNT ON;BEGIN TRANSACTION")
  for batch in re.split(r"^GO\s*$",(Path(__file__).resolve().parents[2]/"sql/96_tcb_direct_grade_prices.sql").read_text(),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  actor,username=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID").fetchone()
  self.ctx=AccessContext(actor,username,frozenset({"Admin"}))
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchval()
  self.product=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES('CM-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),'Commercial regression',150,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",customer,actor).fetchval()
  opp=self.cur.execute("INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy) VALUES('CM-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),?,'Commercial regression','2026-10-01','2026-10-30','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",customer,actor).fetchval()
  self.item=self.cur.execute("INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy) VALUES(?,?,'Commercial regression',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",opp,self.product,actor).fetchval()
  root=self.cur.execute("INSERT dbo.RawGrade(GradeName,CreatedBy) VALUES('CM root',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",actor).fetchval()
  leaf=self.cur.execute("INSERT dbo.RawGrade(GradeName,ParentGradeID,CreatedBy) VALUES('CM leaf',?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",root,actor).fetchval()
  material=self.cur.execute("INSERT dbo.RawMaterial(MaterialCode,MaterialName,UnitOfMeasure,GradeID,CreatedBy) VALUES('CM-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),'Commercial nuts','KG',?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",leaf,actor).fetchval()
  currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  self.price=self.cur.execute("INSERT dbo.RawMaterialPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,ExchangeRateToUSD,EffectiveFrom,CreatedBy) VALUES(?,?,'KG',0,10,1,'2020-01-01',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",material,currency,actor).fetchval()
  version=self.cur.execute("SELECT CONVERT(VARCHAR(18),CONVERT(VARBINARY(8),RowVersion),1) FROM dbo.RawMaterialPrice WHERE ID=?",self.price).fetchval()
  self.tree={"items":[dict(ParentID="0",ID=1,RawGradeID=root,Grade="untrusted root",RatioPct="100"),dict(ParentID="0/1",ID=1,RawGradeID=leaf,Grade="untrusted leaf",RatioPct="100",RawMaterialID=material)]}
  self.selection=dict(Path="0/1/1",PriceID=self.price,PriceVersion=version,ExpectedUSDPerLb="4.5359237")
  self.product_version=self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval()
  @contextmanager
  def cursor():
   c=self.conn.cursor()
   try:yield c
   finally:c.close()
  for module in (tcb_api,packaging_api):
   mocked=patch.object(module,"get_raw_cursor",cursor);mocked.start();self.addCleanup(mocked.stop)
  quote=tcb_api.current_prices([{"RawGradeID":leaf}],self.ctx)[0]
  self.expected=Decimal(quote["USDPerLb"])
  self.selection["ExpectedUSDPerLb"]=str(self.expected)
 def tearDown(self):
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  self.conn.close()
 def body(self,prices=None,grades=True):
  row=tcb_api.item_read(self.item,self.ctx)
  return tcb_api.CommercialSave(RowVersion=row["RowVersion"],Grades=self.tree if grades else None,Prices=[self.selection] if prices is None else prices)
 def test_atomic_grade_and_price_save_without_master_mutation(self):
  result=tcb_api.commercial_save(self.body(),self.item,self.ctx)
  value=json.loads(self.cur.execute("SELECT ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
  self.assertEqual(value["items"][0]["Grade"],"CM root")
  self.assertEqual(value["items"][1]["Grade"],"CM leaf")
  self.assertEqual(Decimal(result["saved"]["RMCostUSDPerLb"]),self.expected)
  self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval(),self.product_version)
  self.assertEqual(self.cur.execute("SELECT UnitPrice FROM dbo.RawMaterialPrice WHERE ID=?",self.price).fetchval(),Decimal(10))
  self.assertEqual(tcb_api.item_read(self.item,self.ctx)["RowVersion"],result["RowVersion"])
 def test_grade_only_clears_quotes_and_cost_until_reselected(self):
  tcb_api.commercial_save(self.body(),self.item,self.ctx)
  result=tcb_api.commercial_save(self.body(prices=[]),self.item,self.ctx)
  self.assertEqual(result["saved"]["Inputs"]["Prices"],[])
  self.assertIsNone(result["saved"]["RMCostUSDPerLb"])
  self.assertIsNone(result["saved"]["ProductUSDPerLb"])
 def test_quote_conversion_or_version_change_is_rejected(self):
  body=self.body()
  self.cur.execute("UPDATE dbo.RawMaterialPrice SET UnitPrice=11 WHERE ID=?",self.price)
  with self.assertRaises(HTTPException) as caught:tcb_api.commercial_save(body,self.item,self.ctx)
  self.assertEqual(caught.exception.status_code,422)
 def test_active_request_grade_lock_keeps_price_selection_available(self):
  item=tcb_api.item_read(self.item,self.ctx)
  item["ProductGradeSnapshot"]=json.dumps(self.tree)
  item["HasOpenPackagingRequest"]=True
  with self.assertRaises(HTTPException) as caught:tcb_api.commercial_value(self.body(),item,self.ctx,self.cur)
  self.assertEqual(caught.exception.status_code,409)
  value,_,_,_=tcb_api.commercial_value(self.body(grades=False),item,self.ctx,self.cur)
  self.assertEqual(Decimal(value["RMCostUSDPerLb"]),self.expected)
 def test_existing_composition_and_pallet_inputs_preserved(self):
  old={"RMRatio":"95","SeasoningRatio":"0","OilPct":"5","OilUSDPerLb":"0.74","ProcessingUSDPerLb":"0.10","PalletUSDPerEA":"15"}
  self.cur.execute("UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?",json.dumps({"Inputs":old}),self.item)
  body=self.body()
  body.Inputs=tcb_api.Inputs(LossProcesses=[],ProductLossFormula=None)
  result=tcb_api.commercial_save(body,self.item,self.ctx)["saved"]
  for key,val in old.items():self.assertEqual(Decimal(result["Inputs"][key]),Decimal(val))
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),self.expected*Decimal(".95")+Decimal(".037") + Decimal(".10"))
 def test_invalid_master_parent_mapping_rejected(self):
  body=self.body()
  body.Grades.items[1].RawGradeID=body.Grades.items[0].RawGradeID
  with self.assertRaises(HTTPException) as caught:tcb_api.commercial_save(body,self.item,self.ctx)
  self.assertEqual(caught.exception.status_code,422)
 def test_tcb_manual_costs_save_with_existing_master_prices(self):
  tcb_api.commercial_save(self.body(),self.item,self.ctx)
  body=self.body(grades=False)
  body.CostInputs=tcb_api.Inputs(RMRatio="90",SeasoningRatio="5",SeasoningUSDPerLb="1",OilPct="5",OilUSDPerLb="2",ProcessingUSDPerLb=".15",PalletUSDPerEA="10")
  result=tcb_api.commercial_save(body,self.item,self.ctx)["saved"]
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),self.expected*Decimal(".9")+Decimal(".30"))
  self.assertEqual(result["Inputs"]["Prices"][0]["PriceID"],self.price)
  self.assertEqual(Decimal(result["Inputs"]["PalletUSDPerEA"]),Decimal(10))
 def test_child_pallet_cost_is_not_applied_even_from_old_saved_inputs(self):
  item=tcb_api.item_read(self.item,self.ctx)
  item["ParentItemID"]=999
  item["ProductGradeSnapshot"]=json.dumps(self.tree)
  item["TCBCostInfo"]=json.dumps({"Inputs":{"PalletUSDPerEA":"20"}})
  body=self.body(grades=False)
  body.CostInputs=tcb_api.Inputs(PalletUSDPerEA="50")
  value,_,_,_=tcb_api.commercial_value(body,item,self.ctx,self.cur)
  self.assertIsNone(value["Inputs"]["PalletUSDPerEA"])
  self.assertEqual(Decimal(value["RMCostUSDPerLb"]),self.expected)
 def test_legacy_tcb_compute_also_clears_child_pallet_input(self):
  item=tcb_api.item_read(self.item,self.ctx)
  item["ParentItemID"]=999
  item["ProductGradeSnapshot"]=json.dumps(self.tree)
  inputs=tcb_api.Inputs(Prices=[self.selection],PalletUSDPerEA="50")
  tcb_api.compute(item,inputs,self.ctx)
  self.assertIsNone(inputs.PalletUSDPerEA)
 def test_direct_grade_price_save_reopen_and_master_unchanged(self):
  body=self.body(prices=[{"Path":"0/1/1","DirectUSDPerLb":"3.25"}])
  result=tcb_api.commercial_save(body,self.item,self.ctx)["saved"]
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),Decimal("3.25"))
  self.assertEqual(result["PriceSnapshots"][0]["Source"],"Direct")
  self.assertEqual(tcb_api.read(self.item,self.ctx)["saved"],result)
  self.assertEqual(self.cur.execute("SELECT UnitPrice FROM dbo.RawMaterialPrice WHERE ID=?",self.price).fetchval(),Decimal(10))
  self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval(),self.product_version)
 def test_direct_zero_then_switch_back_to_master_quote(self):
  tcb_api.commercial_save(self.body(prices=[{"Path":"0/1/1","DirectUSDPerLb":"0"}]),self.item,self.ctx)
  result=tcb_api.commercial_save(self.body(grades=False),self.item,self.ctx)["saved"]
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),self.expected)
  self.assertEqual(result["Inputs"]["Prices"][0]["PriceID"],self.price)
 def test_fabricated_direct_snapshot_sql_rejected(self):
  body=self.body()
  value={"Inputs":{"Prices":[{"Path":"0/1/1","DirectUSDPerLb":"3"}]},"PriceSnapshots":[{"Source":"Direct","Path":"0/1/1","USDPerLb":"99"}]}
  with self.assertRaisesRegex(Exception,"Invalid direct grade price snapshot"):
   self.cur.execute("EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?,?",self.ctx.username,self.item,tcb_api.rv(body.RowVersion),json.dumps(value),0)
 def test_custom_price_override_not_accepted(self):
  from pydantic import ValidationError
  with self.assertRaises(ValidationError):
   tcb_api.CommercialSave(RowVersion="AAAAAAAAAAE=",Prices=[{**self.selection,"OverrideUSDPerLb":"99"}])

if __name__=="__main__":unittest.main()
