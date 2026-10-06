import type {Row} from './api';import {FieldLabel} from './ui';import {parseMixStructure,mixFormula,type MixStructure} from './mix-structure';
import {requirementFields,type PackagingField,fieldValues,fieldPayload} from './packaging-fields';
import {selectableType,layerCount} from './packaging-orders';

const logistics=['PalletSize','PalletStacking','MaxPalletHeightMM'];
const choices:Record<string,string[]>={
 ContainerRequest:['Dry','Reefer','Both'],ConfigurationRequest:['Pallet load','Floor load','Both'],
 PalletStacking:['Single','Double'],Transparency:['Transparent','Opaque','NA'],
 SecondaryTransparency:['Transparent','Opaque','NA'],TertiaryTransparency:['Transparent','Opaque','NA'],PackagingLayerCount:['1','2','3']
};
for(const prefix of ['','Secondary','Tertiary']){
 choices[prefix+'RecyclableRequirement']=['Yes','No','NA'];
 choices[prefix+'RecycledContent']=['Yes','No','NA'];
 choices[prefix+'MetalizedAluminum']=['Metalized','Aluminum','NA'];
}
export const webRequirementFields:PackagingField[]=[
 ...requirementFields.filter(f=>!['PackagingType','ShelfLifeDays','MaxPalletHeightM'].includes(f.key)),
 {key:'MaxPalletHeightMM',label:'Max pallet height (mm)',numeric:true,integer:true,parentOnly:true},
 ...['Secondary','Tertiary'].flatMap(layer=>[
  {key:layer+'RecyclableRequirement',label:layer+' recyclable requirement',max:200},
  {key:layer+'RecycledContent',label:layer+' recycled content',max:200},
  {key:layer+'MetalizedAluminum',label:layer+' metalized / aluminum',max:100},
  {key:layer+'SpecialComments',label:layer+' special comments',max:1000},
 ]),
 {key:'PrimaryTypeID',label:'Primary Type'},
 {key:'SecondaryTypeID',label:'Secondary Type'},
 {key:'SecondaryTransparency',label:'Secondary Transparent / opaque'},
 {key:'NumberOfPrimary',label:'Number of Primary',numeric:true,integer:true},
 {key:'PackagingLayerCount',label:'Requested packaging layers',numeric:true,integer:true},
 {key:'TertiaryTypeID',label:'Tertiary Type'},
 {key:'TertiaryTransparency',label:'Tertiary Transparent / opaque'},
 {key:'NumberOfSecondary',label:'Number of Secondary',numeric:true,integer:true}
];
export const webRequirementFieldsFor=(child:boolean)=>webRequirementFields.filter(f=>!child||!f.parentOnly&&f.key!=='ConfigurationRequest');
export const webRequirementValues=(row?:Row)=>({...fieldValues(row,webRequirementFields),ShelfLifeDays:String(row?.ShelfLifeDays??''),MaxPalletHeightMM:String(row?.MaxPalletHeightMM??(row?.MaxPalletHeightM==null?'':Math.round(Number(row.MaxPalletHeightM)*1000))),PackagingLayerCount:String(row?.PackagingLayerCount??row?.RequestedLayerCount??2)});
const orderFor=(key:string)=>key==='PrimaryTypeID'?'Primary':key==='SecondaryTypeID'?'Secondary':key==='TertiaryTypeID'?'Tertiary':null;
function requirementActive(key:string,values:Record<string,string>){const layers=layerCount(values.PackagingLayerCount);return !((layers<2&&(key.startsWith('Secondary')||key==='NumberOfPrimary'))||(layers<3&&(key.startsWith('Tertiary')||key==='NumberOfSecondary')))}
export function copyWebRequirements(target:Record<string,string>,source:Record<string,string>,targetChild:boolean,sourceChild:boolean){
 const result={...target},sourceKeys=new Set(webRequirementFieldsFor(sourceChild).map(f=>f.key));
 for(const field of webRequirementFieldsFor(targetChild))if(sourceKeys.has(field.key))result[field.key]=source[field.key]||'';
 if(result.ConfigurationRequest==='Floor load')for(const key of logistics)result[key]='';
 return result;
}
export function webRequirementPayload(values:Record<string,string>,child:boolean){
 const payload=fieldPayload(values,webRequirementFieldsFor(child));
 for(const key of Object.keys(payload))if(!requirementActive(key,values))payload[key]=null;
 if(values.ConfigurationRequest==='Floor load')for(const key of logistics)if(key in payload)payload[key]=null;
 return {...payload,WebPackagingRequirements:true};
}
export function requirementError(values:Record<string,string>,original:Record<string,string>|undefined,types:Row[],pallets:Row[],child:boolean,mixParent=false){
 const fields=webRequirementFieldsFor(child).filter(f=>requirementActive(f.key,values)&&(values.ConfigurationRequest!=='Floor load'||!logistics.includes(f.key)));
 for(const f of fields){
  const value=values[f.key]?.trim()||'';if(!value)continue;
  if(choices[f.key]&&!choices[f.key].includes(value)&&value!==original?.[f.key])return 'Choose a valid '+f.label+'.';
  if(f.key==='MaxPalletHeightMM'&&(!/^\d{1,9}$/.test(value)||Number(value)<=0))return 'Use a positive whole Max pallet height in millimeters.';
  if(f.numeric&&(!/^\d+(\.\d+)?$/.test(value)||(f.integer&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>2147483647))))return 'Check '+f.label+'.';
  if(f.key==='PalletSize'&&value!==original?.PalletSize&&!pallets.some(p=>p.PalletSize===value))return 'Choose an active pallet size from Pallet Master.';
  const order=orderFor(f.key);
  if(order&&(value!==original?.[f.key]||layerCount(values.PackagingLayerCount)!==layerCount(original?.PackagingLayerCount))&&!types.some(t=>String(t.ID)===value&&selectableType(t,order,values.PackagingLayerCount,child,mixParent)&&t.ParentTypeID==null&&t.Status!=='Block'))return 'Choose an active top-level '+f.label+'.';
 }
 return '';
}

export function RequirementSections({values,types=[],pallets=[],child=false,onChange,row,mix}:{values:Record<string,string>;types?:Row[];pallets?:Row[];child?:boolean;shelfLife?:unknown;onChange?:(key:string,value:string)=>void;row?:Row;mix?:MixStructure|null}){
 const readOnly=!onChange;const structure=child?null:mix??parseMixStructure(row?.ProductMixSnapshot??row?.MixStructure);const mixParent=!!structure;const unitLabel=(layer:string)=>'No of '+layer+(structure?' Mix':'')+' Unit';const unitHelp=mixFormula(structure);
 const layers=layerCount(values.PackagingLayerCount);
 function input(key:string,label:string,help?:string){
  const value=values[key]||'';
  if(readOnly){const display=key.endsWith('TypeID')?row?.[key.replace('ID','Name')]:value;return <div className="packaging-readonly-field" key={key}><FieldLabel help={help}>{label}</FieldLabel><p>{String(display||'—')}</p></div>}
  const order=orderFor(key);
  const options=order?types.filter(t=>selectableType(t,order,values.PackagingLayerCount,child,mixParent)&&t.ParentTypeID==null&&t.Status!=='Block').map(t=>({id:String(t.ID),label:String(t.PackagingType)})):key==='PalletSize'?pallets.map(p=>({id:String(p.PalletSize),label:String(p.PalletSize)})):choices[key]?.map(v=>({id:v,label:v}));
  return <label key={key}><FieldLabel help={help}>{label}</FieldLabel>{options?<><select aria-label={label} value={value} onChange={e=>onChange!(key,e.target.value)}><option value="">{key==='PalletSize'?'Choose pallet size':'Choose '+label.toLowerCase()}</option>{value&&!options.some(o=>o.id===value)&&<option value={value} disabled>{String(order?row?.[order+'TypeName']||'Existing type #'+value:value)} (existing value — unavailable)</option>}{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>{key==='PalletSize'&&!pallets.length&&<small>No active pallets. Admin or Packaging must add records in Pallet Master.</small>}</>:<input aria-label={label} maxLength={webRequirementFields.find(f=>f.key===key)?.max||24} inputMode={['MaxPalletHeightMM','NumberOfPrimary','NumberOfSecondary'].includes(key)?'decimal':undefined} value={value} onChange={e=>onChange!(key,e.target.value)}/>}</label>;
 }
 const requirements=(prefix:string)=>['RecyclableRequirement','RecycledContent','MetalizedAluminum','SpecialComments'].map((key,i)=>input(prefix+key,['Recyclable requirement','Recycled content','Metalized / aluminum','Special comments'][i]));
 return <div className="requirement-sections">
  <section aria-label="Packing Way request"><div className="response-section-heading"><h4>Packing Way</h4><div className="request-layer-choice">{input('PackagingLayerCount','Requested packaging layers','1: Primary · 2: Primary + Secondary · 3: Primary + Secondary + Tertiary')}</div></div><div className="packing-way-grid" data-layers={layers}>
   {layers>1?input('NumberOfPrimary',unitLabel('Primary'),unitHelp):<div className="packaging-readonly-field"><FieldLabel help={unitHelp}>{unitLabel('Primary')}</FieldLabel><p>1</p></div>}
   {layers===3?input('NumberOfSecondary',unitLabel('Secondary'),unitHelp):layers===2&&<div className="packaging-readonly-field"><FieldLabel help={unitHelp}>{unitLabel('Secondary')}</FieldLabel><p>1</p></div>}
   {layers===3&&<div className="packaging-readonly-field"><FieldLabel>No of Tertiary Unit</FieldLabel><p>1</p></div>}
  </div></section>
  <div className="packaging-request-layers" data-layers={layers}>{['Primary','Secondary','Tertiary'].slice(0,layers).map((layer,i)=><section key={layer} aria-label={layer+' packaging requirements'}><h4>{layer} packaging</h4><div className="packaging-entry-grid">{input(layer+'TypeID',readOnly?'Requested '+layer+' Type':layer+' Type')}{input(i===0?'Transparency':layer+'Transparency',layer+' Transparent / opaque')}{requirements(i===0?'':layer)}</div></section>)}</div>
  {!child&&<section aria-label="Container and Configuration"><h4>Container and Configuration</h4><div className="packaging-entry-grid">{!child&&input('ContainerRequest','Container request')}{input('ConfigurationRequest','Configuration request')}</div></section>}
  {!child&&values.ConfigurationRequest!=='Floor load'&&<section aria-label="Palletization request"><h4>Palletization</h4><div className="packaging-entry-grid">{input('PalletSize','Pallet size')}{input('PalletStacking','Pallet stacking')}{input('MaxPalletHeightMM','Max pallet height (mm)')}</div></section>}
  {row?.PackagingType!=null&&<section><h4>Legacy packaging type</h4><p>{String(row.PackagingType)}</p></section>}
 </div>;
}
