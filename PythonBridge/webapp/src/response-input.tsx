import {palletDimensionLabel} from './pallet-label';
import {createContext,useContext,useEffect,useState} from 'react';
export const ResponseEditable=createContext(true);
import {call,type Row} from './api';
import {NumericInput} from './numeric-input';
import {decimalDisplay} from './number-format';
import {type PackagingField,fieldValues,webResponseFields} from './packaging-fields';
import {responseOrderFields,selectableType,layerCount,packagingOrders,globalOrder} from './packaging-orders';

export function responseValues(row:Row){
 const values=fieldValues(row,webResponseFields);
 try{const p=JSON.parse(values.LoadPlanJSON||'null');if(p?.Code)values.SelectedContainerType=p.Code}catch{}
 if(!values.ApplicableNetWeightGrams)values.ApplicableNetWeightGrams=String(row.ApplicableNetWeightGrams??row.WeightGrams??'');
 if(!values.NutDensity&&row.NutDensityDefault!=null)values.NutDensity=String(row.NutDensityDefault);
 values.NutDensityDefaultUpdate='0';values.NutDensityDefaultRowVersion=String(row.NutDensityDefaultRowVersion??'');
 if(['Floor load','Both'].includes(String(row.ConfigurationRequest)))values.CartonsPerContainer=String(row.CartonsPerContainer??row.CartonsPerContainerFloor??'');
 // Older requests receive draft defaults once; saved clears must remain cleared.
 if(!row.ResponseDefaultsInitialized)for(const [field,requested] of [['FirstPMType','PrimaryTypeName'],['SecondPMType','SecondaryTypeName'],['ThirdPMType','TertiaryTypeName'],['FourthPMType','QuaternaryTypeName'],['UnitsPerCarton','NumberOfPrimary'],['UnitsPerTertiary','NumberOfSecondary'],['UnitsPerQuaternary','NumberOfTertiary'],['ResponsePalletSize','PalletSize'],['ResponsePalletStacking','PalletStacking'],['ResponseMaxPalletHeightMM','MaxPalletHeightMM']]){
  if(!values[field]?.trim())values[field]=String(row[requested]??'');
 }
 return values;
}

export function useResponseTypes(){
 const [pallets,setPallets]=useState<Row[]>([]);
 const [types,setTypes]=useState<Row[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;call<{packagingTypes:Row[];pallets?:Row[]}>('/api/packaging/lookups').then(d=>{if(active){setTypes(d.packagingTypes||[]);setPallets(d.pallets||[])}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
 return {types,pallets,loading,error};
}
const orderFor=(key:string)=>responseOrderFields.find(f=>f.type===key)?.order;
export function responseTypeError(key:string,value:string,original:unknown,types:Row[],layers?:unknown,originalLayers?:unknown,mixChild=false,mixParent=false,start=1){
 const order=orderFor(key);
 return order&&value.trim()&&(value!==String(original??'')||layerCount(layers)!==layerCount(originalLayers))&&!types.some(t=>selectableType(t,order,layers,mixChild,mixParent,start)&&t.PackagingType===value)?'Choose an active '+order+' Type from Packaging Type Master.':'';
}
export function ResponseInput({field,value,onChange,types,pallets=[],loading,layers,mixChild=false,mixParent=false,start=1}:{field:PackagingField;value:string;onChange:(v:string)=>void;types:Row[];pallets?:Row[];loading:boolean;layers?:unknown;mixChild?:boolean;mixParent?:boolean;start?:number}){
 if(orderFor(field.key)&&start>1)field={...field,label:globalOrder(orderFor(field.key)!,start)+' Type'};
 const editable=useContext(ResponseEditable);
 if(field.readOnly||!editable)return <input disabled={!editable} readOnly aria-label={field.label} value={field.numeric?(decimalDisplay(value,9)??''):value}/>;
 const order=orderFor(field.key),choices=types.filter(t=>!!order&&selectableType(t,order,layers,mixChild,mixParent,start));
 if(field.key==='ResponsePalletSize'||field.key==='ResponsePalletStacking'){
  const options=field.key==='ResponsePalletSize'?pallets.map(p=>({value:String(p.PalletSize),label:palletDimensionLabel(p)})):['Single','Double'].map(value=>({value,label:value}));
  return <select aria-label={field.label} value={value} disabled={loading} onChange={e=>onChange(e.target.value)}><option value="">Choose {field.label.toLowerCase()}</option>{value&&!options.some(o=>o.value===value)&&<option value={value} disabled>{value} (existing value — unavailable)</option>}{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>;
 }
 if(field.key==='ResponseLayerCount')return <select aria-label={field.label} value={value} onChange={e=>onChange(e.target.value)}>{[1,2,3,4].filter(n=>n<=Math.min(mixChild?3:4,5-start)).map(n=><option key={n} value={n}>{n} — {packagingOrders.slice(start-1,start+n-1).join(' + ')}</option>)}</select>;
 if(order)return <select aria-label={field.label} value={value} disabled={loading} onChange={e=>onChange(e.target.value)}>
  <option value="">Choose {globalOrder(order,start).toLowerCase()} type</option>
  {value&&!choices.some(t=>t.PackagingType===value)&&<option value={value} disabled>{value} (legacy / unavailable)</option>}
  {choices.map(t=><option key={String(t.ID)} value={String(t.PackagingType)}>{String(t.PackagingType)}</option>)}
 </select>;
 return field.numeric?<NumericInput field={field.key} aria-label={field.label} value={value} onValueChange={onChange}/>:<input maxLength={field.max||200} value={value} onChange={e=>onChange(e.target.value)}/>;
}
