"""Column width preferences are bounded, allow-listed, and independently scoped."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from preferences_api import Settings
from pydantic import ValidationError
class Widths(unittest.TestCase):
 def test_roundtrip(self):
  data=dict(column_widths={"CustomerName":280,"_Actions":180},masters={"materials":dict(columns=["MaterialName"],filters=[],column_widths={"MaterialName":300,"_Actions":230})},
   opportunity=dict(header=dict(columns=["OpportunityNumber"],column_widths={"OpportunityNumber":210}),items=dict(columns=["ProductCode"],column_widths={"ProductCode":220})),
   requests=dict(header=dict(columns=["RequestNumber"],column_widths={"RequestNumber":230,"_Actions":230}),items=dict(columns=["ProductCode"],column_widths={"_PIC":200,"_Assign":180,"_Documents":250,"_Response":300})))
  self.assertEqual(Settings.model_validate_json(Settings(**data).model_dump_json()).masters["materials"].column_widths["MaterialName"],300)
 def test_reject_invalid_widths(self):
  for width in [79,801,-1,100.5,"200",True]:
   with self.subTest(width=width),self.assertRaises(ValidationError):Settings(column_widths={"CustomerName":width})
 def test_unknown_keys_rejected(self):
  for data in [dict(column_widths={"Unknown":200}),dict(masters={"materials":dict(columns=["MaterialName"],filters=[],column_widths={"Unknown":200})}),dict(opportunity=dict(header=dict(columns=["OpportunityNumber"],column_widths={"Unknown":200}))),dict(requests=dict(header=dict(columns=["RequestNumber"],column_widths={"Unknown":200})))]:
   with self.assertRaises(ValidationError):Settings(**data)
 def test_old_profiles_load_without_widths(self):
  self.assertEqual(Settings().column_widths,{})
if __name__=="__main__":unittest.main()
