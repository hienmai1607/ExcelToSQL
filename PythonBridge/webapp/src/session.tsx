import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {api,type Session} from './api';
import {ErrorNote} from './ui';
import './login.css';
const TIMEOUT=10*60*1000;
const SessionContext=createContext<Session>(null!);
export const useSession=()=>useContext(SessionContext);
export function SessionGate({children}:{children:ReactNode}){
 const [session,setSession]=useState<Session|null>(null),[locked,setLocked]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [testUser,setTestUser]=useState(()=>sessionStorage.getItem('bridge.testUser')||'');
 const lastActivity=useRef(Date.now()),lockedRef=useRef(true),pending=useRef(false),dialog=useRef<HTMLDialogElement>(null),workspace=useRef<HTMLDivElement>(null),previousFocus=useRef<HTMLElement|null>(null);
 function lock(){if(lockedRef.current)return;lockedRef.current=true;previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setLocked(true);setError('')}
 useEffect(()=>{
  if(!session)return;
  const expire=()=>{if(!lockedRef.current&&Date.now()-lastActivity.current>=TIMEOUT){lock();return true}return false};
  const activity=(event:Event)=>{if(lockedRef.current)return;if(expire()){event.preventDefault();event.stopImmediatePropagation();return}if(document.visibilityState==='visible')lastActivity.current=Date.now()};
  const check=()=>{expire()};
  const events=['pointerdown','pointermove','keydown','wheel','touchstart'];
  for(const event of events)window.addEventListener(event,activity,{capture:true,passive:false});
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  const timer=window.setInterval(check,1000);
  return()=>{clearInterval(timer);for(const event of events)window.removeEventListener(event,activity,true);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)};
 },[session]);
 useEffect(()=>{
  const node=dialog.current;if(!node)return;
  if(locked){if(!node.open)node.showModal()}else{node.close();previousFocus.current?.focus()}
 },[locked]);
 async function signIn(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  const oldHeader=sessionStorage.getItem('bridge.testUser');
  sessionStorage.setItem('bridge.testUser',testUser.trim());
  try{
   const next=await api.session();
   const sameUser=!session||(session.user_id!==undefined&&next.user_id!==undefined?session.user_id===next.user_id:session.username.toLowerCase()===next.username.toLowerCase());
   if(!sameUser)throw new Error('Sign in as '+session!.username+' to resume this work. A different account cannot open it.');
   setSession(next);lastActivity.current=Date.now();lockedRef.current=false;setLocked(false);
  }catch(e){if(oldHeader===null)sessionStorage.removeItem('bridge.testUser');else sessionStorage.setItem('bridge.testUser',oldHeader);setError(e instanceof Error?e.message:'Sign-in failed. Try again.')}
  finally{pending.current=false;setBusy(false)}
 }
 return <>
 {session&&<SessionContext.Provider value={session}><div ref={workspace} className={locked?'workspace-locked':''} inert={locked} aria-hidden={locked}>{children}</div></SessionContext.Provider>}
 <dialog ref={dialog} className="login-gate" aria-label={session?'Session locked':'Sign in'} onCancel={e=>e.preventDefault()}>
 <div className="login-card"><div className="login-brand"><span>P</span><strong>Presales PL3.0</strong></div><h1>{session?'Welcome back':'Sign in'}</h1>
 <p className="login-intro">{session?'Your work is saved in this browser. Sign in to continue.':'Use your company identity to continue.'}</p>
 {session&&<div className="login-account">Resume as <strong>{session.username}</strong></div>}
 <ErrorNote value={error}/>
 <form onSubmit={e=>{e.preventDefault();signIn()}}>
 <button className="primary login-submit" disabled={busy} type="submit">{busy?'Verifying…':session?'Sign in to resume':'Sign in'}</button>
 <details><summary>Development sign-in</summary><label>Test username<input autoComplete="off" value={testUser} disabled={busy} onChange={e=>setTestUser(e.target.value)}/></label><p>Available only when the API uses development-header mode.</p></details>
 </form></div>
 </dialog></>
}
