import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {SharedMasterView} from './shared-master-view';
import {SharedMasterEditor} from './shared-master-editor';
import {ErrorNote} from './ui';
import {NumericInput,numericEntryError} from './numeric-input';
import {decimalDisplay} from './number-format';
import {timestamp} from './datetime';
export function densityCombinationLabel(value:unknown){
 try{
  const rows=typeof value==='string'?JSON.parse(value):value;
  return rows.map((row:any)=>row.NutsGrade.map((g:any)=>String(g[0])).join(' / ')+' · '+(decimalDisplay(Number(row.Ratio)*100,6)||'')+'%').join('; ');
 }catch{return 'Unavailable grade combination'}
}
export function GradeDensityMaster({canWrite}:{canWrite:boolean}){
 const [revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[editing,setEditing]=useState<{row:Row|null}|null>(null),[options,setOptions]=useState<Row[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;setError('');call<{rows:Row[]}>('/api/grade-densities/lookups').then(r=>{if(active)setOptions(r.rows)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[revision]);
 const row=editing?.row;
 return <section className="customers-page"><ErrorNote value={error}/>
 <SharedMasterView entity="grade-densities" title="Grade Density Master" newLabel="New grade density" recordLabel="View grade density" canWrite={canWrite&&!error} initialSort="Combination" filterKeys={['search']} revision={revision} notice={notice} onDismiss={()=>setNotice('')} columns={{Combination:'Nuts / grades / ratio',NutDensity:'Nut density (g/ml)',UpdatedAt:'Updated / Created',UpdatedByName:'User'}} onEdit={row=>setEditing({row})} display={(row,column)=>column==='Combination'?densityCombinationLabel(row[column]):column==='NutDensity'?decimalDisplay(row[column],6)||'':column==='UpdatedAt'?timestamp(row[column]):String(row[column]??'—')}/>
 {editing&&<SharedMasterEditor row={row??null} canWrite={canWrite} title="grade density" endpoint="/api/grade-densities" onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Grade density saved.');setRevision(n=>n+1)}}
 initial={()=>({Name:row?densityCombinationLabel(row.Combination):'',CombinationHash:String(row?.CombinationHash??''),NutDensity:String(row?.NutDensity??'')})}
 validate={v=>!v.CombinationHash?'Choose a grade combination.':!v.NutDensity?'Enter nut density.':numericEntryError('NutDensity',v.NutDensity)}
 payload={v=>({CombinationHash:v.CombinationHash,NutDensity:v.NutDensity})}
 fields={(v,change)=><>
  <label>Nuts / grades / ratio *{row?<input aria-label="Nuts / grades / ratio" readOnly value={densityCombinationLabel(row.Combination)}/>:<select aria-label="Nuts / grades / ratio" value={v.CombinationHash} onChange={e=>{change('CombinationHash',e.target.value);change('Name',densityCombinationLabel(options.find(o=>o.CombinationHash===e.target.value)?.Combination))}}><option value="">Choose grade combination</option>{options.map(o=><option key={String(o.CombinationHash)} value={String(o.CombinationHash)}>{densityCombinationLabel(o.Combination)}</option>)}</select>}</label>
  <label>Nut density (g/ml) *<NumericInput field="NutDensity" aria-label="Nut density (g/ml)" value={v.NutDensity} onValueChange={value=>change('NutDensity',value)}/></label>
  {!row&&!options.length&&<p>No complete grade combinations are available. Maintain active Product grades or capture grades in a Packaging Request first.</p>}
 </>}/>}
 </section>;
}
