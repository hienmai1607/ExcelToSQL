import {useEffect,useState,type FormEvent} from 'react';
import {call} from './api';
import {Modal,Notification} from './ui';
import {IconButton} from './icons';
import type {Draft} from './opportunity-losses';
import type {TCBVersion,VersionReply} from './tcb-draft';
export function TCBVersionControls({d,dirty,busy,onWorking,onMetadata,onLoad,onActivated}:{d:Draft;dirty:boolean;busy:boolean;onWorking:(value:boolean)=>void;onMetadata:(v:TCBVersion)=>void;onLoad:(r:VersionReply)=>void;onActivated:(token:string)=>void}){
 const id=Number(d.row.ItemID),base='/api/opportunity/items/'+id+'/tcb-versions';
 const [versions,setVersions]=useState<TCBVersion[]>([]),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[create,setCreate]=useState(false),[name,setName]=useState(''),[source,setSource]=useState('');
 const locked=busy||working;
 useEffect(()=>{let active=true;call<{versions:TCBVersion[]}>(base).then(r=>{if(active){const list=r.versions??[];setVersions(list);if(!d.tcbVersion){const current=list.find(v=>v.IsActive);if(current)onMetadata(current)}}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[base,d.tcbVersion?.ID,d.tcbVersion?.RowVersion,d.version]);
 function discard(){return !dirty||window.confirm('Discard unsaved TCB changes before opening another version?')}
 async function run(fn:()=>Promise<void>){if(locked)return;setWorking(true);onWorking(true);setError('');setNotice('');try{await fn()}catch(e){setError((e as Error).message)}finally{setWorking(false);onWorking(false)}}
 async function load(versionID:number){onLoad(await call<VersionReply>(base+'/'+versionID))}
 function closeCreate(){if(!working){setCreate(false);setError('')}}
 async function saveNewVersion(event:FormEvent<HTMLFormElement>){
  event.preventDefault();event.stopPropagation();
  if(locked||!name.trim()||!discard())return;
  await run(async()=>{
   const from=versions.find(v=>String(v.ID)===source);
   const result=await call<{version:TCBVersion}>(base,{Name:name.trim(),ItemRowVersion:d.version,SourceVersionID:from?.ID??null,SourceRowVersion:from?.RowVersion??null});
   setVersions(list=>[...list,result.version]);setCreate(false);setNotice('TCB version saved.');await load(result.version.ID);
  });
 }
 return <div className="tcb-version-controls" aria-label={'TCB versions item '+id}>
  <label><span className="sr-only">Version</span><select aria-label={'TCB version item '+id} disabled={locked} value={d.tcbVersion?.ID??''} onChange={e=>{const next=Number(e.target.value);if(next&&discard())void run(()=>load(next))}}>
   {!d.tcbVersion&&<option value="">Current settings</option>}{versions.map(v=><option key={v.ID} value={v.ID}>{'V'+v.Version+' · '+v.Name+(v.IsActive?' · Active':'')}</option>)}
  </select></label>
  <span className={'tcb-version-state'+(d.tcbVersion?.IsActive?' active':'')}>{d.tcbVersion?.IsActive?'Active':d.tcbVersion?'Alternative':'Current approach'}</span>
  <IconButton icon="copy" label={'New TCB version item '+id} disabled={locked||d.readonly} onClick={()=>{setError('');setName('');setSource(String(d.tcbVersion?.ID??''));setCreate(true)}}/>
  {d.tcbVersion&&!d.tcbVersion.IsActive&&<button disabled={locked||d.readonly||dirty} title={dirty?'Save this version before activating it.':undefined} onClick={()=>{if(window.confirm('Activate this approach? It will replace the live TCB settings for this item.'))void run(async()=>{
   const result=await call<{RowVersion:string}>(base+'/'+d.tcbVersion!.ID+'/activate',{ItemRowVersion:d.version,VersionRowVersion:d.tcbVersion!.RowVersion});
   onActivated(result.RowVersion);setNotice('TCB version activated.');await load(d.tcbVersion!.ID);
  })}}>Set active</button>}
  <Notification value={notice} onDismiss={()=>setNotice('')}/>{!create&&<Notification value={error} severity="error" onDismiss={()=>setError('')}/>}
  {create&&<Modal label="New TCB version" className="dialog tcb-version-dialog" onClose={closeCreate}>
   <header className="customer-editor-heading"><h2>New TCB version</h2><IconButton icon="close" label="Close new TCB version" disabled={working} onClick={closeCreate}/></header>
   <form onSubmit={saveNewVersion}>
    <Notification value={error} severity="error" onDismiss={()=>setError('')}/><div className="tcb-version-fields">
     <label>Name<input aria-label="TCB approach name" required maxLength={100} value={name} disabled={working} onChange={e=>setName(e.target.value)}/></label>
     <label>Copy from<select aria-label="Copy TCB version from" value={source} disabled={working} onChange={e=>setSource(e.target.value)}><option value="">Blank approach</option>{versions.map(v=><option key={v.ID} value={v.ID}>{'V'+v.Version+' · '+v.Name+(v.IsActive?' · Active':'')}</option>)}</select></label>
     <p className="muted">Saved as an alternative. Set active when ready.</p>
    </div>
    <div className="tcb-version-actions"><button type="button" disabled={working} onClick={closeCreate}>Cancel</button><button type="submit" className="primary" disabled={working||!name.trim()}>{working?'Saving…':'Save'}</button></div>
   </form>
  </Modal>}
 </div>;
}
