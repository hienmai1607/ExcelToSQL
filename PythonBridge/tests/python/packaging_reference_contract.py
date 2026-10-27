"""Fast currency and current-price selection regressions; no database writes."""
import sys
import unittest
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from pallet_currency import pallet_usd
from packaging_reference_api import newest_price,CopySections
from packaging_fields import ResponseFields


class ReferenceContract(unittest.TestCase):
 def test_vnd_snapshot_uses_opportunity_fx_without_mutation(self):
  snapshot={"UnitUSDPrice":None,"UnitPrice":"400000","CurrencyCode":"VND"}
  self.assertEqual(pallet_usd(snapshot,{"ExchangeRateVNDPerUSD":"25000"}),Decimal(16))
  self.assertIsNone(snapshot["UnitUSDPrice"])
 def test_captured_usd_is_authoritative_including_zero(self):
  self.assertEqual(pallet_usd({"UnitUSDPrice":"0","UnitPrice":"400000","CurrencyCode":"VND"},{}),0)
 def test_unknown_or_missing_rate_stays_blank(self):
  for owner in ({},{"ExchangeRateVNDPerUSD":0},{"ExchangeRateVNDPerUSD":"NaN"}):
   self.assertIsNone(pallet_usd({"UnitPrice":400000,"CurrencyCode":"VND"},owner))
  self.assertIsNone(pallet_usd({"UnitPrice":3,"CurrencyCode":"EUR"},{"CustomerCurrencyCode":"GBP","ExchangeRateCustomerCurrencyPerUSD":2}))
 def test_customer_currency_and_usd(self):
  self.assertEqual(pallet_usd({"UnitPrice":30,"CurrencyCode":"AUD"},{"CustomerCurrencyCode":"AUD","ExchangeRateCustomerCurrencyPerUSD":2}),15)
  self.assertEqual(pallet_usd({"UnitPrice":7,"CurrencyCode":"USD"},{}),7)
 def test_newest_quote_not_old_snapshot_id(self):
  old=dict(PriceID=1,MaterialID=5,VendorID=2,CurrencyCode="USD",PriceUoM="EA",VendorMOQ=100,QuantityTo=None)
  rows=[{**old,"EffectiveFrom":"2026-10-01"},{**old,"PriceID":2,"EffectiveFrom":"2026-10-26"},{**old,"PriceID":3,"VendorMOQ":1000,"EffectiveFrom":"2026-10-26"},{**old,"PriceID":4,"VendorID":9,"EffectiveFrom":"2026-10-26"}]
  self.assertEqual(newest_price(rows,old)["PriceID"],2)
  self.assertIsNone(newest_price(rows[2:],old))
 def test_pallet_quote_matching_keeps_vendor_and_tier(self):
  old=dict(ID=1,MaterialID=5,VendorID=2,CurrencyCode="USD",PriceBasis="EA",QuantityFrom=100,QuantityTo=None)
  self.assertEqual(newest_price([{**old,"ID":2,"EffectiveFrom":"2026-10-26"}],old,True)["ID"],2)
 def test_reference_json_is_bounded_and_section_only(self):
  self.assertIsNotNone(ResponseFields(ReferenceSetupJSON='{"Primary":{"materials":[]}}'))
  for value in ('[]','{"Invalid":{}}','broken'):
   with self.assertRaises(ValueError):ResponseFields(ReferenceSetupJSON=value)
 def test_legacy_pallet_snapshot_resolves_captured_vendor_name(self):
  old=dict(MaterialID=5,VendorName="Vendor 1",CurrencyCode="VND",PriceBasis="EA",QuantityFrom="100",QuantityTo="200")
  current={**old,"ID":2,"VendorID":8,"QuantityFrom":Decimal(100),"QuantityTo":Decimal(200),"EffectiveFrom":"2026-10-26"}
  self.assertEqual(newest_price([current],old,True)["ID"],2)
 def test_atomic_pallet_input_is_validated_before_business_writes(self):
  with self.assertRaises(ValueError):ResponseFields(PalletCalculation={"PalletSize":"1000x1200mm","components":[]})
  with self.assertRaises(ValueError):CopySections(LayerCount=1,sections={"Primary":True})

if __name__=="__main__":unittest.main()
