import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import {decimalDisplay} from './number-format';
import './pkg-pricing.css';
type Component={PriceID:number;RowVersion:string;MaterialRowVersion:string;Quantity:string;AreaM2:string|null};
export type PalletPricing={MaxPayloadKG?:string|null;ID:number;PalletSize:string;Dimensions:{length:string;width:string;height:string};TareKG:string|null;MissingTare:string[];UnitPrice:string;CurrencyCode:string;components:Row[]};
export function readPalletPricing(value:unknown):PalletPricing|null{try{const p=typeof value==='string'?JSON.parse(value):value;return p?.ID&&p?.Dimensions?p:null}catch{return null}}
function EditablePalletCalculator({itemID,itemVersion,size,materialID,initial,referenceMaterials,onApply,onClose}:{itemID:number;itemVersion:string;size:string;materialID?:number;initial:PalletPricing|null;referenceMaterials?:Row[];onApply:(p:PalletPricing)=>void;onClose:()=>void}){
 const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState<Component[]>(initial?.components.map(c=>({PriceID:Number(c.ID),RowVersion:String(c.RowVersion),MaterialRowVersion:String(c.MaterialRowVersion),Quantity:String(c.Quantity),AreaM2:c.AreaM2==null?null:String(c.AreaM2)}))||[]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState<PalletPricing|null>(initial),[query,setQuery]=useState('');
 const copied=initial&&initial.ID>0?[]:referenceMaterials??[];
 const [unpriced,setUnpriced]=useState<Row[]>(copied.filter(m=>!m.ID));
 useEffect(()=>{call<{rows:Row[]}>('/api/pallet-pricing/items/'+itemID).then(x=>{setRows(x.rows);if(!initial&&copied.length)setSelected(copied.flatMap(m=>{const price=x.rows.find(p=>Number(p.ID)===Number(m.ID));return price?[{PriceID:Number(price.ID),RowVersion:String(price.RowVersion),MaterialRowVersion:String(price.MaterialRowVersion),Quantity:String(m.Quantity||'1'),AreaM2:m.AreaM2==null?null:String(m.AreaM2)}]:[]}))}).catch(e=>setError(e.message))},[itemID]);
 const missing=unpriced.filter(m=>!selected.some(c=>Number(rows.find(p=>Number(p.ID)===c.PriceID)?.MaterialID)===Number(m.MaterialID)));
 const matching=(p:Row)=>{const d=p.Dimensions as any;const [l,w]=size.replace(/mm$/i,'').split('x').map(Number);return !!d&&Number(d.length)===l&&Number(d.width)===w};
 const choices=rows.filter(p=>(!p.IsPallet||matching(p)&&(!materialID||Number(p.MaterialID)===materialID))&&String(p.MaterialCode+' '+p.MaterialName+' '+p.VendorName).toLowerCase().includes(query.toLowerCase()));
 function update(next:Component[]){setSelected(next);setResult(null);setError('')}
 function toggle(p:Row){if(selected.some(c=>c.PriceID===Number(p.ID)))update(selected.filter(c=>c.PriceID!==Number(p.ID)));else update([...selected.filter(c=>!p.IsPallet||!rows.find(r=>Number(r.ID)===c.PriceID)?.IsPallet),{PriceID:Number(p.ID),RowVersion:String(p.RowVersion),MaterialRowVersion:String(p.MaterialRowVersion),Quantity:'1',AreaM2:null}])}
 async function calculate(save=false){setBusy(true);setError('');try{const p=await call<PalletPricing>('/api/pallet-pricing/items/'+itemID+(save?'/save':'/preview'),{PalletSize:size,PalletMaterialID:materialID??null,components:selected.map(c=>({...c,AreaM2:c.AreaM2||null})),...(save?{ItemRowVersion:itemVersion}:{})});setResult(p);if(save){onApply(p);onClose()}}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <Modal label="Pallet Pricing Calculator" className="dialog pkg-pricing-dialog pallet-pricing-dialog" onClose={()=>!busy&&onClose()}><div className="pricing-calculator-layout">
  <header className="customer-editor-heading"><h2>Pallet Pricing Calculator</h2><IconButton icon="close" label="Close pallet calculator" disabled={busy} onClick={onClose}/></header>
  <div className="pricing-calculator-body"><ErrorNote value={error}/><p>Pallet size: {size}. Choose one matching pallet, then add accessories per pallet. EA prices only; vendor MOQ is not multiplied into consumption.</p>
   <label>Find pallet material<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
   {missing.length>0&&<section className="panel" aria-label="Copied pallet materials without pricing"><strong>Copied materials — price blank</strong>{missing.map((m,i)=><p key={i}>{String(m.MaterialCode)} — {String(m.MaterialName)}: no applicable price. <button type="button" disabled={busy} onClick={()=>{setUnpriced(xs=>xs.filter(x=>x!==m));setResult(null)}}>Remove copied pallet material</button></p>)}</section>}
   <div className="pricing-catalog"><table aria-label="Pallet material pricing"><thead><tr><th>Select</th><th>Material / child type</th><th>Tare weight</th><th>Vendor</th><th>Effective price</th><th>Effective date</th><th>Vendor MOQ</th></tr></thead><tbody>{choices.map(p=>{const c=selected.find(c=>c.PriceID===Number(p.ID));return <tr key={String(p.ID)}>
    <td><IconButton icon={c?'check':'plus'} label={'Add '+p.MaterialCode+' price '+p.ID} disabled={busy||!!c} onClick={()=>toggle(p)}/></td><td>{String(p.MaterialCode)} — {String(p.MaterialName)}<small>{p.IsPallet?'Matching pallet':String(p.PackagingType||'Accessory')}</small></td>
    <td>{p.TareWeight==null?'—':decimalDisplay(p.TareWeight,9)+' '+p.TareWeightBasis}</td><td>{String(p.VendorName||'No vendor')}</td><td>{decimalDisplay(p.UnitPrice,6)} {String(p.CurrencyCode)} / EA</td><td>{String(p.EffectiveFrom||'—')} → {String(p.EffectiveTo||'Open-ended')}</td><td>{decimalDisplay(p.QuantityFrom,6)}</td></tr>})}</tbody></table></div>
   {!choices.length&&<p>No eligible matching pricing. Maintain active EA pricing and current pallet Length, Width and Height.</p>}
   <div className="pricing-components">{selected.map((c,i)=>{const p=rows.find(p=>Number(p.ID)===c.PriceID),capture=initial?.components.find(p=>Number(p.ID)===c.PriceID),code=p?.MaterialCode??capture?.MaterialCode??c.PriceID;return <section className="panel" key={c.PriceID} aria-label={'Pallet component '+(i+1)}>
    <header><strong>{i+1}. {String(code)} — {String(p?.MaterialName??capture?.MaterialName??'Saved material')}</strong><IconButton icon="close" label={'Remove pallet component '+(i+1)} disabled={busy} onClick={()=>update(selected.filter(x=>x!==c))}/></header>
    <label>Quantity / pallet<input aria-label={'Quantity '+code} type="number" min=".000001" step="any" disabled={busy} readOnly={!!p?.IsPallet} value={c.Quantity} onChange={e=>update(selected.map(x=>x===c?{...x,Quantity:e.target.value}:x))}/></label>
    {p&&!p.IsPallet&&p.TareWeightBasis==='kg/m2'&&<label>Consumed area / EA (m²)<input aria-label={'Area '+p.MaterialCode} type="number" min=".000000001" step="any" disabled={busy} value={c.AreaM2||''} onChange={e=>update(selected.map(x=>x===c?{...x,AreaM2:e.target.value}:x))}/></label>}
    <p>{String(p?.VendorName||'No vendor')} · {p?decimalDisplay(p.UnitPrice,6)+' '+p.CurrencyCode+' / EA':'Saved price unavailable; refresh before applying.'}</p></section>})}</div>
  </div>
  <footer className="pricing-calculator-actions">{result&&<div className="pricing-total" role="status"><strong>Price / pallet: {decimalDisplay(result.UnitPrice,6)} {result.CurrencyCode}</strong><strong>Tare / pallet: {result.TareKG==null?'Incomplete: '+result.MissingTare.join(', '):decimalDisplay(result.TareKG,6)+' kg'}</strong></div>}
   <div className="pricing-calculator-buttons"><button type="button" disabled={busy} onClick={()=>update([])}>Reset selection</button><button type="button" disabled={busy||!selected.length||missing.length>0} onClick={()=>calculate()}>Calculate pallet</button><button type="button" className="primary" disabled={busy||!result||!selected.length||missing.length>0} onClick={()=>calculate(true)}>Apply pallet pricing</button><button type="button" disabled={busy} onClick={onClose}>Close</button></div>
  </footer></div></Modal>
}

export function PalletCalculator(props:Parameters<typeof EditablePalletCalculator>[0]&{editable?:boolean}){
 if(props.editable!==false)return <EditablePalletCalculator {...props}/>;
 const p=props.initial;
 return <Modal label="Pallet Pricing Calculator" className="dialog pkg-pricing-dialog pallet-pricing-dialog" onClose={props.onClose}><div className="pricing-calculator-layout">
 <div className="customer-editor-heading"><h2>Pallet Pricing Calculator</h2><IconButton icon="close" label="Close pallet calculator" onClick={props.onClose}/></div>
 <div className="pricing-calculator-body"><p>Read only. Saved pallet pricing; current master changes do not alter this snapshot.</p>
 {p?<><p>Pallet size: {p.PalletSize} · Dimensions: {Object.values(p.Dimensions).join(' × ')} mm</p>

 <div className="table-scroll"><table aria-label="Saved pallet components"><thead><tr><th>Material / vendor</th><th>Quantity / pallet</th><th>Price / EA</th><th>Tare (kg)</th></tr></thead><tbody>{p.components.map((c,i)=><tr key={i}><td>{String(c.MaterialCode??'')} — {String(c.MaterialName??'')} · {String(c.VendorName??'No vendor')}</td><td>{decimalDisplay(c.Quantity,6)}</td><td>{decimalDisplay(c.UnitPrice,6)} {String(c.CurrencyCode??p.CurrencyCode)}</td><td>{decimalDisplay(c.TareKG??c.TareWeightKG,6)??'Unknown'}</td></tr>)}</tbody></table></div>
 <details><summary>Stored pallet component details</summary><pre>{JSON.stringify(p.components,null,2)}</pre></details></>:<p>No saved pallet pricing is available for this response.</p>}
 </div><footer className="pricing-calculator-actions">{p&&<div className="pricing-total" role="status"><strong>Price / pallet: {decimalDisplay(p.UnitPrice,6)} {p.CurrencyCode}</strong><strong>Tare / pallet: {p.TareKG==null?'Incomplete: '+p.MissingTare.join(', '):decimalDisplay(p.TareKG,6)+' kg'}</strong></div>}<div className="pricing-calculator-buttons"><button type="button" onClick={props.onClose}>Close</button></div></footer></div></Modal>;
}
