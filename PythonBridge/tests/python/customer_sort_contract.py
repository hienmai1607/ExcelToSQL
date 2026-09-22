import sys, json, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from customer_sort import parse_sort
from preferences_api import Settings
from fastapi import HTTPException
from pydantic import ValidationError
class SortContract(unittest.TestCase):
 def test_valid_order_is_preserved(self):
  rules=[{"column":"CurrencyCode","direction":"desc"},{"column":"CustomerName","direction":"asc"}]
  self.assertEqual(json.loads(parse_sort(json.dumps(rules))),rules)
  self.assertEqual(parse_sort(None),None)
  self.assertEqual(parse_sort("[]"),"[]")
 def test_bad_rules_rejected(self):
  for value in ('{}','oops','[{"column":"ID","direction":"asc"}]','[{"column":"CustomerName","direction":"DROP TABLE"}]','[{"column":"CustomerName"},{"column":"CustomerName"}]'):
   with self.assertRaises(HTTPException):parse_sort(value)
 def test_profile_compatibility(self):
  self.assertEqual(Settings().sort[0].column,"CustomerName")
  with self.assertRaises(ValidationError):
   Settings(sort=[{"column":"Status"},{"column":"Status"}])
if __name__=="__main__":unittest.main()

