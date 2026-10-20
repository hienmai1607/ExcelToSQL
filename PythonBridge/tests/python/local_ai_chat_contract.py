"""Private chat isolation, safe retries and bounded historical context."""
import json
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock,patch
from uuid import uuid4
from fastapi import HTTPException
from pydantic import ValidationError
import local_ai_api as ai
import local_ai_chat as chat
from local_ai_contract import ADMIN,DISPLAY,NONE,slot
from workspace_access import enforce_route

class ChatContract(unittest.TestCase):
 def test_sql_guid_strings_are_canonical_for_browser_history_selection(self):
  identifier=uuid4();cur=MagicMock();cur.fetchall.return_value=[(str(identifier).upper(),1)]
  @contextmanager
  def raw():yield cur
  with patch.object(chat,"get_raw_cursor",raw):self.assertEqual(chat.conversations(DISPLAY)["conversations"],[str(identifier)])

 def test_display_can_read_send_and_delete_private_history(self):
  for path,method in [("/api/ai/conversations","GET"),("/api/ai/conversations/123","DELETE"),("/api/ai/chat/preview","POST")]:
   enforce_route(DISPLAY,path,method)
   with self.assertRaises(HTTPException):enforce_route(NONE,path,method)

 def test_request_forbids_forged_history_and_identity(self):
  for extra in ({"history":[]},{"user_id":1},{"messages":[]},{"mode":"extract"},{"source":"opportunities"}):
   with self.assertRaises(ValidationError):chat.Chat(message="hello",conversation_id=uuid4(),request_id=uuid4(),**extra)

 def test_queries_bind_owner_even_for_admin_and_redact_revoked_lookup(self):
  cur=MagicMock()
  cur.fetchall.return_value=[(1,"private customer question",json.dumps({"answer":"Private","required_sources":["customers"]}),None,"help",uuid4(),"digest")]
  @contextmanager
  def raw():yield cur
  with patch.object(chat,"get_raw_cursor",raw):
   result=chat.history(uuid4(),DISPLAY)
   self.assertIsNone(result["turns"][0]["result"])
   self.assertNotIn("private customer",result["turns"][0]["question"])
   chat.turns(ADMIN,uuid4())
  for call in cur.execute.call_args_list:self.assertIn("WHERE UserID=? AND ConversationID=?",call.args[0])
  self.assertEqual(cur.execute.call_args.args[1],ADMIN.user_id)

 def test_delete_is_owner_bound_and_serialized_with_generation(self):
  cur=MagicMock()
  @contextmanager
  def raw():yield cur
  with patch.object(chat,"get_raw_cursor",raw),patch.object(chat,"generation_slot",slot):chat.remove(uuid4(),DISPLAY)
  self.assertIn("WHERE UserID=? AND ConversationID=?",cur.execute.call_args.args[0])
  self.assertEqual(cur.execute.call_args.args[1],DISPLAY.user_id)

 def test_duplicate_request_replays_without_model_and_mismatches_fail(self):
  body=chat.Chat(message="How?",conversation_id=uuid4(),request_id=uuid4())
  digest=chat.hashlib.sha256(body.message.encode()).hexdigest()
  cur=MagicMock();cur.fetchone.return_value=(body.conversation_id,digest,json.dumps({"answer":"Saved","required_sources":[]}),None)
  @contextmanager
  def raw():yield cur
  with patch.object(chat,"get_raw_cursor",raw),patch.object(chat,"generation_slot",slot),patch.object(chat,"respond") as model:
   self.assertEqual(chat.chat(body,DISPLAY)["answer"],"Saved");model.assert_not_called()
   with self.assertRaises(HTTPException):chat.chat(body.model_copy(update={"message":"Changed"}),DISPLAY)

 def test_failed_generation_does_not_insert_partial_turn(self):
  cur=MagicMock();cur.fetchone.return_value=None
  @contextmanager
  def raw():yield cur
  with patch.object(chat,"get_raw_cursor",raw),patch.object(chat,"generation_slot",slot),patch.object(chat,"turns",return_value=[{"question":"Old","result":{"answer":"Old"}}]),patch.object(chat,"respond",side_effect=HTTPException(503,"offline")):
   with self.assertRaises(HTTPException):chat.chat(chat.Chat(message="Hi",conversation_id=uuid4(),request_id=uuid4()),DISPLAY)
  self.assertFalse(any("INSERT" in c.args[0] for c in cur.execute.call_args_list))

 def test_followup_context_bounded_and_extraction_latest_only(self):
  history=[{"question":"old"*300,"answer":"answer"*100} for _ in range(20)]
  with patch.object(ai,"generate",return_value={"answer":"help","citations":[]}) as model:
   ai.run_preview(ai.Preview(message="Explain further"),DISPLAY,history,locked=True)
   system,user,_=model.call_args.args
   self.assertLessEqual(len((system+user).encode()),6500)
   self.assertTrue(model.call_args.kwargs["history"])
   self.assertLessEqual(len((system+user+"".join(t["question"]+t["answer"] for t in model.call_args.kwargs["history"])).encode()),6500)
  fields={"customer":None,"product":None,"net_weight_g":None,"annual_units":None,"container_type":None,"loading_mode":None}
  with patch.object(ai,"generate",return_value=fields) as model:
   ai.run_preview(ai.Preview(mode="extract",message="Latest text"),DISPLAY,history,locked=True)
   self.assertEqual(model.call_args.args[1],"Latest text")

 def test_transitive_permissions_checked_for_followup_replies(self):
  self.assertFalse(chat.result_allowed(DISPLAY,{"required_sources":["customers"]}))
  self.assertTrue(chat.result_allowed(DISPLAY,{"required_sources":["products"]}))

if __name__=="__main__":unittest.main()
