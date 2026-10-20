"""Optional Opportunity pallet, while preserving exact-container and supplied-size checks."""
import sys,json,uuid,unittest
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
from db import get_raw_cursor
from schemas import OpportunityBatchRequest,OpportunityItemRow
from shipment_fields import validate_new_shipment
from fastapi import HTTPException

class OptionalPallet(unittest.TestCase):
 def setUp(self):
  self.handle=get_raw_cursor();self.cur=self.handle.__enter__()
  self.cur.execute("SET NOCOUNT ON;SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION")
  self.cur.execute((ROOT/"sql/127_optional_opportunity_pallet.sql").read_text())
  while self.cur.nextset():pass
  self.actor=self.cur.execute("SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchval()
 def tearDown(self):
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
  self.handle.__exit__(None,None,None)
 def create(self):
  from main import opportunity_batch
  fixture=self.cur.execute("SELECT TOP(1) p.ID,p.CustomerID,cu.CurrencyCode FROM dbo.Product p JOIN dbo.Customer c ON c.ID=p.CustomerID JOIN dbo.Currency cu ON cu.ID=c.CurrencyID WHERE p.IsMix=0 AND p.Status='Active' AND c.Status='Active'").fetchone()
  if not fixture:self.skipTest("An active Product/Customer fixture is needed.")
  key="PAL"+uuid.uuid4().hex[:12]
  @contextmanager
  def shared():yield self.cur
  request=OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command="C",OpportunityNumber=key,CustomerID=fixture[1],OpportunityDesc="Optional pallet fixture",BidOpen="2026-12-01",BidClose="2026-12-02",ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1 if fixture[2]=="USD" else 25000 if fixture[2]=="VND" else 1.57)],item_rows=[dict(RowNum=1,Command="C",OpportunityNumber=key,ProductID=fixture[0],AnnualUnit=1,ContainerRequest="20DC",PalletSize=None,WebPackagingRequirements=True,PackagingLayerCount=1)])
  with patch("packaging_fields.get_raw_cursor",shared):
   reply=opportunity_batch(request,self.actor,True,frozenset({"Admin"}))
  self.assertEqual(reply["header_results"][0]["Status"],"OK",reply)
  self.assertEqual(reply["item_results"][0]["Status"],"OK",reply)
  self.assertEqual(self.cur.execute("SELECT @@TRANCOUNT").fetchval(),1)
  return reply["item_results"][0]["NewID"]
 def test_web_and_excel_models_allow_missing_pallet(self):
  validate_new_shipment([OpportunityItemRow(RowNum=1,Command="C",OpportunityNumber="new",ContainerRequest="20DC")])
  from opportunity_excel_api import ITEM_REQUIRED
  self.assertNotIn("PalletSize",ITEM_REQUIRED)
 def test_container_still_required(self):
  with self.assertRaises(HTTPException):validate_new_shipment([OpportunityItemRow(RowNum=1,Command="C",OpportunityNumber="new")])
 def test_real_opportunity_save_accepts_no_pallet(self):
  item=self.create()
  self.assertEqual(tuple(self.cur.execute("SELECT PalletSize,ContainerRequest FROM dbo.OpportunityItem WHERE ID=?",item).fetchone()),(None,"20DC"))
 def test_supplied_invented_pallet_is_rejected(self):
  item=self.create()
  version=self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",item).fetchval()
  with self.assertRaisesRegex(Exception,"active pallet"):
   self.cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?",self.actor,item,version,json.dumps({"WebPackagingRequirements":True,"PalletSize":"invented-size"}))
 def test_migration_is_repeatable_without_data_changes(self):
  before=[tuple(r) for r in self.cur.execute("SELECT ID,RowVersion FROM dbo.OpportunityItem ORDER BY ID")]
  self.cur.execute((ROOT/"sql/127_optional_opportunity_pallet.sql").read_text())
  while self.cur.nextset():pass
  self.assertEqual(before,[tuple(r) for r in self.cur.execute("SELECT ID,RowVersion FROM dbo.OpportunityItem ORDER BY ID")])
if __name__=="__main__":unittest.main()
