import {Fragment,useEffect,useState} from 'react';
import {call,type Row} from './api';
import {Modal,ErrorNote,InfoTip,FieldLabel} from './ui';
import {IconButton} from './icons';
import {objectValue,quantity,quantityDisplay} from './packaging-summary-model';
import {defaultInputs,costs,money,packagingUSD,palletizationValue,productFields,type TCBInputs,type TCBGrade} from './tcb-model';
import {migrateLossProcesses,processOptions,lossError,lossTotals,lossDisplay,lossFields,type LossStep} from './loss-processes';
import './tcb-calculator.css';
import {decimalDisplay} from './number-format';

type Data={lossMasters?:LossStep[];item:Row;saved:Record<string,unknown>;grades:TCBGrade[];prices:Row[];gradeError:string};
export function TCBCalculator({row,opportunity,onClose,onSaved,lossOnly=false}:{lossOnly?:boolean;row:Row;opportunity:Row;onClose:()=>void;onSaved:(version:string)=>void}){
 const [data,setData]=useState<Data|null>(null),[inputs,setInputs]=useState<TCBInputs>(defaultInputs);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [baseline,setBaseline]=useState(''),[changed,setChanged]=useState(false),[lossTab,setLossTab]=useState('product'),[formulaResult,setFormulaResult]=useState('');
 const id=Number(row.ItemID),path='/api/opportunity/items/'+id+'/tcb';
 useEffect(()=>{let active=true;call<Data>(path).then(next=>{if(active){setData(next);const value={...defaultInputs(),...objectValue(next.saved.Inputs)} as TCBInputs;value.LossProcesses=migrateLossProcesses(value);
 if(lossOnly){const mix=!!next.item.IsMixParent,layerCount=Number(next.item.LossLayerCount??row.ResponseLayerCount??row.RequestedLayerCount??row.PackagingLayerCount??1),totals=lossTotals(value.LossProcesses as LossStep[]);value.LossProcesses=[...(value.LossProcesses as LossStep[]).filter(p=>p.ProcessType==='Sorting'||p.ProcessType==='Processing').map((p,i)=>({...p,ProcessType:'Processing' as const,Sequence:i+1})),...processOptions(mix,layerCount).filter(([type])=>type!=='Sorting'&&type!=='Processing').map(([type])=>({ProcessType:type,Sequence:1,LossPct:quantityDisplay(totals[(type.replace('Packaging','LossPct')) as keyof typeof totals],2).replaceAll(',','')}))];if(mix)setLossTab('packaging');}setInputs(value);setBaseline(JSON.stringify(value))}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[id]);
 const mix=!!data?.item.IsMixParent,readonly=!!data&&(data.item.ItemStage!=='Draft'||data.item.HeaderStage!=='Draft');
 const savedPrices=Array.isArray(data?.saved.PriceSnapshots)?data.saved.PriceSnapshots as Row[]:[];
 const prices=[...(data?.prices||[]),...savedPrices.filter(p=>!data?.prices.some(current=>current.PriceID===p.PriceID&&current.PriceVersion===p.PriceVersion&&current.USDPerLb===p.USDPerLb))];
 const calc=costs(inputs,data?.grades||[],prices);
 const layers=Number(data?.item.LossLayerCount??row.ResponseLayerCount??row.RequestedLayerCount??row.PackagingLayerCount??1);
 const steps=(inputs.LossProcesses??[]) as LossStep[],options=processOptions(mix,layers);
 const processError=lossError(steps,options),losses=lossTotals(steps);
 if(inputs.ProductLossFormula&&!lossOnly)losses.LossProductPct=quantity(inputs.LossProductPct,true);
 const masterChoices=data?.lossMasters??[];
 const packagingOptions=options.filter(([type])=>type!=='Sorting');
 const title=lossOnly?'Item loss processes':'TCB Calculator';
 const masterKey=(step:LossStep)=>step.MasterID?step.MasterID+':'+step.MasterVersion:'';
 const dirty=!!data&&JSON.stringify(inputs)!==baseline;
 function close(){if(!saving&&(!dirty||window.confirm('Discard unsaved TCB changes?')))onClose()}
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||saving){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(saving||(dirty&&!window.confirm('Discard unsaved TCB changes?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,saving]);
 function change(key:string,value:unknown){setInputs(i=>({...i,[key]:value}));setChanged(true);setMessage('');setFormulaResult('')}
 function input(key:string,label:string,disabled=readonly){return <label key={key}><FieldLabel>{label}</FieldLabel><input aria-label={label} type="number" min="0" max={key.endsWith('Pct')||key.endsWith('Ratio')?100:undefined} step={key.endsWith('Pct')||key.endsWith('Ratio')?'0.01':'0.000001'} value={String(inputs[key]??'')} disabled={disabled||saving} onChange={e=>change(key,e.target.value===''?null:e.target.value)}/></label>}
 async function save(){
  if(!data||saving)return;setSaving(true);setError('');setMessage('');
  try{const result=await call<{saved:Record<string,unknown>;RowVersion:string}>(lossOnly?path.replace(/\/tcb$/,'/loss-processes'):path,{RowVersion:data.item.RowVersion,Inputs:lossOnly?{ProductLossFormula:inputs.ProductLossFormula||null,LossProcesses:steps.map(step=>({...step,Sequence:Number(step.Sequence)}))}:{...Object.fromEntries(Object.entries(inputs).filter(([key])=>!lossFields.some(field=>field===key))),LossProcesses:steps.map(step=>({...step,Sequence:Number(step.Sequence)}))}});setData({...data,saved:result.saved,item:{...data.item,...('PalletUSDPerEA' in objectValue(result.saved.Inputs)?{DefaultPalletUSDPerEA:objectValue(result.saved.Inputs).PalletUSDPerEA==null?null:String(objectValue(result.saved.Inputs).PalletUSDPerEA)}:{}),RowVersion:result.RowVersion}});setBaseline(JSON.stringify(inputs));setChanged(false);setMessage('TCB costs saved.');onSaved(result.RowVersion)}
  catch(e){setError((e as Error).message)}finally{setSaving(false)}
 }
 const savedRM=quantity(data?.saved.RMCostUSDPerLb,true),savedProduct=quantity(data?.saved.ProductUSDPerLb,true);
 const staleGrades=!!data?.saved.GradeSnapshot&&JSON.stringify(objectValue(data.saved.GradeSnapshot))!==JSON.stringify(objectValue(data.item.ProductGradeSnapshot));
 function packaging(item:Row,isMix:boolean){
  return <div className="tcb-grid">{['Primary','Secondary','Tertiary'].slice(0,layers).map((layer,index)=><Fragment key={layer}><label><FieldLabel>{(isMix?'Mix ':'')+layer+' PM ($/EA)'}</FieldLabel><output>{money(packagingUSD(item,index,opportunity))}</output></label><label><FieldLabel>Loss ({isMix?'Mix ':''}{['1st','2nd','3rd'][index]} PM) %</FieldLabel><output>{lossDisplay(losses[((isMix?'Mix':'')+layer+'LossPct') as keyof typeof losses])}</output></label></Fragment>)}{!data?.item.ParentItemID&&!row.ParentItemID&&<label><FieldLabel help="Copied from Packaging response: pallet plus accessories, in USD per pallet (EA).">Palletization ($/EA)</FieldLabel><input aria-label="Palletization ($/EA)" readOnly value={decimalDisplay(palletizationValue({...row,...data?.item},inputs),6)??''}/></label>}</div>
 }
 return <Modal label={title} className="dialog tcb-dialog" onClose={close}>
  <header className="customer-editor-heading"><div><h2>{title}</h2><p>{String(row.ProductCode)} · {String(row.ProductName)}</p></div><IconButton icon="close" label={'Close '+title} disabled={saving} onClick={close}/></header>
  <ErrorNote value={error}/>
  {loading?<p role="status">Loading TCB inputs and current material prices…</p>:data&&<>
   {!lossOnly&&!mix&&<section aria-label="Product"><h3>Product</h3>
    <ErrorNote value={data.gradeError}/>{staleGrades&&<p role="alert">Grades changed since this calculation was saved. Recheck all price selections.</p>}
    <div className="table-scroll"><table className="tcb-grades"><thead><tr><th>Grades (summary)</th><th>Final proportion</th><th>Material / vendor / quantity tier</th><th>USD/lb</th></tr></thead><tbody>{data.grades.map(leaf=>{
     const selection=inputs.Prices.find(p=>p.Path===leaf.Path),selected=prices.find(p=>p.PriceID===selection?.PriceID&&p.PriceVersion===selection?.PriceVersion&&(selection?.ExpectedUSDPerLb===undefined||String(p.USDPerLb)===selection.ExpectedUSDPerLb));
     const candidates=data.prices.filter(p=>p.RawGradeID===leaf.RawGradeID&&(!leaf.RawMaterialID||p.MaterialID===leaf.RawMaterialID));
     const quote=(p:Row)=>p.PriceID+':'+p.PriceVersion+':'+p.USDPerLb;
     const value=selection?selection.PriceID+':'+selection.PriceVersion+':'+(selection.ExpectedUSDPerLb??selected?.USDPerLb):'';
     return <tr key={leaf.Path}><td>{leaf.Path} · {leaf.Grade}</td><td>{quantityDisplay(quantity(leaf.Proportion)?{n:quantity(leaf.Proportion)!.n*100n,d:quantity(leaf.Proportion)!.d}:null,4)}%</td><td><select aria-label={'Price for grade '+leaf.Path} disabled={readonly||saving} value={value} onChange={e=>{const p=candidates.find(p=>quote(p)===e.target.value);change('Prices',[...inputs.Prices.filter(p=>p.Path!==leaf.Path),...(p?[{Path:leaf.Path,PriceID:Number(p.PriceID),PriceVersion:String(p.PriceVersion),ExpectedUSDPerLb:String(p.USDPerLb)}]:[])])}}>
      <option value="">Choose material price</option>{selection&&!candidates.some(p=>quote(p)===value)&&<option value={value}>Saved price snapshot — reselect a current price before saving</option>}
      {candidates.map(p=><option key={String(p.PriceID)} value={quote(p)} disabled={p.USDPerLb===null}>{p.MaterialCode} · {p.VendorName||'No vendor'} · {p.QuantityFrom}–{p.QuantityTo??'∞'} {p.PriceBasis} · {money(quantity(p.USDPerLb,true))}{p.USDPerLb===null?' (conversion missing)':''}</option>)}</select></td><td>{money(quantity(selected?.USDPerLb,true))}</td></tr>
    })}</tbody></table></div>
    <div className="tcb-grid"><label><FieldLabel help="Sum of final grade proportion × selected material price in USD/lb. Nested grade ratios are multiplied down their paths.">RM Cost ($/lbs)</FieldLabel><output>{money(!changed&&!staleGrades&&savedRM?savedRM:calc.rm)}</output></label>
     {productFields.map(([key,label])=>input(key,label))}
     <label><FieldLabel help="Combined loss = 100 × (1 − product of each Sorting/Processing step's remaining yield). Example: 5% then 10% gives 14.50%.">Loss product (%)</FieldLabel><output>{lossDisplay(losses.LossProductPct)}</output></label>
     <label><FieldLabel help="RM cost × RM Ratio + Seasoning/salt cost × Seasoning/salt Ratio + Oil cost × Oil % + Processing. Ratios are divided by 100; losses are separate inputs.">Product ($/lbs)</FieldLabel><output>{money(!changed&&!staleGrades&&savedProduct?savedProduct:calc.product)}</output></label>
    </div>{!calc.balanced&&<p role="alert">RM + Seasoning/salt + Oil ratios must total 100%.</p>}
   </section>}
   {!lossOnly&&<section aria-label="Packaging"><h3>Packaging</h3>
    {mix?<><h4>Mix packaging</h4>{packaging(row,true)}</>:<>{packaging(row,false)}</>}
   </section>}
   {lossOnly&&<section aria-label="Item losses">
    <div role="tablist" aria-label="Item loss tabs"><button role="tab" aria-selected={lossTab==='product'} onClick={()=>setLossTab('product')}>Product Loss</button><button role="tab" aria-selected={lossTab==='packaging'} onClick={()=>setLossTab('packaging')}>Packaging Loss</button></div>
    <ErrorNote value={processError}/>
    {lossTab==='product'?<div role="tabpanel" aria-label="Product Loss">
     {mix?<p>Product loss belongs to each child product, not the Mix parent.</p>:<>
      <div className="table-scroll"><table className="item-loss-table"><thead><tr><th>Loss type</th><th>Loss code</th><th>Loss ratio (%)</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{steps.filter(p=>p.ProcessType==='Sorting'||p.ProcessType==='Processing').map((step,index)=><tr key={index}>
       <td><select aria-label={'Loss type '+(index+1)} disabled={readonly||saving} value={masterKey(step)} onChange={e=>{const master=masterChoices.find(m=>masterKey(m)===e.target.value);if(master)change('LossProcesses',steps.map(s=>s===step?{...master,ProcessType:'Processing',Sequence:index+1,LossPct:step.LossPct}:s))}}>
        {!masterChoices.some(m=>masterKey(m)===masterKey(step))&&<option value={masterKey(step)}>{step.ProcessName||step.ProcessType} (saved snapshot)</option>}
        {masterChoices.map(master=><option key={masterKey(master)} value={masterKey(master)}>{master.ProcessName||master.ProcessType}</option>)}</select></td>
       <td><output aria-label={'Loss code '+(index+1)}>{'L'+(index+1)}</output></td>
       <td><input aria-label={'Product loss ratio '+(index+1)} type="number" min="0" max="100" step="0.01" value={step.LossPct} disabled={readonly||saving} onChange={e=>change('LossProcesses',steps.map(s=>s===step?{...s,LossPct:e.target.value}:s))}/></td>
       <td>{!readonly&&<IconButton icon="close" label={'Remove Product loss '+(index+1)} disabled={saving} onClick={()=>{const product=steps.filter(s=>s!==step&&(s.ProcessType==='Sorting'||s.ProcessType==='Processing')).map((s,i)=>({...s,Sequence:i+1}));change('LossProcesses',[...product,...steps.filter(s=>s.ProcessType!=='Sorting'&&s.ProcessType!=='Processing')])}}/>}</td>
      </tr>)}</tbody></table></div>
      {!readonly&&<button disabled={saving||!masterChoices.length||steps.length>=100} onClick={()=>change('LossProcesses',[...steps.filter(s=>s.ProcessType==='Sorting'||s.ProcessType==='Processing'),{...masterChoices[0],ProcessType:'Processing',Sequence:steps.filter(s=>s.ProcessType==='Sorting'||s.ProcessType==='Processing').length+1,LossPct:'0'},...steps.filter(s=>s.ProcessType!=='Sorting'&&s.ProcessType!=='Processing')])}>Add Product loss</button>}
      <label><FieldLabel help="Use L1, L2, … as decimal ratios (3% becomes 0.03). The result is automatically multiplied by 100 for percentage display. Use decimal numbers, parentheses and + - * /. Example: 1-(1-L1)*(1-L2). Blank keeps the sequential-yield calculation. Removing a row renumbers codes; review the formula.">Product Loss Formula</FieldLabel><input aria-label="Product Loss Formula" maxLength={200} disabled={readonly||saving} value={String(inputs.ProductLossFormula??'')} onChange={e=>change('ProductLossFormula',e.target.value)}/></label>
      <button disabled={saving} onClick={async()=>{setError('');try{const result=await call<{LossProductPct:string}>(path.replace(/\/tcb$/,'/loss-formula'),{RowVersion:data.item.RowVersion,Inputs:{ProductLossFormula:inputs.ProductLossFormula||null,LossProcesses:steps.map(s=>({...s,Sequence:Number(s.Sequence)}))}});setFormulaResult(result.LossProductPct+'%')}catch(e){setError((e as Error).message)}}}>Test calculation</button>
      {formulaResult&&<output aria-label="Product Loss Formula result">{formulaResult}</output>}
     </>}
    </div>:<div role="tabpanel" aria-label="Packaging Loss"><table className="item-loss-table"><thead><tr><th>Packaging layer</th><th>Loss ratio (%)</th></tr></thead><tbody>{steps.filter(p=>p.ProcessType!=='Sorting'&&p.ProcessType!=='Processing').map((step,index)=><tr key={step.ProcessType}><td>{(mix?'Mix ':'')+['Primary','Secondary','Tertiary'][index]+' packaging'}</td><td><input aria-label={'Packaging loss ratio '+(index+1)} type="number" min="0" max="100" step="0.01" value={step.LossPct} disabled={readonly||saving} onChange={e=>change('LossProcesses',steps.map(s=>s===step?{...s,LossPct:e.target.value}:s))}/></td></tr>)}</tbody></table></div>}
   </section>}
   {readonly&&<p>Read only — this Opportunity or item is no longer Draft.</p>}
   {message&&<p role="status">{message}</p>}
   <div className="actions"><button type="button" disabled={saving} onClick={close}>Close</button>{!readonly&&<button type="button" className="primary" disabled={saving||!!processError||(!lossOnly&&!mix&&(!calc.product||!!data.gradeError))} onClick={save}>{saving?'Saving…' :lossOnly?'Save item losses':'Save TCB'}</button>}</div>
  </>}
 </Modal>
}
