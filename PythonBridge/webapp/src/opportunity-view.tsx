import {tcbColumnLabels} from './tcb-columns';
import {ColumnResizer} from './column-widths';
import {useEffect,useState,type ReactNode} from 'react';
import {type Row} from './api';
import {itemFieldGroups,itemFieldLabels,requestFields,responseFields,linkedRequestFields,shipmentFieldGroups,calculatedFields,efficiencyFields} from './item-view-fields';
import {useProfile} from './profile';
import {IconButton} from './icons';
import {ErrorNote,PageSizeSetting,LayoutPanel,ColumnOrder,Notification,InfoTip} from './ui';
export type OpportunityRule={column:string;direction:'asc'|'desc'};
export type OpportunityView={page_size?:number;column_widths?:Record<string,number>;columns:string[];sort:OpportunityRule[];filters?:string[]|null;values?:Record<string,string>;prefix_columns?:string[]|null;field_version?:number};
export type ItemTab='all'|'item'|'packaging'|'responses'|'tcb';
export const itemTabs:Record<ItemTab,string>={all:'All Fields',item:'Product Info',packaging:'Packaging Request',responses:'Packaging Responses',tcb:'TCB Review'};
export const itemPrefix=(view:OpportunityView)=>(view.prefix_columns??['ProductCode']).filter(c=>view.columns.includes(c));
export function itemTabColumns(view:OpportunityView,tab:ItemTab){const prefix=itemPrefix(view),responses={...linkedRequestFields,...responseFields};return [...prefix,...view.columns.filter(c=>!prefix.includes(c)&&(tab==='all'||(tab==='tcb'?c in tcbColumnLabels:tab==='packaging'?c in requestFields:tab==='responses'?c in responses:!(c in tcbColumnLabels)&&!(c in requestFields)&&!(c in responses))))]}
export type OpportunityViews={header?:OpportunityView|null;items?:OpportunityView|null;editor_page_size?:number};
export const headerLabels:Record<string,string>={OpportunityNumber:'Opportunity',CustomerName:'Customer',OpportunityDesc:'Description',BidOpen:'Bid open',BidClose:'Bid close',HeaderStage:'Stage',ItemCount:'Items',CustomerCurrencyCode:'Customer currency',ExchangeRateVNDPerUSD:'Exchange rate VND per USD',ExchangeRateCustomerCurrencyPerUSD:'Exchange rate Customer Currency per USD'};
export const itemLabels=itemFieldLabels('opportunity');
export const opportunityFilters:Record<string,string>={opportunity_number:'Opportunity number',customer_name:'Customer',stage:'Stage',bid_open_from:'Bid open from',bid_open_to:'Bid open to'};
export const requestHeaderLabels:Record<string,string>={RequestNumber:'Request',OpportunityNumber:'Opportunity',CustomerName:'Customer',ResponseDue:'Response due',RequestStatus:'Status',ItemCount:'Items',Unassigned:'Unassigned',RequestedByName:'Requested by',RequestedAt:'Requested at'};
export const requestItemLabels=itemFieldLabels('requests');
export const requestFilters:Record<string,string>={search:'Request, opportunity or customer',status:'Status'};
export const opportunityRequired={header:['OpportunityNumber','CustomerName','OpportunityDesc','BidOpen','BidClose','CustomerCurrencyCode','ExchangeRateVNDPerUSD','ExchangeRateCustomerCurrencyPerUSD','ItemCount'],items:['ProductCode','WeightGrams','AnnualUnit']};
export const requestRequired={header:['RequestNumber','OpportunityNumber','CustomerName','ItemCount'],items:['ProductCode','WeightGrams','PIC']};
type Domain='opportunity'|'requests';
const labelsFor=(kind:'header'|'items',domain:Domain)=>domain==='requests'?(kind==='header'?requestHeaderLabels:requestItemLabels):(kind==='header'?headerLabels:itemLabels);
export const defaultFilters=['opportunity_number','customer_name','stage'];
export const activeFilters=(v:OpportunityView)=>Object.fromEntries((v.filters??defaultFilters).filter(k=>v.values?.[k]).map(k=>[k,v.values![k]]));
export const defaultView=(kind:'header'|'items',domain:Domain='opportunity'):OpportunityView=>({page_size:25,field_version:domain==='opportunity'?13:8,filters:kind==='header'?(domain==='requests'?['search','status']:defaultFilters):[],values:{},columns:Object.keys(labelsFor(kind,domain)),sort:kind==='header'?[{column:domain==='requests'?'RequestedAt':'BidOpen',direction:'desc'}]:[]});
export function restoreView(stored:OpportunityView,kind:'header'|'items',domain:Domain):OpportunityView{
 const labels=labelsFor(kind,domain),required=domain==='opportunity'?opportunityRequired[kind]:requestRequired[kind];
 const renamed:Record<string,string>=kind==='header'&&domain==='opportunity'?{CurrencyCode:'CustomerCurrencyCode',ExchangeRateToVND:'ExchangeRateVNDPerUSD'}:{};
 const oldColumns=stored.columns.map(c=>renamed[c]||c).filter(c=>c in labels);
 const added=kind==='items'?[...(domain==='opportunity'&&(stored.field_version??1)<13?['ImportClearanceCustomerPerContainer']:[]),...(domain==='opportunity'&&(stored.field_version??1)<12?['FloorLoadUSDPerMT','ImportClearanceCustomerPerContainer','ImportClearanceCustomerPerPallet','InterestDays','PaymentTermDays','MarginMode','MarginUSDPerLb']:[]),...((stored.field_version??1)<(domain==='opportunity'?11:8)?['ApplicableNetWeightGrams']:[]),...((stored.field_version??1)<7?efficiencyFields:[]),...(domain==='opportunity'&&(stored.field_version??1)<8?Object.keys(linkedRequestFields):[]),...(domain==='opportunity'&&(stored.field_version??1)<9?shipmentFieldGroups.flatMap(g=>Object.keys(g.fields)):[]),...(domain==='opportunity'&&(stored.field_version??1)<10?Object.keys(tcbColumnLabels):[])]:[];
 const columns=kind==='items'&&(stored.field_version??1)<6?Object.keys(labels):[...new Set([...oldColumns,...required,...added])];
 const ordered=kind==='items'?itemFieldGroups(domain).flatMap(g=>{const group=columns.filter(c=>c in g.fields);return added.includes('PackagingRequestNumber')&&'PackagingRequestNumber' in g.fields?['PackagingRequestNumber',...group.filter(c=>c!=='PackagingRequestNumber')]:group}):columns;
 return {...stored,field_version:domain==='opportunity'?13:8,columns:ordered,
  sort:stored.sort.map(r=>({...r,column:renamed[r.column]||r.column})).filter(r=>r.column in labels&&(kind==='header'||!calculatedFields.has(r.column))),
  prefix_columns:kind==='items'?stored.prefix_columns?.filter(c=>c in itemFieldGroups(domain)[0].fields):undefined,
  column_widths:Object.fromEntries(Object.entries(stored.column_widths||{}).filter(([k])=>k in labels||k.startsWith('_'))),
 };
}
export function useOpportunityView(kind:'header'|'items',domain:Domain='opportunity'){
 const {profile,ready,saving,save}=useProfile();
 const [view,setView]=useState(()=>defaultView(kind,domain)),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [savedFilters,setSavedFilters]=useState('{}');
 const saved=JSON.stringify(profile.settings[domain]?.[kind]||null);
 useEffect(()=>{if(ready){const restored=restoreView(profile.settings[domain]?.[kind]||defaultView(kind,domain),kind,domain);setView(restored);setSavedFilters(JSON.stringify(activeFilters(restored)))}},[ready,saved,kind,domain]);
 async function persist(){setError('');setMessage('');try{await save({...profile.settings,[domain]:{...profile.settings[domain],[kind]:view}});setMessage('Layout and sort saved.')}catch(e){setError((e as Error).message)}}
 function quickSort(column:string,append:boolean){setView(v=>{const rule:OpportunityRule={column,direction:v.sort.find(r=>r.column===column)?.direction==='asc'?'desc':'asc'};return {...v,sort:append?(v.sort.some(r=>r.column===column)?v.sort.map(r=>r.column===column?rule:r):[...v.sort,rule]):[rule]}})}
 return {kind,domain,view,setView,quickSort,persist,canSave:ready&&!saving,message,dismissMessage:()=>setMessage(''),error,savedFilters};
}
export function OpportunityViewTools({control,children,trailing}:{trailing?:ReactNode;control:ReturnType<typeof useOpportunityView>;children?:ReactNode}){
 const {kind,domain,view,setView}=control,labels=labelsFor(kind,domain);
 const groups=kind==='items'?itemFieldGroups(domain):[{title:'Header Info',fields:labels}];
 const sortable=Object.fromEntries(Object.entries(labels).filter(([c])=>kind==='header'||!calculatedFields.has(c)));
 const arrange=(columns:string[])=>groups.flatMap(g=>columns.filter(c=>c in g.fields));
 function groupOrder(fields:Record<string,string>,columns:string[]){setView({...view,columns:groups.flatMap(g=>g.fields===fields?columns:view.columns.filter(c=>c in g.fields))})}
 const filtersFor=domain==='requests'?requestFilters:opportunityFilters,filterDefaults=domain==='requests'?['search','status']:defaultFilters;
 const [panel,setPanel]=useState<'layout'|'sort'|null>(null),title=domain==='requests'?(kind==='header'?'Request':'Request item'):(kind==='header'?'Opportunity':'Item');
 return <div className="opportunity-view-tools"><div className="view-toolbar">{children}
  <IconButton icon="layout" label={title+' layout'} aria-pressed={panel==='layout'} onClick={()=>setPanel(panel==='layout'?null:'layout')}/>
  <IconButton icon="sort" label={title+' sort'} aria-pressed={panel==='sort'} onClick={()=>setPanel(panel==='sort'?null:'sort')}/>
 {trailing}</div>
 {panel&&<LayoutPanel className="layout-panel" aria-label={title+' '+panel}><h2>{title} {panel}</h2>{panel==='layout'&&<PageSizeSetting value={view.page_size??25} onChange={page_size=>setView({...view,page_size})}/>}
 {panel==='layout'?<div className="layout-options"><fieldset><legend>Visible columns</legend>{groups.map(g=><section className="layout-field-group" key={g.title+(g.subgroup??'')} aria-label={'Visible '+g.title+(g.subgroup?' / '+g.subgroup:'')}>{kind==='items'&&<h3>{g.title}{g.subgroup&&<small>{g.subgroup}</small>}</h3>}{Object.entries(g.fields).map(([c,label])=><label key={c}><input type="checkbox" checked={view.columns.includes(c)} disabled={(domain==='opportunity'?opportunityRequired[kind]:requestRequired[kind]).includes(c)||(view.columns.length===1&&view.columns.includes(c))} onChange={()=>setView({...view,columns:arrange(view.columns.includes(c)?view.columns.filter(x=>x!==c):[...view.columns,c])})}/>{label}</label>)}</section>)}</fieldset>
 <fieldset><legend>Column order{kind==='items'&&<InfoTip text="Drag fields within their section. Fields cannot move to a different section."/>}</legend>{groups.map(g=><section className="layout-field-group" key={g.title+(g.subgroup??'')} aria-label={'Order '+g.title+(g.subgroup?' / '+g.subgroup:'')}>{kind==='items'&&<h3>{g.title}{g.subgroup&&<small>{g.subgroup}</small>}</h3>}<ColumnOrder columns={view.columns.filter(c=>c in g.fields)} labels={g.fields} onChange={columns=>groupOrder(g.fields,columns)}/></section>)}</fieldset>
 {kind==='items'&&<fieldset><legend>Prefix columns<InfoTip text="Visible Product Info prefix columns appear first on every tab, in selection order."/></legend>{Object.entries(groups[0].fields).map(([c,label])=><label key={c}><input type="checkbox" aria-label={'Prefix '+label} checked={(view.prefix_columns??['ProductCode']).includes(c)} onChange={()=>{const prefix=view.prefix_columns??['ProductCode'];setView({...view,prefix_columns:prefix.includes(c)?prefix.filter(x=>x!==c):[...prefix,c]})}}/>{label}</label>)}</fieldset>}
 {kind==='header'&&<fieldset><legend>Visible filters</legend>{Object.entries(filtersFor).map(([f,label])=><label key={f}><input type="checkbox" checked={(view.filters??filterDefaults).includes(f)} onChange={()=>{const filters=view.filters??filterDefaults;const next=filters.includes(f)?filters.filter(k=>k!==f):[...filters,f];setView({...view,filters:next,values:Object.fromEntries(Object.entries(view.values||{}).filter(([k])=>next.includes(k)))})}}/>{label}</label>)}</fieldset>}</div>:<>
 <p>Top rule first. {domain==='requests'?'Applies to all matching records before pagination.':kind==='header'?'Applies to all matching Opportunities before pagination.':'Applies to all items in this Opportunity. Blank values stay last.'}</p>
 {view.sort.map((r,i)=><div className="sort-rule" key={r.column}><span>{i+1}</span><label>Column<select aria-label={'Sort column '+(i+1)} value={r.column} onChange={e=>setView({...view,sort:view.sort.map((s,n)=>n===i?{...s,column:e.target.value}:s)})}>{Object.entries(sortable).filter(([c])=>c===r.column||!view.sort.some(s=>s.column===c)).map(([c,l])=><option key={c} value={c}>{l}</option>)}</select></label><label>Direction<select aria-label={'Sort direction '+(i+1)} value={r.direction} onChange={e=>setView({...view,sort:view.sort.map((s,n)=>n===i?{...s,direction:e.target.value as 'asc'|'desc'}:s)})}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label><IconButton icon="up" label={'Raise sort priority '+(i+1)} disabled={i===0} onClick={()=>{const sort=[...view.sort];[sort[i],sort[i-1]]=[sort[i-1],sort[i]];setView({...view,sort})}}/><IconButton icon="close" label={'Remove sort '+(i+1)} onClick={()=>setView({...view,sort:view.sort.filter((_,n)=>n!==i)})}/></div>)}
 <button disabled={view.sort.length===Object.keys(sortable).length} onClick={()=>setView({...view,sort:[...view.sort,{column:Object.keys(sortable).find(c=>!view.sort.some(r=>r.column===c))!,direction:'asc'}]})}>Add sort column</button>
 </>}
 <ErrorNote value={control.error}/><Notification value={control.message} onDismiss={control.dismissMessage}/>
 <div className="actions"><button onClick={()=>setView(defaultView(kind,domain))}>Reset view</button><button disabled={!control.canSave} onClick={control.persist}>Save layout to profile</button><button onClick={()=>setPanel(null)}>Close {panel}</button></div></LayoutPanel>}
 </div>
}
export function ViewHeading({column,control,children,className}:{column:string;control:ReturnType<typeof useOpportunityView>;children?:ReactNode;className?:string}){
 const index=control.view.sort.findIndex(s=>s.column===column),labels=labelsFor(control.kind,control.domain);
 return <th className={className} aria-sort={index===0?(control.view.sort[0].direction==='asc'?'ascending':'descending'):'none'}><button disabled={control.kind==='items'&&calculatedFields.has(column)} className="sort-heading" aria-label={'Sort by '+labels[column]} onClick={e=>control.quickSort(column,e.shiftKey)}>{labels[column]}{index>=0&&<span>{control.view.sort[index].direction==='asc'?'↑':'↓'}{index+1}</span>}</button><ColumnResizer column={column} label={labels[column]}/>{children}</th>
}
export function sortItems(rows:Row[],rules:OpportunityRule[]){
 const numeric=new Set([...shipmentFieldGroups.slice(1).flatMap(g=>Object.keys(g.fields)),'NutDensity','UsedVolumeML','PrimaryPricePerUnit','SecondaryPricePerUnit','TertiaryPricePerUnit','RequestedLayerCount','ResponseLayerCount','ThirdPMMOQ','NumberOfPrimary','NumberOfSecondary','LayersPerContainer','PalletsPerContainer','CartonsPerContainerFloor','WeightGrams','AnnualUnit','EstPctAwarded','ShelfPrice','MixRatioPct','MaxPalletHeightMM','ShelfLifeDays','UnitsPerCarton','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','UnitsPerPallet','ResponseMaxPalletHeightMM','HeightMM','CartonsPerContainer','PMCost']);
 return [...rows].sort((a,b)=>{for(const r of rules){const x=a[r.column],y=b[r.column];if(x==null&&y==null)continue;if(x==null)return 1;if(y==null)return -1;const delta=numeric.has(r.column)?Number(x)-Number(y):String(x).localeCompare(String(y));if(delta)return r.direction==='asc'?delta:-delta}return Number(a.ItemID)-Number(b.ItemID)});
}
