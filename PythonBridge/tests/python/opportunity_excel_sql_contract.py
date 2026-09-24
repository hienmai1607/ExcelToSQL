"""Real SQL adapter tests, local test database only, fixtures rolled back."""
import sys
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from packaging_field_foundation_contract import PackagingFoundation, ROOT
sys.path.insert(0,str(ROOT/"core"))
import opportunity_excel_api as excel
import packaging_api
import packaging_fields
from auth import AccessContext

class OpportunityExcelSQL(unittest.TestCase):
 setup_base=PackagingFoundation.setUp
 cleanup=PackagingFoundation.cleanup
 def setUp(self):
  self.setup_base()
  @contextmanager
  def cursor():yield self.cur
  for module in (packaging_api,packaging_fields):
   mock=patch.object(module,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
  self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
  self.currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
  self.cur.execute("UPDATE dbo.Opportunity SET CurrencyID=?,ExchangeRateToVND=1 WHERE ID=?",self.currency,self.opp)
 def edit(self,**changes):
  row=excel.document_rows(self.ctx,self.opp)[0]
  return dict(row=3,number=row["OpportunityNumber"],opportunity_id=self.opp,item_id=self.item,
   header_version=row["HeaderRowVersion"],item_version=row["ItemRowVersion"],**changes)
 def test_header_and_item_update_and_audit(self):
  body=excel.Batch(rows=[self.edit(header_changes={"OpportunityDesc":"Excel header change"},item_changes={"AnnualUnit":321,"ShelfPrice":None,"PalletSize":"Test pallet"})])
  result=excel.save(body,self.ctx)
  self.assertEqual(result["results"][0]["status"],"OK",result)
  self.assertEqual(self.cur.execute("SELECT OpportunityDesc FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval(),"Excel header change")
  self.assertEqual(self.cur.execute("SELECT AnnualUnit FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval(),321)
  self.assertEqual(self.cur.execute("SELECT PalletSize FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval(),"Test pallet")
  changes=self.cur.execute("SELECT EntityLevel,FieldName,NewValue,ChangedBy FROM dbo.OpportunityChangeLog WHERE OpportunityID=?",self.opp).fetchall()
  self.assertTrue(any(r.EntityLevel=="Header" and r.FieldName=="OpportunityDesc" and r.NewValue=="Excel header change" and r.ChangedBy==self.username for r in changes))
  self.assertTrue(any(r.EntityLevel=="Item" and r.FieldName=="AnnualUnit" and r.NewValue=="321" and r.ChangedBy==self.username for r in changes))
 def test_create_multiple_items(self):
  source=excel.document_rows(self.ctx,self.opp)[0]
  products=self.cur.execute("SELECT TOP(2) ProductCode FROM dbo.Product WHERE Status='Active' ORDER BY ID").fetchall()
  rows=[dict(row=i+3,number="XL-TEST-CREATE",header_command="C",item_command="C",
   header_changes={k:source[k] for k in excel.HEADER_REQUIRED if k!="OpportunityNumber"},
   item_changes={"ProductCode":p[0],"ItemDescription":"Excel create","AnnualUnit":10}) for i,p in enumerate(products)]
  result=excel.save(excel.Batch(rows=rows),self.ctx)
  self.assertTrue(all(r["status"]=="OK" for r in result["results"]),result)
  ids={r["values"]["_OpportunityID"] for r in result["results"]}
  self.assertEqual(len(ids),1)
  self.assertEqual(len({r["values"]["_ItemID"] for r in result["results"]}),len(products))
 def test_delete_item(self):
  result=excel.save(excel.Batch(rows=[self.edit(item_command="D")]),self.ctx)
  self.assertEqual(result["results"][0]["status"],"OK",result)
  self.assertIsNone(self.cur.execute("SELECT ID FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
 def test_stale_item_no_header_write(self):
  row=self.edit(header_changes={"OpportunityDesc":"Must not write"},item_changes={"AnnualUnit":1})
  self.cur.execute("UPDATE dbo.OpportunityItem SET AnnualUnit=102 WHERE ID=?",self.item)
  result=excel.save(excel.Batch(rows=[row]),self.ctx)
  self.assertEqual(result["results"][0]["status"],"ERROR",result)
  self.assertNotEqual(self.cur.execute("SELECT OpportunityDesc FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval(),"Must not write")

if __name__=="__main__":unittest.main()
