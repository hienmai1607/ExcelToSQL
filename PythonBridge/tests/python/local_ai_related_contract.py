"""Related counts must use server-resolved record selections, never model/caller IDs."""
import unittest
from unittest.mock import patch
import local_ai_intent as route
from local_ai_contract import ADMIN

class RelatedRegression(unittest.TestCase):
 def test_revoked_latest_reference_does_not_fall_back_to_an_older_list(self):
  context=[{"question":"Old list","answer":"Old","intent":{"mode":"lookup","source":"opportunities"},"opportunity_ids":[1]},
           {"question":"Unavailable","answer":"Unavailable","intent":None,"reference_unavailable":True}]
  with patch.object(route.ai,"generate",return_value={"mode":"lookup","source":"opportunities","detail":"items","selection":"listed"}),patch.object(route,"item_result") as query:
   result=route.respond("How many items in those opportunities?",ADMIN,context)
  self.assertEqual(result["intent"]["mode"],"clarify")
  query.assert_not_called()

 def test_followup_routes_to_items_using_the_previously_returned_ids(self):
  context=[{"question":"Show opportunities","answer":"Found 27. Showing 10.",
            "intent":{"mode":"lookup","source":"opportunities"},
            "opportunity_ids":[41,42]}]
  plan={"mode":"lookup","source":"opportunities","detail":"items","selection":"listed"}
  with patch.object(route.ai,"generate",return_value=plan),patch.object(route,"item_result",return_value={"answer":"2 items linked"},create=True) as query:
   result=route.respond("How many items in these opportunities already have a Packaging request?",ADMIN,context)
  self.assertEqual(result["intent"]["detail"],"items")
  self.assertEqual(query.call_args.args[2],[41,42])

 def test_missing_referent_clarifies_instead_of_counting_all(self):
  with patch.object(route.ai,"generate",return_value={"mode":"lookup","source":"opportunities","detail":"items","selection":"listed"}),patch.object(route,"item_result",create=True) as query:
   result=route.respond("How many items in those opportunities?",ADMIN,[])
  self.assertEqual(result["intent"]["mode"],"clarify")
  query.assert_not_called()

if __name__=="__main__":unittest.main()
