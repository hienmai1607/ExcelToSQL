import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from load_planning_api import net_load_kg

class ContainerNetWeight(unittest.TestCase):
 def test_pcr33162_two_layer_net_excludes_packaging_and_pallet(self):
  snapshot=dict(NoOfSecondaryUnit=1,NoOfTertiaryUnit=None,PrimaryNetWeightGrams='400',SecondaryNetWeightGrams='2400',CartonGrossWeightKG='5.4096')
  self.assertEqual(net_load_kg(snapshot,2000),4800)
  self.assertEqual(net_load_kg(snapshot,1600),3840)
 def test_final_layer_for_standalone_mix_and_three_layers(self):
  self.assertEqual(net_load_kg({'PrimaryNetWeightGrams':'750'},20),15)
  self.assertEqual(net_load_kg({'NoOfSecondaryUnit':6,'NoOfTertiaryUnit':1,'SecondaryNetWeightGrams':'2400','TertiaryNetWeightGrams':'14400'},100),1440)
 def test_unknown_final_net_does_not_fall_back_to_inner_or_gross(self):
  self.assertIsNone(net_load_kg(None,100))
  self.assertIsNone(net_load_kg({'NoOfTertiaryUnit':1,'SecondaryNetWeightGrams':'2400','CartonGrossWeightKG':'20'},100))
  self.assertIsNone(net_load_kg({'PrimaryNetWeightGrams':'-1'},100))
  self.assertEqual(net_load_kg({'PrimaryNetWeightGrams':'0'},0),0)
if __name__=='__main__':unittest.main()
