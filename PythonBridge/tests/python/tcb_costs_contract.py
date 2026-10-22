"""TCB math and API contracts. No production data writes."""
import sys
import unittest
from pathlib import Path
from decimal import Decimal
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from pydantic import ValidationError
from fastapi import HTTPException
from tcb_costs import Inputs, leaves, calculate, LossProcess, process_losses
from auth import AccessContext
import tcb_api
import loss_process_api as loss_master
import product_loss_api

VERSION="0x0000000000000001"
TREE=[
 dict(ParentID="0",ID=1,RawGradeID=1,Grade="Almonds",RatioPct="60"),
 dict(ParentID="0",ID=2,RawGradeID=2,Grade="Cashew",RatioPct="40"),
 dict(ParentID="0/1",ID=1,RawGradeID=3,RawMaterialID=10,Grade="A",RatioPct="25"),
 dict(ParentID="0/1",ID=2,RawGradeID=4,RawMaterialID=11,Grade="B",RatioPct="75")]
PRICES={
 1:dict(PriceID=1,RawGradeID=2,MaterialID=12,USDPerLb="3",PriceVersion=VERSION),
 2:dict(PriceID=2,RawGradeID=3,MaterialID=10,USDPerLb="2",PriceVersion=VERSION),
 3:dict(PriceID=3,RawGradeID=4,MaterialID=11,USDPerLb="4",PriceVersion=VERSION)}
SELECTIONS=[dict(Path=path,PriceID=id,PriceVersion=VERSION) for path,id in (("0/2",1),("0/1/1",2),("0/1/2",3))]

class Math(unittest.TestCase):
 def test_nested_grade_proportions_and_weighted_cost(self):
  grades=leaves(TREE)
  self.assertEqual({g["Path"]:g["Proportion"] for g in grades},
                   {"0/2":Decimal(".4"),"0/1/1":Decimal(".15"),"0/1/2":Decimal(".45")})
  result=calculate(Inputs(Prices=SELECTIONS,RMRatio="90",SeasoningRatio="5",SeasoningUSDPerLb="1",OilPct="5",OilUSDPerLb="2",ProcessingUSDPerLb=".2"),grades,PRICES)
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),Decimal("3.3"))
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("3.32"))
  self.assertEqual(len(result["PriceSnapshots"]),3)
 def test_mixed_master_and_direct_prices_compound_by_leaf_ratio(self):
  selections=[*SELECTIONS[:2],{"Path":"0/1/2","DirectUSDPerLb":"5"}]
  result=calculate(Inputs(Prices=selections),leaves(TREE),PRICES)
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),Decimal("3.75"))
  self.assertEqual(next(r for r in result["PriceSnapshots"] if r["Path"]=="0/1/2")["Source"],"Direct")
 def test_direct_price_validation(self):
  for selection in ({"Path":"0/2","DirectUSDPerLb":"-1"},{"Path":"0/2","DirectUSDPerLb":"NaN"},{"Path":"0/2","DirectUSDPerLb":"1.0000001"},{"Path":"0/2","DirectUSDPerLb":None},{"Path":"0/2","DirectUSDPerLb":"3","PriceID":1,"PriceVersion":VERSION}):
   with self.subTest(selection=selection),self.assertRaises(ValidationError):Inputs(Prices=[selection])
  result=calculate(Inputs(Prices=[{"Path":g["Path"],"DirectUSDPerLb":"0"} for g in leaves(TREE)]),leaves(TREE),{})
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),Decimal(0))
 def test_losses_do_not_change_product_formula(self):
  result=calculate(Inputs(Prices=SELECTIONS,LossProductPct="20",PrimaryLossPct="10"),leaves(TREE),PRICES)
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("3.3"))
 def test_invalid_inputs(self):
  for data in ({"RMRatio":"99"},{"OilPct":"1"},{"PrimaryLossPct":"101"},
    {"ProcessingUSDPerLb":"-1"},{"ProcessingUSDPerLb":"NaN"},
    {"SeasoningRatio":"5","RMRatio":"95"},{"PalletUSDPerEA":"1.0000001"},
    {"Prices":[SELECTIONS[0],SELECTIONS[0]]},{"RMCostUSDPerLb":"12"}):
   with self.subTest(data=data),self.assertRaises(ValidationError):Inputs(**data)
 def test_invalid_trees(self):
  for tree in ([],TREE+[TREE[0]],[{**TREE[0],"RatioPct":"99"}],
               [dict(ParentID="0/9",ID=1,RawGradeID=1,RatioPct="100")]):
   with self.subTest(tree=tree),self.assertRaises(ValueError):leaves(tree)
 def test_missing_wrong_removed_or_changed_price_is_rejected(self):
  for selections,prices in ((SELECTIONS[:1],PRICES),
      (SELECTIONS,{**PRICES,2:{**PRICES[2],"MaterialID":99}}),
      (SELECTIONS,{**PRICES,2:{**PRICES[2],"PriceVersion":"0x0000000000000002"}}),
      ([{**SELECTIONS[0],"Path":"0/1"},*SELECTIONS[1:]],PRICES),
      (SELECTIONS,{**PRICES,2:{**PRICES[2],"USDPerLb":None}})):
   with self.subTest(selections=selections),self.assertRaises(ValueError):
    calculate(Inputs(Prices=selections),leaves(TREE),prices)
 def test_changed_weight_conversion_requires_explicit_reselection(self):
  selections=[{**p,"ExpectedUSDPerLb":PRICES[p["PriceID"]]["USDPerLb"]} for p in SELECTIONS]
  with self.assertRaisesRegex(ValueError,"conversion changed"):
   calculate(Inputs(Prices=selections),leaves(TREE),{**PRICES,2:{**PRICES[2],"USDPerLb":"2.1"}})
 def test_zero_rm_ratio_can_cost_other_ingredients_without_fabricating_rm(self):
  result=calculate(Inputs(RMRatio=0,SeasoningRatio=100,SeasoningUSDPerLb=2),leaves(TREE),{})
  self.assertIsNone(result["RMCostUSDPerLb"])
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal(2))

class Losses(unittest.TestCase):
 def test_product_yield_combines_sorting_processing_in_sequence(self):
  inputs=Inputs(LossProcesses=[{"ProcessType":"Processing","Sequence":2,"LossPct":10},
                              {"ProcessType":"Sorting","Sequence":1,"LossPct":5}])
  self.assertEqual(inputs.LossProductPct,Decimal("14.50"))
  self.assertEqual(inputs.PrimaryLossPct,Decimal(0))
 def test_layer_losses_are_independent_and_repeat_steps_compound(self):
  inputs=Inputs(LossProcesses=[
   {"ProcessType":"Sorting","Sequence":1,"LossPct":5},
   {"ProcessType":"PrimaryPackaging","Sequence":2,"LossPct":2},
   {"ProcessType":"PrimaryPackaging","Sequence":3,"LossPct":3},
   {"ProcessType":"SecondaryPackaging","Sequence":4,"LossPct":7}])
  self.assertEqual(inputs.LossProductPct,Decimal(5))
  self.assertEqual(inputs.PrimaryLossPct,Decimal("4.94"))
  self.assertEqual(inputs.SecondaryLossPct,Decimal(7))
 def test_zero_and_total_loss_and_client_totals_cannot_override_processes(self):
  inputs=Inputs(LossProductPct=99,PrimaryLossPct=99,LossProcesses=[])
  self.assertEqual(inputs.LossProductPct,0);self.assertEqual(inputs.PrimaryLossPct,0)
  inputs=Inputs(LossProcesses=[{"ProcessType":"Sorting","Sequence":1,"LossPct":100},
                              {"ProcessType":"Processing","Sequence":2,"LossPct":0}])
  self.assertEqual(inputs.LossProductPct,100)
 def test_invalid_processes(self):
  for rows in ([{"ProcessType":"Unknown","Sequence":1,"LossPct":5}],
    [{"ProcessType":"Sorting","Sequence":0,"LossPct":5}],
    [{"ProcessType":"Sorting","Sequence":1.5,"LossPct":5}],
    [{"ProcessType":"Sorting","Sequence":True,"LossPct":5}],
    [{"ProcessType":"Sorting","Sequence":1,"LossPct":101}],
    [{"ProcessType":"Sorting","Sequence":1,"LossPct":"1.001"}],
    [{"ProcessType":"Sorting","Sequence":1,"LossPct":5},{"ProcessType":"Processing","Sequence":1,"LossPct":5}]):
   with self.subTest(rows=rows),self.assertRaises(ValidationError):Inputs(LossProcesses=rows)
 def test_derived_precision_survives_reopening(self):
  inputs=Inputs(LossProcesses=[{"ProcessType":"Sorting","Sequence":1,"LossPct":"1.23"},
                              {"ProcessType":"Processing","Sequence":2,"LossPct":"2.34"}])
  self.assertEqual(inputs.LossProductPct,Decimal("3.54121800"))
  self.assertEqual(Inputs(**inputs.model_dump(mode="json")).LossProductPct,inputs.LossProductPct)

class API(unittest.TestCase):
 ctx=AccessContext(1,"Sales",frozenset({"Opportunity"}))
 item=dict(ID=1,RowVersion="AAAAAAAAAAE=",ProductGradeSnapshot='{"items":[]}',TCBCostInfo=None,
           IsMixParent=True,ItemStage="Draft",HeaderStage="Draft")
 def test_palletization_always_copies_response_and_ignores_manual_override(self):
  for source,expected in ((Decimal("15.5"),Decimal("15.5")),(Decimal(0),Decimal(0)),(None,None)):
   item={**self.item,"DefaultPalletUSDPerEA":source,"TCBCostInfo":json.dumps({"Inputs":{"PalletUSDPerEA":"15"}})}
   with patch.object(tcb_api,"item_read",return_value=item),patch.object(tcb_api,"active_loss_masters",return_value=[]),patch.object(tcb_api,"active_loss_defaults",return_value=[]):
    result=tcb_api.read(1,self.ctx)
   self.assertEqual(result["saved"]["Inputs"]["PalletUSDPerEA"],str(expected) if expected is not None else None)
   inputs=Inputs(PalletUSDPerEA=999)
   tcb_api.compute(item,inputs,self.ctx)
   self.assertEqual(inputs.PalletUSDPerEA,expected)
   value,_,_,_=tcb_api.commercial_value(tcb_api.CommercialSave(RowVersion=self.item["RowVersion"],CostInputs=Inputs(PalletUSDPerEA=999)),item,self.ctx,None)
   self.assertEqual(value["Inputs"]["PalletUSDPerEA"],str(expected) if expected is not None else None)

 def test_parent_only_has_packaging_costs(self):
  result=tcb_api.compute(self.item,Inputs(MixPrimaryLossPct=2,PalletUSDPerEA=10),self.ctx)
  self.assertIsNone(result["ProductUSDPerLb"])
  with self.assertRaises(HTTPException):
   tcb_api.compute(self.item,Inputs(ProcessingUSDPerLb=1),self.ctx)
 def test_mix_and_inactive_layer_processes_rejected(self):
  for processes in ([{"ProcessType":"Sorting","Sequence":1,"LossPct":5}],
                    [{"ProcessType":"PrimaryPackaging","Sequence":1,"LossPct":5}],
                    [{"ProcessType":"MixSecondaryPackaging","Sequence":1,"LossPct":5}]):
   with self.subTest(processes=processes),self.assertRaises(HTTPException):
    tcb_api.compute({**self.item,"LossLayerCount":1},Inputs(LossProcesses=processes),self.ctx)
  result=tcb_api.compute({**self.item,"LossLayerCount":2},Inputs(LossProcesses=[
   {"ProcessType":"MixSecondaryPackaging","Sequence":1,"LossPct":5}]),self.ctx)
  self.assertIsNone(result["ProductUSDPerLb"])
 def test_scope_and_conflict_guard(self):
  with self.assertRaises(HTTPException),patch.object(tcb_api,"item_read") as read:
   tcb_api.read(1,AccessContext(2,"Packaging",frozenset({"Packaging"})))
  read.assert_not_called()
  body=tcb_api.Save(RowVersion="AAAAAAAAAAI=",Inputs={})
  with patch.object(tcb_api,"item_read",return_value=self.item),patch.object(tcb_api,"execute") as write,self.assertRaises(HTTPException) as cm:
   tcb_api.save(body,1,self.ctx)
  self.assertEqual(cm.exception.status_code,409);write.assert_not_called()
 def test_saved_snapshots_and_version_are_server_computed(self):
  with patch.object(tcb_api,"item_read",return_value={**self.item,"DefaultPalletUSDPerEA":Decimal("15.5")}),patch.object(tcb_api,"execute",return_value=[[{"RowVersion":"AAAAAAAAAAI="}]]) as write:
   result=tcb_api.save(tcb_api.Save(RowVersion="AAAAAAAAAAE=",Inputs={"PalletUSDPerEA":"12"}),1,self.ctx)
  self.assertEqual(result["RowVersion"],"AAAAAAAAAAI=")
  self.assertEqual(result["saved"]["Inputs"]["PalletUSDPerEA"],"15.5")
  self.assertIn("usp_OpportunityTCB_Save",write.call_args.args[0])

import json
import re
from contextlib import contextmanager
from uuid import uuid4
import packaging_field_foundation_contract as foundation
from db import bytes_to_b64
from packaging_fields import consume

class SQL(unittest.TestCase):
 cleanup=foundation.PackagingFoundation.cleanup
 request=foundation.PackagingFoundation.request
 def setUp(self):
  foundation.PackagingFoundation.setUp(self)
  for sql in re.split(r"^GO\s*$",(foundation.ROOT/"sql/103_pallet_price.sql").read_text(),flags=re.M|re.I):
   if sql.strip():
    self.cur.execute(sql)
    while self.cur.nextset():pass
  for _ in range(2):
   for sql in re.split(r"^GO\s*$",(foundation.ROOT/"sql/91_opportunity_tcb.sql").read_text(),flags=re.M|re.I):
    if sql.strip():
     self.cur.execute(sql)
     while self.cur.nextset():pass
  for sql in re.split(r"^GO\s*$",(foundation.ROOT/"sql/92_loss_process_master.sql").read_text(),flags=re.M|re.I):
   if sql.strip():
    self.cur.execute(sql)
    while self.cur.nextset():pass
  for sql in re.split(r"^GO\s*$",(foundation.ROOT/"sql/93_loss_process_names.sql").read_text(),flags=re.M|re.I):
   if sql.strip():
    self.cur.execute(sql)
    while self.cur.nextset():pass
  @contextmanager
  def cursor():
   cur=self.conn.cursor()
   try:yield cur
   finally:cur.close()
  mocked=patch("packaging_api.get_raw_cursor",cursor)
  mocked.start();self.addCleanup(mocked.stop)
  self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
  self.grade=self.cur.execute("INSERT dbo.RawGrade(GradeName,CreatedBy) VALUES(?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())","TCB-"+uuid4().hex[:16],self.actor).fetchval()
  self.material=self.cur.execute("""INSERT dbo.RawMaterial(MaterialCode,MaterialName,UnitOfMeasure,GradeID,CreatedBy)
   VALUES(?,'TCB nuts','KG',?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""","TCB-"+uuid4().hex[:16],self.grade,self.actor).fetchval()
  currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  self.price=self.cur.execute("""INSERT dbo.RawMaterialPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,
   UnitPrice,ExchangeRateToUSD,EffectiveFrom,CreatedBy)
   VALUES(?,?,'KG',0,10,1,'2020-01-01',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.material,currency,self.actor).fetchval()
  tree=[dict(ParentID="0",ID=1,Grade="Nuts",RawGradeID=self.grade,RawMaterialID=self.material,RatioPct="100")]
  self.cur.execute("UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=? WHERE ID=?",json.dumps({"items":tree}),self.item)
 def master_step(self,type,sequence,loss):
  result=loss_master.save(loss_master.LossMasterSave(ProcessType=type,Sequence=sequence,LossPct=loss),self.ctx)["rows"][0]
  master=next(row for row in loss_master.active_loss_masters(self.ctx) if row["MasterID"]==result["ID"])
  return {**master,"ProcessType":type if type.endswith("Packaging") else "Processing"}
 def body(self):
  price=tcb_api.current_prices(tcb_api.grade_leaves(tcb_api.item_read(self.item,self.ctx)),self.ctx)[0]
  version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
  return tcb_api.Save(RowVersion=version,Inputs={"Prices":[{"Path":"0/1","PriceID":self.price,"PriceVersion":price["PriceVersion"]}],"ProcessingUSDPerLb":".1"})
 def test_real_weight_conversion_save_reload_audit_and_active_pcr_snapshot(self):
  request_id=self.request()
  before=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",request_id).fetchval()
  data=tcb_api.read(self.item,self.ctx)
  factor=data["prices"][0]["PriceToLbFactor"]
  expected=Decimal(10)/Decimal(str(factor)) if factor else Decimal("4.5359237")
  self.assertEqual(Decimal(data["prices"][0]["USDPerLb"]),expected)
  saved=tcb_api.save(self.body(),self.item,self.ctx)
  self.assertEqual(Decimal(saved["saved"]["ProductUSDPerLb"]),expected+Decimal(".1"))
  reread=tcb_api.read(self.item,self.ctx)
  self.assertEqual(reread["saved"],saved["saved"])
  self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",request_id).fetchval(),before)
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='TCBCostInfo' AND ChangedBy=? AND Source='User'",self.item,self.username).fetchval(),1)
  self.cur.execute("UPDATE dbo.RawMaterialPrice SET UnitPrice=20 WHERE ID=?",self.price)
  self.assertEqual(tcb_api.read(self.item,self.ctx)["saved"],saved["saved"])
 def test_process_rows_and_calculated_losses_save_and_reopen_without_changing_prices(self):
  product_steps=[self.master_step("Sorting",111,5),self.master_step("Roasting",112,10)]
  self.cur.execute("UPDATE dbo.OpportunityItem SET ProductLossSnapshot=? WHERE ID=?",json.dumps(product_steps),self.item)
  body=self.body()
  body.Inputs=Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[*product_steps,self.master_step("PrimaryPackaging",113,2)]})
  before=tcb_api.compute(tcb_api.item_read(self.item,self.ctx),body.Inputs,self.ctx)["ProductUSDPerLb"]
  saved=tcb_api.save(body,self.item,self.ctx)["saved"]
  self.assertEqual(Decimal(saved["Inputs"]["LossProductPct"]),Decimal("14.50"))
  self.assertEqual(Decimal(saved["Inputs"]["PrimaryLossPct"]),Decimal(2))
  self.assertEqual(saved["ProductUSDPerLb"],before)
  self.assertEqual(tcb_api.read(self.item,self.ctx)["saved"],saved)
 def test_master_filtered_sorted_pagination(self):
  first=self.master_step("Sorting",901,"5")
  second=self.master_step("Processing",902,"10")
  result=loss_master.read(page=1,page_size=1,search="Sort",status="Active",
    sort='[{"column":"Sequence","direction":"desc"}]',ctx=self.ctx)
  self.assertTrue(all(row["ProcessType"]=="Sorting" for row in result["rows"]))
  self.assertEqual(result["rows"][0]["ID"],first["MasterID"])
  self.assertGreaterEqual(result["total"],1)
  blocked=loss_master.read(page=1,page_size=500,search="",status="Block",sort="[]",ctx=self.ctx)
  self.assertTrue(all(row["Status"]=="Block" for row in blocked["rows"]))

 def test_master_rejects_sales_maintenance_and_stale_edits(self):
  with self.assertRaises(HTTPException):
   loss_master.save(loss_master.LossMasterSave(ProcessType="Sorting",Sequence=221,LossPct=5),
                    AccessContext(2,"Sales",frozenset({"Opportunity"})))
  step=self.master_step("Sorting",222,5)
  version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.LossProcessMaster WHERE ID=?",step["MasterID"]).fetchval())
  self.cur.execute("UPDATE dbo.LossProcessMaster SET LossPct=6 WHERE ID=?",step["MasterID"])
  with self.assertRaises(HTTPException) as cm:
   loss_master.save(loss_master.LossMasterSave(ID=step["MasterID"],RowVersion=version,
                     ProcessType="Sorting",Sequence=222,LossPct=7),self.ctx)
  self.assertEqual(cm.exception.status_code,409)
 def test_opportunity_allows_packaging_loss_override(self):
  step=self.master_step("PrimaryPackaging",223,5);body=self.body()
  body.Inputs=Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[{**step,"LossPct":"99"}]})
  result=tcb_api.save(body,self.item,self.ctx)["saved"]
  self.assertEqual(Decimal(result["Inputs"]["PrimaryLossPct"]),Decimal(99))
  self.assertEqual(result["Inputs"]["LossProcesses"][0]["MasterID"],step["MasterID"])
 def test_saved_master_snapshot_survives_change_or_blocking(self):
  step=self.master_step("PrimaryPackaging",224,5);body=self.body()
  body.Inputs=Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[step]})
  tcb_api.save(body,self.item,self.ctx)
  self.cur.execute("UPDATE dbo.LossProcessMaster SET Status='Block',LossPct=50 WHERE ID=?",step["MasterID"])
  item=tcb_api.item_read(self.item,self.ctx)
  body=tcb_api.Save(RowVersion=item["RowVersion"],Inputs=json.loads(item["TCBCostInfo"])["Inputs"])
  result=tcb_api.save(body,self.item,self.ctx)["saved"]
  self.assertEqual(Decimal(result["Inputs"]["PrimaryLossPct"]),Decimal(5))
  self.assertEqual(result["Inputs"]["LossProcesses"][0]["MasterVersion"],step["MasterVersion"])
 def test_new_blocked_or_stale_assignment_rejected(self):
  step=self.master_step("PrimaryPackaging",225,5);body=self.body()
  body.Inputs=Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[step]})
  self.cur.execute("UPDATE dbo.LossProcessMaster SET LossPct=6 WHERE ID=?",step["MasterID"])
  with self.assertRaises(HTTPException) as cm:tcb_api.save(body,self.item,self.ctx)
  self.assertEqual(cm.exception.status_code,409)
 def test_new_direct_process_edit_rejected_but_legacy_snapshot_is_preserved(self):
  body=self.body()
  body.Inputs=Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[
    {"ProcessType":"Sorting","Sequence":1,"LossPct":5}]})
  with self.assertRaises(HTTPException) as cm:tcb_api.save(body,self.item,self.ctx)
  self.assertEqual(cm.exception.status_code,422)
  self.cur.execute("UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?",
                   json.dumps({"Inputs":{"LossProductPct":"14.5"}}),self.item)
  body=self.body()
  body.Inputs=Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[
    {"ProcessType":"Processing","Sequence":1,"LossPct":"14.5"}]})
  result=tcb_api.save(body,self.item,self.ctx)["saved"]
  self.assertEqual(Decimal(result["Inputs"]["LossProductPct"]),Decimal("14.5"))
 def test_master_race_between_resolution_and_sql_write_rejected(self):
  step=self.master_step("PrimaryPackaging",226,5);body=self.body()
  inputs=tcb_api.resolve_loss_assignments(tcb_api.item_read(self.item,self.ctx),
   Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[step]}),self.ctx)
  self.cur.execute("UPDATE dbo.LossProcessMaster SET LossPct=6 WHERE ID=?",step["MasterID"])
  with self.assertRaisesRegex(Exception,"Loss assignment changed"):
   self.cur.execute("EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?",self.username,self.item,
                    tcb_api.rv(body.RowVersion),json.dumps({"Inputs":inputs.model_dump(mode="json"),"PriceSnapshots":[]}))
 def test_product_master_defaults_snapshot_and_opportunity_overrides(self):
  master=self.master_step("Roasting custom",701,5)
  product_id=self.cur.execute("SELECT ProductID FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval()
  product=product_loss_api.read(product_id,self.ctx)["product"]
  saved=product_loss_api.save(product_loss_api.ProductLossSave(RowVersion=product["RowVersion"],processes=[master]),product_id,self.ctx)
  new_opp=self.cur.execute("""INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
    SELECT 'LS-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),CustomerID,'Loss snapshot',BidOpen,BidClose,'Draft',CreatedBy
    FROM dbo.Opportunity WHERE ID=?;SELECT CONVERT(INT,SCOPE_IDENTITY());""",self.opp).fetchval()
  new_id=self.cur.execute("""INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,CreatedBy)
    SELECT ?,ProductID,'New snapshot',100,CreatedBy FROM dbo.OpportunityItem WHERE ID=?;
    SELECT CONVERT(INT,SCOPE_IDENTITY());""",new_opp,self.item).fetchval()
  captured=json.loads(self.cur.execute("SELECT ProductLossSnapshot FROM dbo.OpportunityItem WHERE ID=?",new_id).fetchval())
  self.assertEqual(captured[0]["ProcessName"],"Roasting custom")
  product_loss_api.save(product_loss_api.ProductLossSave(RowVersion=saved["RowVersion"],processes=[{**master,"LossPct":"20"}]),product_id,self.ctx)
  self.assertEqual(Decimal(json.loads(self.cur.execute("SELECT ProductLossSnapshot FROM dbo.OpportunityItem WHERE ID=?",new_id).fetchval())[0]["LossPct"]),Decimal(5))
  item=tcb_api.item_read(new_id,self.ctx)
  resolved=tcb_api.resolve_loss_assignments(item,Inputs(LossProcesses=[{**captured[0],"LossPct":"8"}]),self.ctx)
  self.assertEqual(resolved.LossProductPct,Decimal(8))
  self.cur.execute("UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=(SELECT ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=?) WHERE ID=?",self.item,new_id)
  body=self.body()
  body.RowVersion=tcb_api.item_read(new_id,self.ctx)["RowVersion"]
  body.Inputs=Inputs(**{**body.Inputs.model_dump(mode="json"),"LossProcesses":[{**captured[0],"LossPct":"8"}]})
  result=tcb_api.save(body,new_id,self.ctx)
  self.assertEqual(Decimal(result["saved"]["Inputs"]["LossProductPct"]),Decimal(8))
  self.assertEqual(json.loads(self.cur.execute("SELECT LossProcesses FROM dbo.Product WHERE ID=?",product_id).fetchval())[0]["LossPct"],"20")
  with self.assertRaises(HTTPException):
   tcb_api.resolve_loss_assignments(item,Inputs(LossProcesses=[]),self.ctx)
  with self.assertRaises(HTTPException):
   tcb_api.resolve_loss_assignments(item,Inputs(LossProcesses=[{**captured[0],"Sequence":702}]),self.ctx)
  with self.assertRaises(HTTPException):
   product_loss_api.save(product_loss_api.ProductLossSave(RowVersion=product["RowVersion"],processes=[master]),product_id,self.ctx)

 def test_same_weight_unit_without_conversion_is_one_pound(self):
  self.cur.execute("UPDATE dbo.RawMaterialPrice SET PriceBasis='LB' WHERE ID=?",self.price)
  data=tcb_api.read(self.item,self.ctx)
  self.assertEqual(Decimal(data["prices"][0]["USDPerLb"]),Decimal(10))
 def test_price_changed_after_selection_rejected(self):
  body=self.body()
  self.cur.execute("UPDATE dbo.RawMaterialPrice SET UnitPrice=11 WHERE ID=?",self.price)
  with self.assertRaisesRegex(HTTPException,"Selected price changed"):
   tcb_api.save(body,self.item,self.ctx)
 def test_stale_item_version_rejected(self):
  body=self.body()
  self.cur.execute("UPDATE dbo.OpportunityItem SET ShelfPrice=10 WHERE ID=?",self.item)
  with self.assertRaises(HTTPException) as cm:tcb_api.save(body,self.item,self.ctx)
  self.assertEqual(cm.exception.status_code,409)
 def test_sql_stage_lock_rejects_direct_save(self):
  body=self.body()
  self.cur.execute("UPDATE dbo.Opportunity SET Stage='Closed' WHERE ID=?",self.opp)
  with self.assertRaisesRegex(Exception,"no longer Draft"):
   self.cur.execute("EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?",self.username,self.item,tcb_api.rv(body.RowVersion),'{"PriceSnapshots":[]}')
 def test_unconvertible_basis_does_not_fabricate_a_cost(self):
  self.cur.execute("UPDATE dbo.RawMaterialPrice SET PriceBasis='UNCONVERTIBLE' WHERE ID=?",self.price)
  data=tcb_api.read(self.item,self.ctx)
  self.assertIsNone(data["prices"][0]["USDPerLb"])

if __name__=="__main__":unittest.main()
