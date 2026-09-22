import {useEffect,useState,type ReactNode} from 'react';
import {type Row} from './api';
import {useProfile} from './profile';
import {IconButton} from './icons';
import {ErrorNote} from './ui';
export type OpportunityRule={column:string;direction:'asc'|'desc'};
export type OpportunityView={columns:string[];sort:OpportunityRule[];filters?:string[]|null;values?:Record<string,string>};
export type OpportunityViews={header?:OpportunityView|null;items?:OpportunityView|null};
export const headerLabels:Record<string,string>={OpportunityNumber:'Opportunity',CustomerName:'Customer',OpportunityDesc:'Description',BidOpen:'Bid open',BidClose:'Bid close',HeaderStage:'Stage',ItemCount:'Items'};
export const itemLabels:Record<string,string>={ProductCode:'Product',ItemDescription:'Description',AnnualUnit:'Annual units',EstPctAwarded:'Estimated award %',ShelfPrice:'Shelf price',ItemStage:'Stage'};
export const opportunityFilters:Record<string,string>={opportunity_number:'Opportunity number',customer_name:'Customer',stage:'Stage',bid_open_from:'Bid open from',bid_open_to:'Bid open to'};
export const requestHeaderLabels:Record<string,string>={RequestNumber:'Request',OpportunityNumber:'Opportunity',CustomerName:'Customer',ResponseDue:'Response due',RequestStatus:'Status',ItemCount:'Items',Unassigned:'Unassigned',RequestedByName:'Requested by',RequestedAt:'Requested at'};
export const requestItemLabels:Record<string,string>={ProductCode:'Product',ItemDescription:'Description',AnnualUnit:'Annual units',PackagingRequirement:'Requirement',ItemStage:'Stage',PIC:'Current PIC'};
export const requestFilters:Record<string,string>={search:'Request, opportunity or customer',status:'Status'};
type Domain='opportunity'|'requests';
const labelsFor=(kind:'header'|'items',domain:Domain)=>domain==='requests'?(kind==='header'?requestHeaderLabels:requestItemLabels):(kind==='header'?headerLabels:itemLabels);
export const defaultFilters=['opportunity_number','customer_name','stage'];
export const activeFilters=(v:OpportunityView)=>Object.fromEntries((v.filters??defaultFilters).filter(k=>v.values?.[k]).map(k=>[k,v.values![k]]));
export const defaultView=(kind:'header'|'items',domain:Domain='opportunity'):OpportunityView=>({filters:kind==='header'?(domain==='requests'?['search','status']:defaultFilters):[],values:{},columns:Object.keys(labelsFor(kind,domain)),sort:kind==='header'?[{column:domain==='requests'?'RequestedAt':'BidOpen',direction:'desc'}]:[]});
export function useOpportunityView(kind:'header'|'items',domain:Domain='opportunity'){
 const {profile,ready,saving,save}=useProfile();
 const [view,setView]=useState(()=>defaultView(kind,domain)),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [savedFilters,setSavedFilters]=useState('{}');
 const saved=JSON.stringify(profile.settings[domain]?.[kind]||null);
 useEffect(()=>{if(ready){const restored=profile.settings[domain]?.[kind]||defaultView(kind,domain);setView(restored);setSavedFilters(JSON.stringify(activeFilters(restored)))}},[ready,saved,kind,domain]);
 async function persist(){setError('');setMessage('');try{await save({...profile.settings,[domain]:{...profile.settings[domain],[kind]:view}});setMessage('Layout and sort saved.')}catch(e){setError((e as Error).message)}}
 function quickSort(column:string,append:boolean){setView(v=>{const rule:OpportunityRule={column,direction:v.sort.find(r=>r.column===column)?.direction==='asc'?'desc':'asc'};return {...v,sort:append?(v.sort.some(r=>r.column===column)?v.sort.map(r=>r.column===column?rule:r):[...v.sort,rule]):[rule]}})}
 return {kind,domain,view,setView,quickSort,persist,canSave:ready&&!saving,message,error,savedFilters};
}
export function OpportunityViewTools({control,children}:{control:ReturnType<typeof useOpportunityView>;children?:ReactNode}){
 const {kind,domain,view,setView}=control,labels=labelsFor(kind,domain);
 const filtersFor=domain==='requests'?requestFilters:opportunityFilters,filterDefaults=domain==='requests'?['search','status']:defaultFilters;
 const [panel,setPanel]=useState<'layout'|'sort'|null>(null),title=domain==='requests'?(kind==='header'?'Request':'Request item'):(kind==='header'?'Opportunity':'Item');
 function move(index:number,offset:number){const columns=[...view.columns];[columns[index],columns[index+offset]]=[columns[index+offset],columns[index]];setView({...view,columns})}
 return <div className="opportunity-view-tools"><div className="view-toolbar">{children}
  <IconButton icon="layout" label={title+' layout'} aria-pressed={panel==='layout'} onClick={()=>setPanel(panel==='layout'?null:'layout')}/>
  <IconButton icon="sort" label={title+' sort'} aria-pressed={panel==='sort'} onClick={()=>setPanel(panel==='sort'?null:'sort')}/>
 </div>
 {panel&&<aside className="layout-panel" aria-label={title+' '+panel}><h2>{title} {panel}</h2>
 {panel==='layout'?<div className="layout-options"><fieldset><legend>Visible columns</legend>{Object.entries(labels).map(([c,label])=><label key={c}><input type="checkbox" checked={view.columns.includes(c)} disabled={view.columns.length===1&&view.columns.includes(c)} onChange={()=>setView({...view,columns:view.columns.includes(c)?view.columns.filter(x=>x!==c):[...view.columns,c]})}/>{label}</label>)}</fieldset><fieldset><legend>Column order</legend><ol className="column-order">{view.columns.map((c,i)=><li key={c}><span>{labels[c]}</span><IconButton icon="up" label={'Move '+labels[c]+' left'} disabled={i===0} onClick={()=>move(i,-1)}/><IconButton icon="down" label={'Move '+labels[c]+' right'} disabled={i===view.columns.length-1} onClick={()=>move(i,1)}/></li>)}</ol></fieldset>{kind==='header'&&<fieldset><legend>Visible filters</legend>{Object.entries(filtersFor).map(([f,label])=><label key={f}><input type="checkbox" checked={(view.filters??filterDefaults).includes(f)} onChange={()=>{const filters=view.filters??filterDefaults;const next=filters.includes(f)?filters.filter(k=>k!==f):[...filters,f];setView({...view,filters:next,values:Object.fromEntries(Object.entries(view.values||{}).filter(([k])=>next.includes(k)))})}}/>{label}</label>)}</fieldset>}</div>:<>
 <p>Top rule first. {domain==='requests'?'Applies to all matching records before pagination.':kind==='header'?'Applies to all matching Opportunities before pagination.':'Applies to all items in this Opportunity. Blank values stay last.'}</p>
 {view.sort.map((r,i)=><div className="sort-rule" key={r.column}><span>{i+1}</span><label>Column<select aria-label={'Sort column '+(i+1)} value={r.column} onChange={e=>setView({...view,sort:view.sort.map((s,n)=>n===i?{...s,column:e.target.value}:s)})}>{Object.entries(labels).filter(([c])=>c===r.column||!view.sort.some(s=>s.column===c)).map(([c,l])=><option key={c} value={c}>{l}</option>)}</select></label><label>Direction<select aria-label={'Sort direction '+(i+1)} value={r.direction} onChange={e=>setView({...view,sort:view.sort.map((s,n)=>n===i?{...s,direction:e.target.value as 'asc'|'desc'}:s)})}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label><IconButton icon="up" label={'Raise sort priority '+(i+1)} disabled={i===0} onClick={()=>{const sort=[...view.sort];[sort[i],sort[i-1]]=[sort[i-1],sort[i]];setView({...view,sort})}}/><IconButton icon="close" label={'Remove sort '+(i+1)} onClick={()=>setView({...view,sort:view.sort.filter((_,n)=>n!==i)})}/></div>)}
 <button disabled={view.sort.length===Object.keys(labels).length} onClick={()=>setView({...view,sort:[...view.sort,{column:Object.keys(labels).find(c=>!view.sort.some(r=>r.column===c))!,direction:'asc'}]})}>Add sort column</button>
 </>}
 <ErrorNote value={control.error}/>{control.message&&<p role="status">{control.message}</p>}
 <div className="actions"><button onClick={()=>setView(defaultView(kind,domain))}>Reset view</button><button disabled={!control.canSave} onClick={control.persist}>Save layout to profile</button><button onClick={()=>setPanel(null)}>Close {panel}</button></div></aside>}
 </div>
}
export function ViewHeading({column,control}:{column:string;control:ReturnType<typeof useOpportunityView>}){
 const index=control.view.sort.findIndex(s=>s.column===column),labels=labelsFor(control.kind,control.domain);
 return <th aria-sort={index===0?(control.view.sort[0].direction==='asc'?'ascending':'descending'):'none'}><button className="sort-heading" aria-label={'Sort by '+labels[column]} onClick={e=>control.quickSort(column,e.shiftKey)}>{labels[column]}{index>=0&&<span>{control.view.sort[index].direction==='asc'?'↑':'↓'}{index+1}</span>}</button></th>
}
export function sortItems(rows:Row[],rules:OpportunityRule[]){
 const numeric=new Set(['AnnualUnit','EstPctAwarded','ShelfPrice']);
 return [...rows].sort((a,b)=>{for(const r of rules){const x=a[r.column],y=b[r.column];if(x==null&&y==null)continue;if(x==null)return 1;if(y==null)return -1;const delta=numeric.has(r.column)?Number(x)-Number(y):String(x).localeCompare(String(y));if(delta)return r.direction==='asc'?delta:-delta}return Number(a.ItemID)-Number(b.ItemID)});
}
