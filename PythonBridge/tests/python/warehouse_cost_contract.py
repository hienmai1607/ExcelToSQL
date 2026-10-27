"""Warehouse arithmetic, shipment compatibility and SQL save-boundary validation."""
import sys
import json
import unittest
from decimal import Decimal
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from pydantic import ValidationError
from shipment_fields import ShipmentCostInfo, WarehouseCostBreakdown, INCOTERMS

class WarehouseContract(unittest.TestCase):
 def test_incoterms_and_legacy(self):
  self.assertEqual(tuple(sorted(set(INCOTERMS))),INCOTERMS)
  for code in INCOTERMS:self.assertEqual(ShipmentCostInfo(Incoterm=code).Incoterm,code)
  self.assertEqual(ShipmentCostInfo(WHCostCustomerPerPallet=12).WHCostCustomerPerPallet,12)
  self.assertEqual(ShipmentCostInfo(WHCostUSDPerPallet=13).WHCostUSDPerPallet,13)
 def test_total_and_rounding(self):
  self.assertEqual(ShipmentCostInfo(WHCostBreakdown=dict(Unloading=1,Palletize=2,Inbound=3,Outbound=4,StorageCostPerMonth=5,StorageMonths='1.5',OrderFeeAdminCost=6,OthersCost=7)).WHCostCustomerPerPallet,Decimal('30.50'))
  for months,expected in [('0.49','0.00'),('0.50','0.01'),('1.50','0.02')]:
   self.assertEqual(WarehouseCostBreakdown(StorageCostPerMonth='.01',StorageMonths=months).total(),Decimal(expected))
  self.assertEqual(ShipmentCostInfo(WHCostBreakdown={}).WHCostCustomerPerPallet,0)
 def test_invalid_and_tampered(self):
  for payload in [dict(WHCostBreakdown={'Unloading':-1}),dict(WHCostBreakdown={'OthersCost':'NaN'}),dict(WHCostBreakdown={'Unknown':1}),dict(WHCostBreakdown={'Unloading':1},WHCostCustomerPerPallet=2),dict(WHCostBreakdown={},WHCostUSDPerPallet=1),dict(WHCostBreakdown={'StorageCostPerMonth':'99999999999999999.99','StorageMonths':100})]:
   with self.subTest(payload=payload),self.assertRaises(ValidationError):ShipmentCostInfo(**payload)
 def test_total_flows_into_tcb_customer_currency_conversion(self):
  from tcb_analysis_columns_contract import row
  from tcb_analysis_columns import add_tcb_columns
  source=row();source['ShipmentCostInfo']=ShipmentCostInfo(WHCostBreakdown=dict(Unloading=10,StorageCostPerMonth=10,StorageMonths=2,OthersCost='.5')).model_dump(mode='json')
  add_tcb_columns([source])
  self.assertEqual(source['TCBDestinationWHPerUnit'],'0.020333333333')
 def test_workbook_manual_override_clears_old_breakdown(self):
  from opportunity_excel_api import merge_shipment
  original={'ShipmentCostInfo':ShipmentCostInfo(WHCostBreakdown={'Unloading':10}).model_dump(mode='json')}
  result=merge_shipment(None,original,{'WHCostCustomerPerPallet':'20'},{})
  self.assertIsNone(result['WHCostBreakdown']);self.assertEqual(Decimal(result['WHCostCustomerPerPallet']),20)

class WarehouseSQL(unittest.TestCase):
 def setUp(self):
  import db
  if db.DB_NAME!='test' or db.DB_SERVER.lower() not in ('desktop-5bgmjsc','localhost','.'):
   self.skipTest('Desktop test only')
  self.context=db.get_raw_cursor();self.cur=self.context.__enter__();self.addCleanup(lambda:self.context.__exit__(None,None,None))
 def validate(self,values):
  self.cur.execute('EXEC dbo.usp_OpportunityShipment_Validate NULL,?',json.dumps(values))
  while self.cur.nextset():pass
 def test_sql_terms_and_matching_arithmetic(self):
  for term in INCOTERMS:self.validate({'Incoterm':term})
  for months,expected in [('0.49','0.00'),('0.50','0.01'),('1.50','0.02')]:
   self.validate({'WHCostBreakdown':{'StorageCostPerMonth':'.01','StorageMonths':months},'WHCostCustomerPerPallet':expected})
  model=ShipmentCostInfo(WHCostBreakdown={'Unloading':1,'StorageCostPerMonth':5,'StorageMonths':'1.5'})
  self.validate(model.model_dump(mode='json'))
 def test_sql_rejects_bypass(self):
  for values in [{'Incoterm':'INVALID'},{'WHCostBreakdown':[]},{'WHCostBreakdown':{'Unknown':1}}, {'WHCostBreakdown':{'Unloading':-1}}, {'WHCostBreakdown':{'Unloading':True}}, {'WHCostBreakdown':{'Unloading':'.001'}}, {'WHCostBreakdown':{'Unloading':1},'WHCostCustomerPerPallet':2}]:
   with self.subTest(values=values),self.assertRaises(Exception):self.validate(values)
 def test_migration_is_rerunnable_without_data_changes(self):
  before=self.cur.execute("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(ShipmentCostInfo,RowVersion)) FROM dbo.OpportunityItem").fetchval()
  source=(Path(__file__).resolve().parents[2]/'sql/148_shipment_incoterms_warehouse_cost.sql').read_text(encoding='utf-8')
  self.cur.execute(source)
  while self.cur.nextset():pass
  after=self.cur.execute("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(ShipmentCostInfo,RowVersion)) FROM dbo.OpportunityItem").fetchval()
  self.assertEqual(before,after)
 def test_existing_shipment_save_roundtrip_rolls_back(self):
  row=self.cur.execute("SELECT TOP(1) i.ID,i.RowVersion,i.ShipmentCostInfo FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ParentItemID IS NULL AND o.Stage='Draft' ORDER BY i.ID DESC").fetchone()
  if row is None:self.skipTest('No Draft fixture available')
  actor=self.cur.execute("SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchval()
  payload=ShipmentCostInfo(Incoterm='CIP',WHCostBreakdown={'Unloading':'1','StorageCostPerMonth':'5','StorageMonths':'1.5'}).model_dump(mode='json')
  self.cur.execute('SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
  try:
   self.cur.execute('EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0',actor,row.ID,row.RowVersion,json.dumps({'ShipmentCostInfo':payload}))
   while self.cur.nextset():pass
   saved=json.loads(self.cur.execute('SELECT ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?',row.ID).fetchval())
   self.assertEqual(saved['Incoterm'],'CIP');self.assertEqual(Decimal(saved['WHCostCustomerPerPallet']),Decimal('8.50'))
   self.assertEqual(Decimal(saved['WHCostBreakdown']['StorageMonths']),Decimal('1.5'))
  finally:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  restored=self.cur.execute('SELECT RowVersion,ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?',row.ID).fetchone()
  self.assertEqual(restored.RowVersion,row.RowVersion);self.assertEqual(restored.ShipmentCostInfo,row.ShipmentCostInfo)

if __name__=='__main__':unittest.main()
