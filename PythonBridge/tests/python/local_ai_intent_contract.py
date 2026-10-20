"""Automatic routing and fixed SQL count/filter security contracts."""
import unittest
from unittest.mock import MagicMock,patch
from contextlib import contextmanager
from fastapi import HTTPException
from pydantic import ValidationError
from auth import AccessContext
import local_ai_api as ai
import local_ai_intent as intent
from local_ai_contract import DISPLAY,ADMIN

SALES=AccessContext(7,"SalesViewer",frozenset({"Opportunity"}),{"opportunities":"display"})

class IntentContract(unittest.TestCase):
 def test_unsupported_count_or_date_filter_does_not_run_partial_lookup(self):
  cases=[("How many products do we have?",intent.Intent(mode="lookup",source="products")),
         ("Show my opportunities created this month",intent.Intent(mode="lookup",source="opportunities",mine=True))]
  for message,plan in cases:
   with patch.object(intent,"choose_intent",return_value=plan),patch.object(intent,"opportunity_result") as sql,patch.object(ai,"run_preview") as preview:
    result=intent.respond(message,ADMIN,[])
   self.assertEqual(result["intent"]["mode"],"clarify")
   sql.assert_not_called();preview.assert_not_called()

 def test_router_has_no_executable_fields_or_caller_identity(self):
  for payload in ({"sql":"SELECT secret"},{"user_id":1},{"tool":"delete"},{"mode":"lookup","source":"users"},{"mode":"lookup","source":"products","mine":True},{"mode":"lookup","source":"opportunities","stage":"Processing"}):
   with self.assertRaises(ValidationError):intent.Intent.model_validate({"mode":"help",**payload})

 def test_invalid_model_plan_asks_instead_of_running_a_query(self):
  with patch.object(ai,"generate",return_value={"mode":"extract","sql":"DELETE anything"}),patch.object(intent,"opportunity_result") as read:
   result=intent.respond("Show my opportunities",SALES,[])
  self.assertEqual(result["intent"]["mode"],"clarify")
  self.assertFalse(result["evidence"]);read.assert_not_called()

 def test_permissions_are_enforced_after_routing_before_database_read(self):
  plan=intent.Intent(mode="lookup",source="opportunities",mine=True,stage="In progress")
  with patch.object(intent,"choose_intent",return_value=plan),patch.object(intent,"get_raw_cursor") as database:
   with self.assertRaises(HTTPException) as error:intent.respond("Show mine",DISPLAY,[])
  self.assertEqual(error.exception.status_code,403);database.assert_not_called()

 def test_owner_and_status_are_bound_and_count_is_not_sample_size(self):
  cur=MagicMock();cur.description=[("ID",),("OpportunityNumber",),("MatchCount",)]
  cur.fetchall.return_value=[(8,"OPP-8",27)]
  @contextmanager
  def raw():yield cur
  plan=intent.Intent(mode="lookup",source="opportunities",mine=True,stage="In progress",search="A%';DROP")
  with patch.object(intent,"get_raw_cursor",raw):result=intent.opportunity_result(plan,SALES)
  sql,*params=cur.execute.call_args.args
  self.assertIn("COUNT_BIG(*) OVER()",sql);self.assertIn("TOP(10)",sql)
  self.assertIn("o.CreatedBy=?",sql);self.assertNotIn("DROP",sql)
  self.assertEqual(params[:6],[SALES.user_id,SALES.username,1,SALES.user_id,"In progress","In progress"])
  self.assertEqual(params[6],"A~%';DROP%")
  self.assertEqual(result["total"],27);self.assertEqual(len(result["evidence"]),1)
  self.assertIn("27 matching",result["answer"]);self.assertIn("created by you",result["answer"])
  self.assertNotIn("MatchCount",result["evidence"][0])

 def test_count_is_zero_if_there_are_no_matching_rows(self):
  cur=MagicMock();cur.description=[("ID",),("MatchCount",)];cur.fetchall.return_value=[]
  @contextmanager
  def raw():yield cur
  with patch.object(intent,"get_raw_cursor",raw):result=intent.opportunity_result(intent.Intent(mode="lookup",source="opportunities"),SALES)
  self.assertEqual(result["total"],0);self.assertEqual(result["evidence"],[])

 def test_explicit_extraction_and_help_use_their_internal_handlers(self):
  for mode in ("help","extract"):
   plan=intent.Intent(mode=mode)
   with patch.object(intent,"choose_intent",return_value=plan),patch.object(ai,"run_preview",return_value={"answer":"Preview"}) as run:
    result=intent.respond("Natural question",ADMIN,[])
   self.assertEqual(run.call_args.args[0].mode,mode)
   self.assertTrue(run.call_args.kwargs["locked"])
   self.assertEqual(result["intent"]["mode"],mode)

 def test_planner_context_is_bounded_and_contains_previous_filters(self):
  old={"mode":"lookup","source":"opportunities","mine":True,"stage":"In progress"}
  with patch.object(ai,"generate",return_value={"mode":"lookup","source":"opportunities","mine":True,"stage":"Closed"}) as model:
   plan=intent.choose_intent("What about closed ones?",[{"question":"old"*3000,"answer":"answer"*1000,"intent":old}]*10)
  system,user,schema=model.call_args.args
  self.assertEqual(set(schema["required"]),set(schema["properties"]))
  self.assertLessEqual(len((system+user).encode()),6500)
  self.assertIn('"mine": true',user);self.assertEqual(plan.stage,"Closed")

if __name__=="__main__":unittest.main()
