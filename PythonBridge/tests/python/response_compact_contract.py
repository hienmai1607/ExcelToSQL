import sys,unittest,json
from pathlib import Path
from unittest.mock import patch
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from packing_way import packing_way
import tcb_api
from auth import AccessContext
class Contracts(unittest.TestCase):
 def test_double_only_pallet_capacity(self):
  base=dict(WeightGrams=100,ResponseLayerCount=1,LayersPerPallet=5,CartonsPerLayer=10,PalletsPerContainer=20,CartonsPerContainer=123,CartonsPerContainerFloor=123)
  for mode in ("Pallet load","Floor load","Both"):
   a=packing_way(dict(base,ConfigurationRequest=mode,ResponsePalletStacking="Single"))
   b=packing_way(dict(base,ConfigurationRequest=mode,ResponsePalletStacking="Double"))
   self.assertEqual(int(b["CalculatedCartonsPerContainer"]),int(a["CalculatedCartonsPerContainer"])*(2 if mode=="Pallet load" else 1))
   self.assertEqual(a["UnitsPerPallet"],b["UnitsPerPallet"])
 def test_master_default_only_when_no_saved_override(self):
  ctx=AccessContext(1,"Admin",frozenset({"Admin"}))
  for saved,expected in ({}, "12.50"),({"Inputs":{"PalletUSDPerEA":"0"}},"0"),({"Inputs":{"PalletUSDPerEA":"7"}},"7"):
   item=dict(IsMixParent=True,DefaultPalletUSDPerEA=Decimal("12.50"),TCBCostInfo=json.dumps(saved))
   with patch.object(tcb_api,"item_read",return_value=item),patch.object(tcb_api,"active_loss_masters",return_value=[]):
    result=tcb_api.read(1,ctx)
   self.assertEqual(result["saved"]["Inputs"]["PalletUSDPerEA"],expected)
