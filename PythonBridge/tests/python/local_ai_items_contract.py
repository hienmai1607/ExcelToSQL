"""Related item count, selection and feedback security contracts."""
import json
import os
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock,patch
from uuid import uuid4
from fastapi import HTTPException
from pydantic import ValidationError
from local_ai_contract import ADMIN,DISPLAY
import local_ai_items as items
import local_ai_intent as intent
import local_ai_chat as chat

class ItemSecurity(unittest.TestCase):
 def test_access_denial_precedes_sql_and_invalid_ids_are_rejected(self):
  plan=intent.Intent(mode="lookup",source="opportunities",detail="items",selection="listed")
  with patch.object(items,"get_raw_cursor") as sql:
   with self.assertRaises(HTTPException):items.item_result(plan,DISPLAY,[1])
   for ids in ([True],[0],list(range(1,12))):
    with self.assertRaises(HTTPException):items.item_result(plan,ADMIN,ids)
  sql.assert_not_called()

 def test_context_uses_evidence_not_forged_model_ids_or_feedback(self):
  reply={"answer":"Listed","intent":{"mode":"lookup","source":"opportunities"},
         "opportunity_ids":[999],"evidence":[{"ID":41},{"ID":42}],"feedback":"Unverified claim"}
  context=chat.conversation_context([{"question":"Show","result":reply}])
  self.assertEqual(context[0]["opportunity_ids"],[41,42])
  self.assertNotIn("feedback",context[0])

 def test_feedback_requires_ownership_and_never_generates_or_writes_business_data(self):
  cur=MagicMock();cur.fetchone.return_value=(json.dumps({"required_sources":[]}),None);cur.rowcount=1
  @contextmanager
  def raw():yield cur
  body=chat.Feedback(request_id=uuid4(),comment="Incorrect; expected 4 items.")
  with patch.object(chat,"get_raw_cursor",raw):
   self.assertTrue(chat.feedback(uuid4(),body,ADMIN)["saved"])
  for c in cur.execute.call_args_list:self.assertIn("WHERE UserID=? AND ConversationID=? AND RequestID=?",c.args[0])
  self.assertIn("UPDATE dbo.LocalAIChatTurn",cur.execute.call_args.args[0])
  self.assertEqual(cur.execute.call_args.args[1],body.comment)
  self.assertEqual(cur.execute.call_args.args[2],ADMIN.user_id)

 def test_unknown_reply_and_revoked_source_cannot_be_reported(self):
  cur=MagicMock()
  @contextmanager
  def raw():yield cur
  with patch.object(chat,"get_raw_cursor",raw):
   for row,status in [(None,404),((json.dumps({"required_sources":["customers"]}),None),403)]:
    cur.reset_mock();cur.fetchone.return_value=row
    with self.assertRaises(HTTPException) as error:chat.feedback(uuid4(),chat.Feedback(request_id=uuid4(),comment="Report"),DISPLAY)
    self.assertEqual(error.exception.status_code,status)
    self.assertFalse(any("UPDATE" in c.args[0] for c in cur.execute.call_args_list))

 def test_feedback_is_bounded_and_rejects_identity_fields(self):
  for extra in ({"comment":""},{"comment":"x"*2001},{"user_id":1}):
   with self.assertRaises(ValidationError):chat.Feedback.model_validate({"request_id":str(uuid4()),"comment":"Wrong",**extra})

@unittest.skipUnless(os.getenv("LOCAL_AI_SQL_TEST")=="1","Explicit local SQL fixture test only")
class SQLItemCounts(unittest.TestCase):
 def test_duplicates_children_cancellations_scope_and_empty_selection(self):
  from auth import get_access_context
  from db import get_raw_cursor
  ctx=get_access_context(None,None,None,None)
  with get_raw_cursor() as real:
   real.execute("BEGIN TRANSACTION")
   try:
    real.execute("""CREATE TABLE #AICustomer(ID INT,CustomerName NVARCHAR(100));
      CREATE TABLE #AIOpportunity(ID INT,OpportunityNumber NVARCHAR(30),OpportunityDesc NVARCHAR(100),CustomerID INT,CreatedBy INT,Stage VARCHAR(30));
      CREATE TABLE #AIItem(ID INT,OpportunityID INT,ParentItemID INT NULL);
      CREATE TABLE #AIRequest(OpportunityItemID INT,IsOpen BIT);""")
    while real.nextset():pass
    real.execute("""INSERT #AICustomer VALUES(1,'Fixture');
      INSERT #AIOpportunity VALUES(101,'A1','Fixture',1,?,'Draft'),(102,'A2','Fixture',1,?,'Draft'),(103,'Outside','Fixture',1,?,'Closed');
      INSERT #AIItem VALUES(11,101,NULL),(12,101,NULL),(13,101,NULL),(14,101,11),(21,102,NULL),(31,103,NULL);
      INSERT #AIRequest VALUES(11,1),(11,0),(13,0),(14,1),(21,0),(31,1);""",ctx.user_id,ctx.user_id,ctx.user_id)
    while real.nextset():pass
    class FixtureCursor:
     @property
     def description(self):return real.description
     def execute(self,sql,*params):
      for table,target in [("dbo.PackagingConfigurationRequestItem r","#AIRequest r"),("dbo.OpportunityItem i","#AIItem i"),("dbo.Opportunity o","#AIOpportunity o"),("dbo.Customer c","#AICustomer c")]:
       sql=sql.replace(table,target)
      real.execute(sql,*params)
     def fetchall(self):return real.fetchall()
    @contextmanager
    def raw():yield FixtureCursor()
    with patch.object(items,"get_raw_cursor",raw):
     plan=intent.Intent(mode="lookup",source="opportunities",detail="items",selection="listed")
     result=items.item_result(plan,ctx,[101,102])
     self.assertEqual(result["item_counts"],{"opportunities":2,"items":4,"linked":3,"open":1,"unrequested":1})
     self.assertEqual(set(result["opportunity_ids"]),{101,102})
     self.assertEqual(items.item_result(plan,ctx,[])["item_counts"]["items"],0)
     self.assertEqual(items.item_result(plan,ctx,[999])["item_counts"]["opportunities"],0)
     matching=intent.Intent(mode="lookup",source="opportunities",detail="items",mine=True,stage="Draft")
     self.assertEqual(items.item_result(matching,ctx)["item_counts"]["items"],4)
   finally:real.execute("ROLLBACK TRANSACTION")

if __name__=="__main__":unittest.main()
