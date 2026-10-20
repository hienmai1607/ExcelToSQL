"""User-owned chat history. No shared memory, training, or business write tools."""
import hashlib
import json
from uuid import UUID
from fastapi import Depends, HTTPException
from pydantic import BaseModel,ConfigDict,Field
from auth import AccessContext, get_access_context
from db import get_raw_cursor
from local_ai_api import router, require_assistant, source_allowed, generation_slot, enabled
from local_ai_intent import respond

class Chat(BaseModel):
 model_config=ConfigDict(extra="forbid",str_strip_whitespace=True)
 message:str=Field(min_length=1,max_length=4000)
 conversation_id:UUID
 request_id:UUID

class Feedback(BaseModel):
 model_config=ConfigDict(extra="forbid",str_strip_whitespace=True)
 request_id:UUID
 comment:str=Field(min_length=1,max_length=2000)

def conversation_context(saved):
 context=[]
 for turn in saved[-6:]:
  reply=turn["result"]
  if not reply:
   context.append({"question":"A previous reply is unavailable under current permissions.","answer":"Its records cannot be referenced.","intent":None,"reference_unavailable":True})
   continue
  intent=reply.get("intent") or {}
  item={"question":turn["question"],"answer":reply["answer"],"intent":intent}
  if intent.get("mode")=="lookup" and intent.get("source")=="opportunities":
   # Legacy turns already have server-produced evidence; never trust model IDs.
   item["opportunity_ids"]=[int(r["ID"]) for r in reply.get("evidence",[]) if type(r.get("ID")) is int and r["ID"]>0][:10]
  context.append(item)
 return context

def result_allowed(ctx,result):
 return all(source in ("customers","products","opportunities","materials") and source_allowed(ctx,source) for source in result.get("required_sources",[]))

def turns(ctx,conversation_id):
 with get_raw_cursor() as cur:
  cur.execute("SELECT ID,Question,Result,Source,Mode,RequestID,RequestDigest,Feedback FROM dbo.LocalAIChatTurn WHERE UserID=? AND ConversationID=? ORDER BY ID",ctx.user_id,str(conversation_id))
  rows=cur.fetchall()
 result=[]
 for r in rows:
  reply=json.loads(r[2])
  allowed=(r[3] is None or source_allowed(ctx,r[3])) and result_allowed(ctx,reply)
  result.append({"id":r[0],"question":r[1],"result":reply if allowed else None,"request_id":str(r[5]),"digest":r[6],"feedback":r[7] if allowed and len(r)>7 else None})
 return result

@router.get("/conversations")
def conversations(ctx:AccessContext=Depends(get_access_context)):
 require_assistant(ctx)
 with get_raw_cursor() as cur:
  cur.execute("SELECT TOP(20) ConversationID,MAX(ID) FROM dbo.LocalAIChatTurn WHERE UserID=? GROUP BY ConversationID ORDER BY MAX(ID) DESC",ctx.user_id)
  return {"conversations":[str(UUID(str(r[0]))) for r in cur.fetchall()]}

@router.get("/conversations/{conversation_id}")
def history(conversation_id:UUID,ctx:AccessContext=Depends(get_access_context)):
 require_assistant(ctx)
 # Revoked lookup turns are redacted in full, including questions with pasted data.
 return {"turns":[{"id":t["id"],"question":t["question"] if t["result"] else "Previous lookup is unavailable under your current permissions.","result":t["result"],"request_id":t["request_id"],"feedback":t["feedback"]} for t in turns(ctx,conversation_id)]}

@router.post("/conversations/{conversation_id}/feedback")
def feedback(conversation_id:UUID,body:Feedback,ctx:AccessContext=Depends(get_access_context)):
 require_assistant(ctx)
 with get_raw_cursor() as cur:
  cur.execute("SELECT Result,Source FROM dbo.LocalAIChatTurn WHERE UserID=? AND ConversationID=? AND RequestID=?",ctx.user_id,str(conversation_id),str(body.request_id))
  row=cur.fetchone()
  if not row:raise HTTPException(404,"Conversation reply not found.")
  if not result_allowed(ctx,json.loads(row[0])) or row[1] is not None and not source_allowed(ctx,row[1]):
   raise HTTPException(403,"No access to this reply's sources.")
  cur.execute("UPDATE dbo.LocalAIChatTurn SET Feedback=?,FeedbackUpdatedAt=SYSUTCDATETIME() OUTPUT INSERTED.ID WHERE UserID=? AND ConversationID=? AND RequestID=?",body.comment,ctx.user_id,str(conversation_id),str(body.request_id))
  if cur.fetchone() is None:raise HTTPException(404,"Conversation reply not found.")
 return {"saved":True,"message":"Report saved for review. It does not automatically correct answers, retrain the model, or change business records."}

@router.delete("/conversations/{conversation_id}")
def remove(conversation_id:UUID,ctx:AccessContext=Depends(get_access_context)):
 require_assistant(ctx)
 # Same cross-worker lock prevents deletion racing an in-flight reply.
 with generation_slot(),get_raw_cursor() as cur:
  cur.execute("DELETE FROM dbo.LocalAIChatTurn WHERE UserID=? AND ConversationID=?",ctx.user_id,str(conversation_id))
 return {"deleted":True}

@router.post("/chat/preview")
def chat(body:Chat,ctx:AccessContext=Depends(get_access_context)):
 require_assistant(ctx)
 if not enabled():raise HTTPException(503,"Local AI is disabled on this API.")
 digest=hashlib.sha256(body.message.encode()).hexdigest()
 with generation_slot():
  with get_raw_cursor() as cur:
   cur.execute("SELECT ConversationID,RequestDigest,Result,Source FROM dbo.LocalAIChatTurn WHERE UserID=? AND RequestID=?",ctx.user_id,str(body.request_id))
   previous=cur.fetchone()
  if previous:
   if str(previous[0]).lower()!=str(body.conversation_id) or previous[1]!=digest:raise HTTPException(409,"Retry identifier does not match the original question.")
   if previous[3] is not None and not source_allowed(ctx,previous[3]):raise HTTPException(403,"No access to this lookup dataset.")
   reply=json.loads(previous[2])
   if not result_allowed(ctx,reply):raise HTTPException(403,"No access to the original conversation sources.")
   return reply
  saved=turns(ctx,body.conversation_id)
  if len(saved)>=100:raise HTTPException(409,"Conversation limit reached. Start a new chat.")
  if not saved:
   with get_raw_cursor() as cur:
    cur.execute("SELECT COUNT(DISTINCT ConversationID) FROM dbo.LocalAIChatTurn WHERE UserID=?",ctx.user_id)
    if cur.fetchval()>=20:raise HTTPException(409,"History limit reached. Delete an old conversation first.")
  # Recheck source access before replay. Never accept client-supplied assistant messages.
  context=conversation_context(saved)
  result=respond(body.message,ctx,context)
  result["request_id"]=str(body.request_id)
  intent=result["intent"]
  # Propagate access dependencies through follow-ups, including help-mode replies.
  result["required_sources"]=sorted({s for t in saved[-6:] if t["result"] for s in t["result"].get("required_sources",[])} | ({intent["source"]} if intent["source"] else set()))
  # One autocommit insert saves the completed pair atomically. Failed generations
  # leave no partial turns; stable request IDs make uncertain client retries safe.
  with get_raw_cursor() as cur:
   cur.execute("INSERT dbo.LocalAIChatTurn(UserID,ConversationID,RequestID,RequestDigest,Mode,Source,Question,Result) VALUES(?,?,?,?,?,?,?,?)",
    ctx.user_id,str(body.conversation_id),str(body.request_id),digest,intent["mode"],intent["source"],body.message,json.dumps(result,ensure_ascii=False))
  return result
