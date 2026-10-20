import type {Row} from './api';
import {AddMasterButton} from './add-master-button';
import {IconButton} from './icons';
import {decimalDisplay} from './number-format';
export type MixDraft={Status:'Draft'|'Active';items:{ProductID:string;UnitQuantity:string}[]};
export const emptyMix=():MixDraft=>({Status:'Active',items:[]});
export function mixChoices(products:Row[],customer:string){return products.filter(p=>String(p.CustomerID)===customer&&p.Status==='Active'&&!p.IsMix)}
export function mixWeight(mix:MixDraft,choices:Row[]){return mix.items.reduce((total,item)=>total+Number(choices.find(p=>String(p.ID)===item.ProductID)?.WeightGrams||0)*Number(item.UnitQuantity||0),0)}
export function mixError(mix:MixDraft,choices:Row[]){
 if(!mix.items.length)return 'Add at least one child Product.';
 if(mix.items.length>500)return 'Use no more than 500 child Products.';
 if(mix.items.some(i=>!choices.some(p=>String(p.ID)===i.ProductID)))return 'Choose active normal Products belonging to this Customer.';
 if(new Set(mix.items.map(i=>i.ProductID)).size!==mix.items.length)return 'Each child Product can appear only once.';
 if(mix.items.some(i=>!/^\d{1,8}(\.\d{1,4})?$/.test(i.UnitQuantity)||Number(i.UnitQuantity)<=0))return 'Use positive unit quantities with up to 4 decimal places.';
 const total=mixWeight(mix,choices);
 return !Number.isFinite(total)||total<0.005||total>99999999.99?'Calculated net weight is outside the supported range.':'';
}
export function ProductMixDraft({value,choices,disabled,error,onChange,onNewChild}:{value:MixDraft;choices:Row[];disabled:boolean;error?:string;onChange:(value:MixDraft)=>void;onNewChild:()=>void}){
 function change(index:number,key:'ProductID'|'UnitQuantity',next:string){onChange({...value,items:value.items.map((item,i)=>i===index?{...item,[key]:next}:item)})}
 return <fieldset className="initial-product-mix" disabled={disabled}><legend>Product Mix children</legend>
 <div className="mix-draft-toolbar"><label>Initial mix status<select aria-label="Initial mix status" value={value.Status} onChange={e=>onChange({...value,Status:e.target.value as MixDraft['Status']})}><option>Active</option><option>Draft</option></select></label>
 <div className="mix-draft-actions" role="group" aria-label="Product Mix child actions"><IconButton icon="plus" label="Add child Product" disabled={value.items.length>=500} onClick={()=>onChange({...value,items:[...value.items,{ProductID:'',UnitQuantity:'1'}]})}/>
 <AddMasterButton entity="products" label="New child Product" onClick={onNewChild}/></div></div>
 {!choices.length&&<p>No active normal Products for this Customer. Create a child Product first.</p>}
 <div className="table-wrap"><table className="mix-table"><thead><tr><th>Child Product</th><th>Unit quantity</th><th>Net weight (g)</th><th/></tr></thead><tbody>
 {value.items.map((item,index)=><tr key={index}><td><select aria-label={'Child Product '+(index+1)} value={item.ProductID} onChange={e=>change(index,'ProductID',e.target.value)}><option value="">Choose Product</option>{choices.map(p=><option key={String(p.ID)} value={String(p.ID)} disabled={value.items.some((i,n)=>n!==index&&i.ProductID===String(p.ID))}>{p.ProductCode} — {p.ProductName}</option>)}</select></td>
 <td><input aria-label={'Child quantity '+(index+1)} inputMode="decimal" value={item.UnitQuantity} onChange={e=>change(index,'UnitQuantity',e.target.value)}/></td>
 <td>{decimalDisplay(Number(choices.find(p=>String(p.ID)===item.ProductID)?.WeightGrams||0)*Number(item.UnitQuantity||0),2)}</td>
 <td><IconButton icon="close" label={'Remove child Product '+(index+1)} onClick={()=>onChange({...value,items:value.items.filter((_,i)=>i!==index)})}/></td></tr>)}
 </tbody></table></div>
 {error&&<p role="alert" className="field-error">{error}</p>}
 </fieldset>;
}
