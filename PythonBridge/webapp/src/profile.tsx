import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {call} from './api';
import {setDateOptions,dateFormats,type DateFormat,type TimeFormat} from './date-format';
import './workspace.css';
import {IconButton} from './icons';
import {ErrorNote,PageSizeSetting,LayoutPanel,ColumnOrder,Notification,InfoTip,Modal} from './ui';
import type {MasterLayout,MasterEntity} from './master-config';
import type {OpportunityViews} from './opportunity-view';
export const columnLabels={CustomerName:'Customer',MarketCode:'Market',CurrencyCode:'Currency',Status:'Status',UpdatedAt:'Last updated',CreatedAt:'Created at',CreatedByName:'Created by',UpdatedByName:'Updated by'};
export type Column=keyof typeof columnLabels;
export type SortRule={column:Column;direction:'asc'|'desc'};
export type Filter='customer_name'|'market_id'|'status'|'currency_id'|'created_by';
export type Settings={date_format?:DateFormat;time_format?:TimeFormat;list_layouts?:Partial<Record<'unit-conversions'|'packaging-dimensions',{page_size:number}>>;column_widths?:Record<string,number>;requests?:OpportunityViews;opportunity?:OpportunityViews;shared_masters?:Partial<Record<'ports'|'loss-processes'|'categories'|'grade-densities',MasterLayout>>;masters?:Partial<Record<MasterEntity,MasterLayout>>;sort:SortRule[];columns:Column[];filters:Filter[];customer_name:string;market_id:string;currency_id:string;created_by:string;status:string;page_size:number;dark:boolean;nav_hidden:boolean};
export const defaults:Settings={date_format:"mm/dd/yyyy",time_format:"12h",sort:[{column:'CustomerName',direction:'asc'}],columns:['CustomerName','MarketCode','CurrencyCode','Status','UpdatedAt'],filters:['customer_name','market_id','status'],customer_name:'',market_id:'',currency_id:'',created_by:'',status:'',page_size:25,dark:false,nav_hidden:false};
type Profile={settings:Settings;version:number};
type Context={profile:Profile;ready:boolean;error:string;saving:boolean;save:(s:Settings)=>Promise<void>;reload:()=>void;setAppearance:(s:Partial<Settings>)=>void};
const ProfileContext=createContext<Context>(null!);
export const useProfile=()=>useContext(ProfileContext);
export function ProfileProvider({enabled,children}:{enabled:boolean;children:ReactNode}){
 const [profile,setProfile]=useState<Profile>({settings:defaults,version:0}),[ready,setReady]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!enabled)return;let active=true;setReady(false);setError('');call<Profile>('/api/workbench/preferences').then(x=>{if(active){setProfile(x);setReady(true)}}).catch(e=>{if(active)setError('Profile unavailable: '+e.message)});return()=>{active=false}},[enabled,revision]);
 useEffect(()=>{setDateOptions(profile.settings.date_format,profile.settings.time_format)},[profile.settings.date_format,profile.settings.time_format]);
 useEffect(()=>{document.documentElement.dataset.theme=profile.settings.dark?'dark':'light';return()=>{delete document.documentElement.dataset.theme}},[profile.settings.dark]);
 async function save(settings:Settings){if(!ready||saving)throw new Error('Profile not ready.');setSaving(true);try{const next=await call<Profile>('/api/workbench/preferences',{settings,version:profile.version});setProfile(next);setError('')}catch(e){setError(e instanceof Error?e.message:'Profile save failed.');throw e}finally{setSaving(false)}}
 return <ProfileContext.Provider value={{profile,ready,error,saving,save,reload:()=>setRevision(x=>x+1),setAppearance:s=>setProfile(p=>({...p,settings:{...p.settings,...s}}))}}>{children}</ProfileContext.Provider>
}
export function WorkspaceFrame({children}:{children:ReactNode}){
 const {profile}=useProfile();
 return <div className={'app'+(profile.settings.nav_hidden?' nav-hidden':'')}>{children}</div>
}
export function useListLayout(key:'unit-conversions'|'packaging-dimensions',defaultSize=25){
 const {profile,ready,saving,save}=useProfile();
 const [pageSize,setPageSize]=useState(defaultSize),[open,setOpen]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const savedSize=profile.settings.list_layouts?.[key]?.page_size??defaultSize;
 useEffect(()=>{if(ready)setPageSize(savedSize)},[ready,savedSize]);
 async function persist(){setError('');setMessage('');try{await save({...profile.settings,list_layouts:{...profile.settings.list_layouts,[key]:{page_size:pageSize}}});setMessage('Layout saved to your profile.')}catch(e){setError((e as Error).message)}}
 return {pageSize,setPageSize,open,setOpen,persist,error,message,dismissMessage:()=>setMessage(''),canSave:ready&&!saving};
}
export function ListLayoutTools({control}:{control:ReturnType<typeof useListLayout>}){
 return <><IconButton icon="layout" label="Layout options" aria-expanded={control.open} onClick={()=>control.setOpen(!control.open)}/>{control.open&&<LayoutPanel className="layout-panel utility-layout" aria-label="List layout"><h2>List layout</h2><PageSizeSetting value={control.pageSize} onChange={control.setPageSize}/><ErrorNote value={control.error}/><Notification value={control.message} onDismiss={control.dismissMessage}/><div className="actions"><button disabled={!control.canSave} onClick={control.persist}>Save layout to profile</button><button onClick={()=>control.setOpen(false)}>Close layout</button></div></LayoutPanel>}</>;
}
export function AppearanceControls(){
 const {profile,ready,error,saving,save,reload,setAppearance}=useProfile();
 const lock=useRef(false);
 async function changeAppearance(next:Partial<Settings>){
  if(lock.current||!ready||saving)return;
  lock.current=true;const previous=profile.settings;
  setAppearance(next);
  try{await save({...previous,...next})}catch{setAppearance({dark:previous.dark,nav_hidden:previous.nav_hidden})}finally{lock.current=false}
 }
 return <div className="appearance-controls"><WorkspaceSettings/><IconButton icon="menu" label={profile.settings.nav_hidden?'Expand navigation':'Collapse navigation'} disabled={!ready||saving} onClick={()=>changeAppearance({nav_hidden:!profile.settings.nav_hidden})}/>
 <IconButton icon="moon" label="Dark mode" aria-pressed={profile.settings.dark} disabled={!ready||saving} onClick={()=>changeAppearance({dark:!profile.settings.dark})}/>
 {error&&<details><summary>Profile needs attention</summary><p>{error}</p><button onClick={reload}>Reload profile</button></details>}</div>
}
export function WorkspaceSettings(){
 const {profile,ready,saving,save}=useProfile();
 const [open,setOpen]=useState(false),[format,setFormat]=useState<DateFormat>('mm/dd/yyyy'),[time,setTime]=useState<TimeFormat>('12h'),[error,setError]=useState('');
 async function persist(){setError('');try{await save({...profile.settings,date_format:format,time_format:time});setOpen(false)}catch(e){setError((e as Error).message)}}
 return <><IconButton icon="settings" label="Settings" disabled={!ready||saving} onClick={()=>{setFormat(profile.settings.date_format??'mm/dd/yyyy');setTime(profile.settings.time_format??'12h');setError('');setOpen(true)}}/>{open&&<Modal label="Settings" onClose={()=>{if(!saving)setOpen(false)}}><header className="customer-editor-heading"><h2>Settings</h2><IconButton icon="close" label="Close Settings" disabled={saving} onClick={()=>setOpen(false)}/></header><ErrorNote value={error}/><div className="master-fields"><label>Date format<select aria-label="Date format" value={format} onChange={e=>setFormat(e.target.value as DateFormat)}>{dateFormats.map(f=><option key={f}>{f}</option>)}</select></label><label>Time format<select aria-label="Time format" value={time} onChange={e=>setTime(e.target.value as TimeFormat)}><option value="12h">12-hour (02:30 PM)</option><option value="24h">24-hour (14:30)</option></select></label></div><div className="actions"><button className="primary" disabled={saving} onClick={persist}>Save Settings</button></div></Modal>}</>;
}
export async function exportCustomerView(columns:Column[],rows:(string|null)[][]){
 const headers:Record<string,string>={'Content-Type':'application/json'};
 const user=sessionStorage.getItem('bridge.testUser');if(user)headers['X-User-Name']=user;
 const response=await fetch('/api/workbench/customers/export',{method:'POST',credentials:'same-origin',headers,body:JSON.stringify({columns,rows})});
 if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(typeof body?.detail==='string'?body.detail:'Export failed. Please try again.')}
 const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='Customers-current-view.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
