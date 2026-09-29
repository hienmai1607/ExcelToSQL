import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {IconButton} from './icons';
import {ErrorNote} from './ui';
import {numberDisplay} from './number-format';
import type {GradeItem} from './product-grades';

type Pricing={as_of:string;rows:Row[]};
const columns:[string,string][]=[
 ['VendorName','Vendor'],['QuantityFrom','Quantity from (inclusive)'],['QuantityTo','Quantity to (exclusive)'],
 ['PriceUoM','Price UoM'],['UnitPrice','Unit price (Vendor currency)'],
 ['ExchangeRateToUSD','Exchange rate (Vendor currency per USD)'],['UnitUSDPrice','Unit USD price'],
 ['MaterialBaseUoM','Material Base UoM'],['ConversionFactor','Base units per Price UoM'],
 ['BaseUnitUSDPrice','Base unit USD price'],['EffectiveFrom','Effective from'],['EffectiveTo','Effective to'],
 ['PricingStatus','Pricing status']];
function display(row:Row,key:string){
 let value=numberDisplay(key,row[key]);
 if(['UnitPrice','UnitUSDPrice','BaseUnitUSDPrice'].includes(key)&&value==='0.00'&&Number(row[key])>0)value='<0.01';
 if(value===null)return key==='VendorName'&&row.PriceID?'No vendor':'—';
 if(key==='UnitPrice')return value+' '+String(row.CurrencyCode||'');
 if(key==='UnitUSDPrice'||key==='BaseUnitUSDPrice')return value+' USD';
 if(key==='ExchangeRateToUSD')return value+' '+String(row.CurrencyCode||'')+' / USD';
 return value;
}
export function RawPricing({items}:{items:GradeItem[]}){
 const [data,setData]=useState<Pricing|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[refresh,setRefresh]=useState(0);
 const ids=JSON.stringify([...new Set(items.map(i=>i.RawGradeID).filter((id):id is number=>!!id))].sort((a,b)=>a-b));
 useEffect(()=>{let active=true;setBusy(true);setData(null);setError('');
 call<Pricing>('/api/workbench/products/raw-pricing',{grade_ids:JSON.parse(ids)})
 .then(result=>{if(active)setData(result)}).catch(e=>{if(active)setError(e.message)})
 .finally(()=>{if(active)setBusy(false)});
 return()=>{active=false}},[ids,refresh]);
 return <section aria-label="Raw Pricing">
 <div className="grade-tree-toolbar"><p>Current Raw Material Pricing Master values{data?' as of '+data.as_of+' (UTC)':''}. Read only.</p>
 <IconButton icon="refresh" label="Refresh prices" disabled={busy} onClick={()=>setRefresh(n=>n+1)}/></div>
 <p>Only material-assigned grades are shown, with all current vendors and quantity tiers. Quantity ranges use Price UoM. Prices are not historical version snapshots or a calculated Product cost.</p>
 <ErrorNote value={error}/>
 {busy?<p role="status">Loading raw prices...</p>:!error&&(!data?.rows.length?<p>No material-assigned grades in this selection.</p>:
 <div className="raw-pricing-scroll" role="region" aria-label="Raw pricing table" tabIndex={0}><table>
 <thead><tr><th>Grade path</th><th>Grade</th><th>Raw Material</th>{columns.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead>
 <tbody>{items.flatMap(item=>{
 const matches=data?.rows.filter(r=>Number(r.RawGradeID)===item.RawGradeID)||[];
 const rows:Row[]=matches;
 return rows.map((row,index)=><tr key={item.ParentID+'/'+item.ID+'/'+index}>
 <td>{item.ParentID+'/'+item.ID}</td><td>{item.Grade||String(row.GradeName||'Unselected grade')}</td>
 <td>{[row.MaterialCode,row.MaterialName].filter(Boolean).join(' - ')||'—'}</td>
 {columns.map(([key])=><td key={key}>{display(row,key)}</td>)}</tr>);
 })}</tbody></table></div>)}
 </section>;
}
