import copy
import sys
import unittest
from decimal import Decimal as D
from fractions import Fraction as F
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from tcb_costs import Inputs,calculate,leaves
from tcb_snapshot_costs import processing_snapshot_costs
from tcb_analysis_columns import add_tcb_columns,packing_rate


class SharedCosts(unittest.TestCase):
 def test_legacy_leaf_recipe_with_global_loss_keeps_captured_calculation(self):
  value={'ProductUSDPerLb':'3.611','Inputs':{'LossProductPct':'2.54'},
   'PriceSnapshots':[{'Path':'0/1/1','USDPerLb':'3.6','Proportion':'1'}],
   'MaterialCostSnapshots':[{'Path':'0/1/1','ProductUSDPerLb':'3.611','Inputs':{'ProcessingUSDPerLb':'.1'}}]}
  self.assertEqual(processing_snapshot_costs(value),value)

 def processing(self):
  tree=leaves([dict(ParentID='0',ID=1,Grade='Grade',RatioPct=100,Process=True)])
  inputs=Inputs(Prices=[dict(Path='0/1',DirectUSDPerLb=2)],
   LossProcesses=[dict(ProcessType='Processing',Sequence=1,LossPct=0)],
   ProcessLosses=[dict(Path='0/1',Ratios=[20])],
   MaterialCosts=[dict(Path='0/1',RMRatio=90,SeasoningRatio=10,SeasoningUSDPerLb=1,ProcessingUSDPerLb='.5')])
  result=calculate(inputs,tree,{})
  self.assertEqual(D(result['ProductUSDPerLb']),D('2.975'))
  self.assertEqual(D(result['RMCostUSDPerLb']),D('2.25'))
  self.assertEqual(D(result['RMWithoutLossUSDPerLb']),D('1.8'))
  self.assertEqual(D(result['MaterialCostSnapshots'][0]['ProcessingWithLossUSDPerLb']),D('.625'))
  return {**result,'Inputs':inputs.model_dump(mode='json')}

 def test_processing_loss_applies_to_charge_once(self):
  value=self.processing();self.assertEqual(processing_snapshot_costs(value),value)

 def test_old_raw_totals_are_recipe_weighted_without_changing_product(self):
  value=self.processing();value.pop('RMRecipeRatioApplied');value['RMCostUSDPerLb']='2.5'
  before=copy.deepcopy(value)
  revised=processing_snapshot_costs(value)
  self.assertEqual(D(revised['RMCostUSDPerLb']),D('2.25'))
  self.assertEqual(D(revised['RMWithoutLossUSDPerLb']),D('1.8'))
  self.assertEqual(revised['ProductUSDPerLb'],value['ProductUSDPerLb'])
  self.assertEqual(value,before)

 def test_legacy_processing_reprices_read_only_captured_prices(self):
  value=self.processing();value['ProductUSDPerLb']='2.85'
  for row in value['MaterialCostSnapshots']:
   row.pop('ProcessingWithLossUSDPerLb');row.pop('RMWithoutLossUSDPerLb')
  before=copy.deepcopy(value)
  self.assertEqual(D(processing_snapshot_costs(value)['ProductUSDPerLb']),D('2.975'))
  self.assertEqual(value,before)

 def test_weighted_legacy_rate_and_parent_override(self):
  root={'ItemID':10,'IsMixParent':True,'ProductMixSnapshot':{'items':[{'ProductID':11,'UnitQuantity':2},{'ProductID':12,'UnitQuantity':1}]}}
  a={'ProductID':11,'WeightGrams':'453.59237','OwnShipmentCostInfo':{'PackingUSDPerLb':'.2'}}
  b={'ProductID':12,'WeightGrams':'907.18474','OwnShipmentCostInfo':{'PackingUSDPerLb':'.8'}}
  self.assertEqual(packing_rate(root,[a,b]),F('.5'))
  root['_TCBCostInfo']={'Inputs':{'PackingUSDPerLb':'.3'}}
  self.assertEqual(packing_rate(root,[a,b]),F('.3'))
  root['_TCBCostInfo']['Inputs']['PackingUSDPerLb']='0'
  self.assertEqual(packing_rate(root,[a,b]),0)

 def test_final_carton_sums_child_quantities_and_rounds_each_currency_up(self):
  def row(identity,weight):
   return dict(ItemID=identity,ProductID=identity,WeightGrams=weight,ResponseLayerCount=2,UnitsPerCarton=10,UnitsPerPallet=1000,
    AnnualUnit=1000,EstPctAwarded=50,PrimaryPricePerUnit=0,PrimaryPriceCurrencyCode='USD',SecondaryPricePerUnit=0,SecondaryPriceCurrencyCode='USD',
    CustomerCurrencyCode='AUD',ExchangeRateCustomerCurrencyPerUSD='1.5',ContainerRequest='20DC',ConfigurationRequest='Pallet load',
    ContainerLoadResults={'20DC':{'CalculatedCartonsPerContainer':100}},DefaultPalletUSDPerEA=0,
    _TCBCostInfo={'ProductUSDPerLb':'2','Inputs':{'LossProductPct':0}},OwnShipmentCostInfo={})
  root=row(10,'1814.36948');root.update(IsMixParent=True,ProductMixSnapshot={'items':[{'ProductID':11,'UnitQuantity':2},{'ProductID':12,'UnitQuantity':1}]},ShipmentCostInfo={'FreightUSDPerContainer':100})
  root['_TCBCostInfo']['Inputs']['PackingUSDPerLb']='.333333'
  a=row(11,'453.59237');b=row(12,'907.18474')
  for child in (a,b):child.update(ParentItemID=10,MixUnitQuantity=2 if child is a else 1)
  add_tcb_columns([root,a,b])
  self.assertEqual(a['TCBFOBFinalBoxUSD'],'93.34');self.assertEqual(a['TCBFOBFinalBoxCustomer'],'140.00')
  self.assertEqual(a['TCBCFRFinalBoxUSD'],'94.34');self.assertEqual(a['TCBDDPFinalBoxCustomer'],'141.50')
  self.assertEqual(a['TCBFOBFinalBoxUSD'],b['TCBFOBFinalBoxUSD'])


if __name__=='__main__':unittest.main()
