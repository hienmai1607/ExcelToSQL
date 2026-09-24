import sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from pydantic import ValidationError
import request_views as views
from preferences_api import Settings
class Contracts(unittest.TestCase):
 def test_allowlisted_sort(self):
  for raw in ('{}','[{"column":"Cost"}]','[{"column":"PIC","direction":"DROP"}]','[{"column":"PIC"},{"column":"PIC"}]'):
   with self.assertRaises(HTTPException):views.order(raw,views.ITEMS,"ItemID ASC")
 def test_header_sql_filter_before_paging(self):
  with patch("packaging_api.execute",return_value=[[],[{"Total":7}]]) as sql:
   result=views.header_read("Sales",2,10,"x';drop","Open",'[{"column":"ResponseDue","direction":"asc"}]')
   query,params=sql.call_args.args
   self.assertIn("[ResponseDue] ASC, RequestID DESC",query)
   self.assertIn("usp_Packaging_Authorize",query)
   self.assertNotIn("x';drop",query)
   self.assertIn("x';drop%",params)
   self.assertEqual(result["total"],7)
 def test_item_read_does_not_expose_private_response(self):
  with patch("packaging_api.execute",return_value=[[],[{"Total":1000}]]) as sql:
   result=views.item_read("Sales",5,2,200,None,None,'[{"column":"AnnualUnit","direction":"desc"}]')
   query,params=sql.call_args.args
   self.assertIn("[AnnualUnit] DESC, ItemID ASC",query)
   self.assertIn("i.RowVersion ItemRowVersion",query)
   self.assertIn("CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.Cost END Cost",query)
   self.assertIn(5,params)
   self.assertEqual(result["total"],1000)
 def test_combined_request_ids_are_typed_parameters(self):
  with patch("packaging_api.execute",return_value=[[],[{"Total":0}]]) as sql:
   views.item_read("PIC",None,1,10001,None,None,"[]",request_ids=[12,13])
   query,params=sql.call_args.args
   self.assertIn("WITH (RequestID INT '$')",query)
   self.assertEqual(params.count("[12, 13]"),2)
   self.assertNotIn("[12, 13]",query)
 def test_separate_profile(self):
  s=Settings(requests={"header":{"columns":["RequestNumber","RequestedByName"],"filters":["status"],"values":{"status":"Open"}},"items":{"columns":["ProductCode","PIC"],"sort":[{"column":"PIC"}]}})
  self.assertEqual(s.requests.header.values["status"],"Open")
  self.assertIsNone(s.opportunity.header)
  for v in ({"items":{"columns":["Cost"]}},{"header":{"columns":["RequestNumber"],"values":{"status":"Invalid"}}}):
   with self.assertRaises(ValidationError):Settings(requests=v)
if __name__=="__main__":unittest.main()
