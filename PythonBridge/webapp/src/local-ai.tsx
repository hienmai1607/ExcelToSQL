import {useEffect,useRef,useState} from 'react';
import {call,type Row} from './api';
import {timestamp} from './datetime';
import {ErrorNote} from './ui';
import {Icon,IconButton} from './icons';
import {newId} from './id';
import './local-ai.css';
import {LOCAL_AI_LAUNCHER_DISABLED} from './feature-flags';
type Status={enabled:boolean;available:boolean;model:string;sources:string[]};
type Result={answer:string;model:string;evidence:Row[];citations:number[];truncated:boolean;total?:number;request_id?:string;as_of?:string;extracted:Record<string,unknown>|null};
type Turn={id:number;question:string;result:Result|null;request_id?:string;feedback?:string|null};
export function LocalAI(){
 const [open,setOpen]=useState(false),[status,setStatus]=useState<Status|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [message,setMessage]=useState('');
 const [conversation,setConversation]=useState(newId),[sessions,setSessions]=useState<string[]>([]),[turns,setTurns]=useState<Turn[]>([]);
 const pending=useRef<{key:string;id:string}|null>(null),log=useRef<HTMLDivElement>(null),launcher=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),question=useRef<HTMLTextAreaElement>(null),inFlight=useRef(false);
 useEffect(()=>{
  if(!open||inFlight.current)return;let active=true;setLoading(true);setError('');
  Promise.all([call<Status>('/api/ai/status'),call<{conversations:string[]}>('/api/ai/conversations'),call<{turns:Turn[]}>('/api/ai/conversations/'+conversation)])
   .then(([s,h,t])=>{if(active){setStatus(s);setSessions(h.conversations);setTurns(t.turns)}})
   .catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[open,retry,conversation]);
 useEffect(()=>{if(open)(question.current||panel.current)?.focus()},[open,loading]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight,behavior:'smooth'})},[turns,busy,open]);
 function close(){setOpen(false);launcher.current?.focus()}
 async function ask(){
  if(inFlight.current||loading||!message.trim()||!status?.available)return;
  inFlight.current=true;setBusy(true);setError('');
  const payload={message:message.trim(),conversation_id:conversation};
  const key=JSON.stringify(payload);if(pending.current?.key!==key)pending.current={key,id:newId()};
  const requestId=pending.current.id;
  try{
   const result=await call<Result>('/api/ai/chat/preview',{...payload,request_id:requestId});
   setTurns(old=>[...old,{id:Date.now(),question:payload.message,result,request_id:requestId}]);setMessage('');pending.current=null;
   setSessions(old=>[conversation,...old.filter(id=>id!==conversation)]);
  }catch(e){setError((e as Error).message)}
  finally{inFlight.current=false;setBusy(false);question.current?.focus()}
 }
 async function clear(){
  if(busy||!window.confirm('Permanently delete this private conversation?'))return;
  try{
   await call('/api/ai/conversations/'+conversation,undefined,'DELETE');
   setSessions(old=>old.filter(id=>id!==conversation));setTurns([]);setMessage('');setConversation(newId());
  }catch(e){setError((e as Error).message)}
 }
 return <><button ref={launcher} type="button" className="local-ai-launch" aria-label="AI assistant" title={LOCAL_AI_LAUNCHER_DISABLED?'AI assistant temporarily disabled':'AI assistant'} disabled={LOCAL_AI_LAUNCHER_DISABLED} aria-expanded={open} aria-controls="local-ai-chat" onClick={()=>open?close():setOpen(true)}><Icon name="chat"/></button>
 {open&&!LOCAL_AI_LAUNCHER_DISABLED&&<section ref={panel} tabIndex={-1} id="local-ai-chat" role="dialog" aria-modal="false" aria-label="Local AI assistant" className="local-ai-dialog" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close()}}}>
 <header className="local-ai-heading"><div><h2>AI assistant</h2><small>Local Qwen3.5 4B · Business data read-only</small></div><IconButton icon="close" label="Close AI assistant" onClick={close}/></header>
 <p className="local-ai-privacy">Chats are saved privately to your account. History helps follow-ups; it does not retrain the model. Verify AI answers.</p>
 <div className="local-ai-history"><label>Conversation<select aria-label="Chat history" disabled={busy||loading} value={sessions.includes(conversation)?conversation:''} onChange={e=>{if(e.target.value){setMessage('');setConversation(e.target.value)}}}><option value="">New conversation</option>{sessions.map((id,i)=><option key={id} value={id}>Conversation {sessions.length-i} · {id.slice(0,8)}</option>)}</select></label><IconButton icon="plus" label="New chat" disabled={busy||loading} onClick={()=>{setConversation(newId());setTurns([]);setMessage('')}}/><IconButton icon="trash" label="Delete conversation" disabled={busy||loading||!turns.length} onClick={()=>void clear()}/></div>
 <div ref={log} className="local-ai-messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions">
 {!turns.length&&!loading&&<p>Ask naturally about your work, records, or how to use PythonBridge. I will ask if I need more detail.</p>}
 {turns.map(t=><article key={t.id}><p className="local-ai-question"><strong>You</strong><br/>{t.question}</p>{t.result?<><Reply result={t.result}/><FeedbackControl conversation={conversation} turn={t}/></>:<p>Reply unavailable under your current permissions.</p>}</article>)}
 {busy&&<p role="status">Thinking locally… You can minimize the chat while waiting.</p>}
 </div><ErrorNote value={error}/>
 {loading?<p role="status">Loading private chat…</p>:!status?.available?<div><p>{status&&!status.enabled?'AI is disabled on this API.':'Local AI is unavailable. Start Ollama and check the installed Qwen3.5 4B model.'}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>Retry AI connection</button></div>:<form onSubmit={e=>{e.preventDefault();void ask()}}>
 <fieldset disabled={busy}><label>Message<textarea ref={question} aria-label="AI question" rows={2} maxLength={4000} required value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask()}}} placeholder="Ask a question… (Shift+Enter for a new line)"/></label>
 <button className="primary" type="submit" disabled={!message.trim()}>{busy?'Thinking…':'Ask local AI'}</button></fieldset></form>}
 </section>}</>;
}
function Reply({result}:{result:Result}){
 const columns=result.evidence.length?Object.keys(result.evidence[0]):[];
 return <section className="local-ai-result" aria-label="AI result"><strong>AI assistant</strong><p className="local-ai-answer">{result.answer}</p>{result.as_of&&<small>Database checked: {timestamp(result.as_of)}</small>}
 {result.truncated&&result.total==null&&<p>Only the first 10 matches are included. Narrow the search; this is not a complete dataset.</p>}
 {!!result.evidence.length&&<details open><summary>Database evidence</summary><div className="table-wrap"><table><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{result.evidence.map(r=><tr key={String(r.ID)}>{columns.map(c=><td key={c}>{r[c]==null?'—':String(r[c])}</td>)}</tr>)}</tbody></table></div></details>}
 {result.extracted&&<><h4>Extracted draft fields — not saved</h4><dl>{Object.entries(result.extracted).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value==null?'Not supplied':Array.isArray(value)?value.map(String).join('; '):String(value)}</dd></div>)}</dl></>}
 </section>;
}



function FeedbackControl({conversation,turn}:{conversation:string;turn:Turn}){
 const [editing,setEditing]=useState(false),[comment,setComment]=useState(turn.feedback||''),[saved,setSaved]=useState(!!turn.feedback),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const requestId=turn.request_id||turn.result?.request_id;
 if(!requestId)return null;
 async function report(){
  if(busy||!comment.trim())return;setBusy(true);setError('');
  try{await call('/api/ai/conversations/'+conversation+'/feedback',{request_id:requestId,comment:comment.trim()});setSaved(true);setEditing(false)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="local-ai-feedback">
 <button type="button" className="link" onClick={()=>setEditing(!editing)}>{saved?'Update incorrect-answer report':'Report incorrect answer'}</button>
 {saved&&<small role="status">Report saved for review. No automatic retraining or business-data changes.</small>}
 {editing&&<form onSubmit={e=>{e.preventDefault();void report()}}>
 <label>What is incorrect? Include the expected result or record reference.<textarea aria-label="Answer correction" rows={3} maxLength={2000} value={comment} disabled={busy} onChange={e=>setComment(e.target.value)} required/></label>
 <small>Do not include passwords or secrets. This report is private to your account; share its reference with support when requesting a review.</small>
 <small>Reference: {conversation} / {requestId}</small>
 <ErrorNote value={error}/>
 <button type="submit" disabled={busy||!comment.trim()}>{busy?'Saving report…':'Save correction report'}</button>
 <button type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancel report</button>
 </form>}
 </div>;
}
