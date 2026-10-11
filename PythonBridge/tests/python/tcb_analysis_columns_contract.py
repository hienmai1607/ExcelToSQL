import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from tcb_analysis_columns import add_tcb_columns,TCB_LABELS,TCB_COLUMNS
def row(id=1):
 return dict(OpportunityID=1,ItemID=id,ProductID=id,ProductCode="P"+str(id),IsMixParent=False,WeightGrams="453.59237",
  AnnualUnit="1000",EstPctAwarded="50",ResponseLayerCount=2,UnitsPerCarton=10,UnitsPerPallet=1000,
  PrimaryPricePerUnit=".1",PrimaryPriceCurrencyCode="USD",SecondaryPricePerUnit="1",SecondaryPriceCurrencyCode="USD",
  CustomerCurrencyCode="AUD",ExchangeRateCustomerCurrencyPerUSD="1.5",ContainerRequest="Dry",
  ConfigurationRequest="Pallet load",SelectedContainerType="20DC",ContainerLoadProfiles={"20DC":{"CartonsPerContainerFloor":200}},
  ContainerLoadResults={"20DC":{"CalculatedCartonsPerContainer":100}},
  ShipmentCostInfo=dict(PackingUSDPerLb=".5",InitialDesignUSD="100",OtherFixedCostsUSD="50",FobbingUSDPerContainer="200",InterestPct="12",InterestMonths="10",MarginPct="10"),
  _TCBCostInfo=dict(ProductUSDPerLb="2",Inputs=dict(PalletUSDPerEA="10",LossProductPct="10")))
class Contracts(unittest.TestCase):
 def test_saved_standalone_foB_and_destination_math(self):
  r=row();r["ShipmentCostInfo"].update(FreightUSDPerContainer="1000",DutyPct="10",ImportClearanceUSDPerContainer="100",PortToWHUSDPerContainer="200",
   WHCostUSDPerPallet="300",OverageShortageDamagePct="5",WHToCoManWHUSDPerPallet="400",CoManOverheadUSDPerPallet="500",
   FreightToCustomerUSDPerPallet="600",SpoilageAllowancePct="2",PaymentTermPct="3",CoManFeePct="4",BrokerFeePct="1")
  add_tcb_columns([r])
  self.assertNotIn("_TCBCostInfo",r)
  values=[r[k] for k in TCB_LABELS]
  self.assertEqual(values[:12],["1.8","0.2","0","0.01","0.5","0.2","0.1","0.2","0.301","0.3311","3.6421","5.46315"])
  self.assertEqual(values[12:21],["1","0.46421","0.1","0.2","0.3","0.2853155","0.4","0.5","0.6"])
  self.assertEqual(values[25],"4.6421")
  self.assertAlmostEqual(float(values[26]),7.4916255/.9,places=10)
  self.assertAlmostEqual(float(values[27]),7.4916255/.9*1.5,places=10)
 def test_mix_sharing_and_packaging_loss(self):
  root,a,b=row(10),row(11),row(12)
  root.update(IsMixParent=True,ProductMixSnapshot={"items":[{"ProductID":11,"UnitQuantity":2},{"ProductID":12,"UnitQuantity":1}]})
  for child in (a,b):child["ParentItemID"]=10
  root["_TCBCostInfo"]["Inputs"].update(MixPrimaryLossPct="10",MixSecondaryLossPct="20")
  a["_TCBCostInfo"]["Inputs"].update(PrimaryLossPct="10",SecondaryLossPct="20")
  add_tcb_columns([root,a,b])
  self.assertTrue(all(root[k] is None for k in TCB_COLUMNS))
  self.assertAlmostEqual(float(a["TCBSelfPackagingPerUnit"]),.1/.9+.1/.8,places=10)
  self.assertAlmostEqual(float(a["TCBParentPackagingPerUnit"]),(.1/.9+.1/.8)/3,places=10)
  self.assertEqual(a["TCBParentPackagingPerUnit"],b["TCBParentPackagingPerUnit"])
  self.assertEqual(a["TCBPalletPerUnit"],b["TCBPalletPerUnit"])
 def test_incomplete_and_zero_yield_never_become_zero_cost(self):
  r=row();r["_TCBCostInfo"]["Inputs"]["PrimaryLossPct"]="100";add_tcb_columns([r]);self.assertIsNone(r["TCBFOBPerUnit"])
  r=row();r["ConfigurationRequest"]="Both";add_tcb_columns([r]);self.assertIsNotNone(r["TCBDDPPerUnit"])
  r=row();r["ShipmentCostInfo"].update(SpoilageAllowancePct="50",PaymentTermPct="50");add_tcb_columns([r])
  self.assertIsNone(r["TCBDDPPerUnit"]);self.assertIsNotNone(r["TCBCFRPerUnit"])
 def test_revised_loading_interest_margin_clearance_and_informational_days(self):
  for mode,expected in (("Pallet load",.01),("Floor load",.015),("Both",.025)):
   r=row();r.update(ConfigurationRequest=mode,ApplicableNetWeightGrams="150")
   r["ShipmentCostInfo"].update(FloorLoadUSDPerMT="100",InterestDays=30,InterestMonths=None,
    MarginPct=None,MarginMode="USDPerLb",MarginUSDPerLb=".5",ImportClearanceCustomerPerPallet="150",PaymentTermDays=999)
   add_tcb_columns([r])
   self.assertAlmostEqual(float(r["TCBPalletPerUnit"]),expected)
   self.assertEqual(r["TCBMarginPerUnit"],"0.5")
   self.assertEqual(r["TCBClearancePerUnit"],"0.1")
   subtotal=sum(float(r[k]) for k in list(TCB_LABELS)[:8])
   self.assertAlmostEqual(float(r["TCBInterestPerUnit"]),subtotal*.12*30/360,places=10)
  r=row();r["ShipmentCostInfo"].update(ImportClearanceCustomerPerPallet="0",ImportClearanceUSDPerContainer="100")
  add_tcb_columns([r]);self.assertEqual(r["TCBClearancePerUnit"],"0")
 def test_schema_accepts_layout_and_blocks_excel_edits(self):
  from opportunity_views import OpportunityViews
  from opportunity_excel_api import Edit
  from pydantic import ValidationError
  view=OpportunityViews(items=dict(columns=list(TCB_COLUMNS),field_version=10))
  self.assertEqual(set(view.items.columns),TCB_COLUMNS)
  with self.assertRaises(ValidationError):Edit(row=5,number="OPP-1",item_changes={"TCBFOBPerUnit":"5"})
 def test_excel_subgroups_and_calculated_legend(self):
  import opportunity_excel_api as excel
  from opportunity_excel_sheet import section,subgroup
  self.assertEqual(section("TCBFOBPerUnit",set()),"TCB Review")
  self.assertEqual(subgroup("TCBDDPPerUnit","TCB Review"),"Selling Totals")
  self.assertEqual(excel.LABELS["TCBFOBPerUnit"],"FOB ($/unit)")
 def test_grid_pipeline_reads_saved_costs_and_removes_private_payload(self):
  from unittest.mock import patch
  import opportunity_views as views
  r=row();r.update(PackingWayVisible=False,ResponseLayerCount=None)
  with patch.object(views,"execute",return_value=[[r],[{"Total":1}]]) as execute:
   result=views.sorted_grid("Sales",1,25,"[]")
  self.assertIn("i.TCBCostInfo AS _TCBCostInfo",execute.call_args.args[0])
  self.assertEqual(result["rows"][0]["TCBProductPerUnit"],"1.8")
  self.assertIsNone(result["rows"][0]["TCBSelfPackagingPerUnit"])
  self.assertNotIn("_TCBCostInfo",result["rows"][0])
 def test_workbook_contains_numeric_values_group_headers_and_calculated_category(self):
  import io,zipfile
  from xml.etree import ElementTree as ET
  import opportunity_excel_api as excel
  r=row();r.update(OpportunityNumber="OPP-1",HeaderRowVersion="rv",ItemRowVersion="rv")
  add_tcb_columns([r])
  body=excel.View(views=dict(header=dict(columns=["OpportunityNumber"]),items=dict(columns=["ProductCode","TCBFOBPerUnit","TCBDDPCustomerPerUnit"],field_version=10)))
  data={"rows":[excel.workbook_row(r)],"total":1}
  blob=excel.build(body,data,"http://localhost:8000")
  with zipfile.ZipFile(io.BytesIO(blob)) as z:
   ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
   sheet=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
   rows=sheet.findall("s:sheetData/s:row",ns)
   def text(cell):
    return "".join(cell.itertext())
   index=next(i for i,c in enumerate(rows[2]) if "FOB ($/unit)" in text(c))
   self.assertEqual(text(rows[0][index]),"TCB Review")
   self.assertEqual(text(rows[1][index]),"FOB Costing")
   self.assertEqual(text(rows[3][index]),"Auto calculate")
   self.assertEqual(text(rows[4][index]),"3.6421")
if __name__=="__main__":unittest.main()
