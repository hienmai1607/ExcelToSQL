"""Rollback-only response master, history and permissions contracts."""
import json
import re
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from fastapi import HTTPException
from pydantic import ValidationError
import packaging_field_foundation_contract as foundation
ROOT=foundation.ROOT
sys.path.insert(0,str(ROOT/"core"))
import packaging_api as api
import packaging_fields as fields
from auth import AccessContext
from db import bytes_to_b64
from request_views import RequestViews
from opportunity_views import OpportunityViews

class ResponseTypes(unittest.TestCase):
 cleanup=foundation.PackagingFoundation.cleanup
 def setUp(self):
  foundation.PackagingFoundation.setUp(self)
  self.cur.execute("SET QUOTED_IDENTIFIER ON")
  for _ in range(2):
   for batch in re.split(r"^GO\s*$",(ROOT/"sql/52_packaging_response_types.sql").read_text(),flags=re.M|re.I):
    if batch.strip():
     self.cur.execute(batch)
     while self.cur.nextset():pass
  self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
  self.req=foundation.PackagingFoundation.request(self)
  self.primary="Primary-"+uuid4().hex[:12]
  self.secondary="Secondary-"+uuid4().hex[:12]
  for order,name in (("Primary",self.primary),("Secondary",self.secondary)):
   self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy) VALUES(?,?,'Count',0,?)",order,name,self.actor)
  @contextmanager
  def cursor():yield self.cur
  for module in (api,fields):
   mock=patch.object(module,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
 def save(self,**values):
  rv=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()
  return api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=bytes_to_b64(rv),**values)]),self.ctx)
 def test_active_lookup_and_matching_orders(self):
  rows=api.lookups(self.ctx)["packagingTypes"]
  self.assertTrue(any(r["PackagingType"]==self.primary and r["PackagingOrder"]=="Primary" for r in rows))
  self.cur.execute("UPDATE dbo.PackagingType SET Status='Block' WHERE PackagingType=?",self.secondary)
  self.assertFalse(any(r["PackagingType"]==self.secondary for r in api.lookups(self.ctx)["packagingTypes"]))
 def test_valid_response_keeps_historical_cost_currency_and_pallet(self):
  currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Cost=12.34,CurrencyID=?,CostBasis='per pack',PalletType='Legacy pallet' WHERE ID=?",currency,self.req)
  result=self.save(FirstPMType=self.primary,SecondPMType=self.secondary,PackagingDescription="Updated",CostBasis="per pack")
  self.assertEqual(result["results"][0]["Status"],"OK")
  row=self.cur.execute("SELECT FirstPMType,SecondPMType,Cost,CurrencyID,PalletType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchone()
  self.assertEqual(tuple(row),(self.primary,self.secondary,row.Cost,currency,"Legacy pallet"))
  self.assertEqual(str(row.Cost),"12.3400")
 def test_wrong_order_is_rejected_atomically(self):
  with self.assertRaises(HTTPException) as caught:self.save(FirstPMType=self.secondary,PackagingDescription="Must roll back")
  self.assertEqual(caught.exception.status_code,422)
  self.assertIn("matching",caught.exception.detail)
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),0)
 def test_inactive_type_is_rejected(self):
  self.cur.execute("UPDATE dbo.PackagingType SET Status='Block' WHERE PackagingType=?",self.primary)
  with self.assertRaises(HTTPException) as caught:self.save(FirstPMType=self.primary)
  self.assertEqual(caught.exception.status_code,422)
 def test_unchanged_legacy_type_remains_editable(self):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMType='Legacy film' WHERE ID=?",self.req)
  self.assertEqual(self.save(FirstPMType="Legacy film",PackagingDescription="Updated")["results"][0]["Status"],"OK")
 def test_retired_fields_and_cost_mutations_rejected(self):
  with self.assertRaises(ValidationError):api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion="AAAAAAAAAAE=",PalletType="new")])
  with self.assertRaises(HTTPException) as caught:self.save(Cost=999)
  self.assertEqual(caught.exception.status_code,422)
  self.assertIn("retired",caught.exception.detail)
 def test_existing_layouts_upgrade(self):
  old=dict(columns=["ProductCode","FirstPMType","PalletType","PMCost","PMCostCurrencyCode"],sort=[dict(column="PMCost",direction="asc")],column_widths={"PalletType":120},prefix_columns=["ProductCode","PMCost"])
  for cls in (RequestViews,OpportunityViews):
   view=cls(items=old).items
   self.assertEqual(view.columns,["ProductCode","FirstPMType"])
   self.assertEqual(view.sort,[]);self.assertEqual(view.column_widths,{})
   self.assertEqual(view.prefix_columns,["ProductCode"])
 def test_sales_cannot_load_response_types(self):
  with self.assertRaises(HTTPException) as caught:api.lookups(AccessContext(self.actor,self.username,frozenset({"Opportunity"})))
  self.assertEqual(caught.exception.status_code,403)

if __name__=="__main__":unittest.main()
