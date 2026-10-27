import {type Row} from './api';

export const containerTypes=['20DC','40DC','40HC','20RC','40RHC'] as const;
export const containerCountKeys=['PalletsPerContainer','CartonsPerContainer'] as const;
type Profile=Record<string,string|null>;
export function allowedContainerTypes(family:unknown,size?:unknown){
 const types=containerTypes.includes(family as typeof containerTypes[number])?[family as typeof containerTypes[number]]:family==='Dry'?containerTypes.slice(0,3):family==='Reefer'?containerTypes.slice(3):[...containerTypes];
 return size==='20FT'||size==='40FT'?types.filter(type=>type.startsWith(String(size).slice(0,2))):types;
}
export function parseContainerProfiles(value:unknown):Record<string,Profile>{
 try{
  const parsed=typeof value==='string'?JSON.parse(value):value;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
  return Object.fromEntries(Object.entries(parsed).filter(([key,p])=>containerTypes.includes(key as typeof containerTypes[number])&&p&&typeof p==='object'&&!Array.isArray(p)).map(([key,p])=>[key,{...Object.fromEntries(containerCountKeys.map(k=>[k,((p as Row)[k]??(k==='CartonsPerContainer'?(p as Row).CartonsPerContainerFloor:null))==null?null:String((p as Row)[k]??(k==='CartonsPerContainer'?(p as Row).CartonsPerContainerFloor:null))])),...((p as Row).Proposal!=null?{Proposal:(p as Row).Proposal===true||(p as Row).Proposal==='1'?'1':'0'}:{})}]));
 }catch{return {}}
}
export function proposedContainers(values:Record<string,string>,saved:Row):string[]{
 const profiles=parseContainerProfiles(values.ContainerLoadProfiles);
 const requested=requestedContainers(saved);
 const ensureRequested=(codes:string[])=>codes.some(code=>requested.includes(code as typeof containerTypes[number]))?codes:[...codes,requested.includes(values.SelectedContainerType as typeof containerTypes[number])?values.SelectedContainerType:requested[0]];
 if(Object.values(profiles).some(p=>p.Proposal!=null))return Object.keys(profiles).filter(k=>profiles[k].Proposal==='1');
 const stored=parseContainerProfiles(saved.ContainerLoadProfiles),codes=new Set(Object.keys(stored).filter(k=>containerCountKeys.some(key=>stored[k][key]!=null)));
 try{const plans=typeof saved.ContainerPlansJSON==='string'?JSON.parse(saved.ContainerPlansJSON):saved.ContainerPlansJSON;for(const p of Array.isArray(plans)?plans:Object.values(plans??{}))if((p as Row).Code)codes.add(String((p as Row).Code))}catch{}
 try{const plan=typeof saved.LoadPlanJSON==='string'?JSON.parse(saved.LoadPlanJSON):saved.LoadPlanJSON;if(plan?.Code)codes.add(String(plan.Code))}catch{}
 if(saved.SelectedContainerType&&saved.CalculatedCartonsPerContainer!=null)codes.add(String(saved.SelectedContainerType));
 return ensureRequested([...codes]);
}
export function requestedContainers(saved:Row){return containerTypes.includes(saved.ContainerRequest as typeof containerTypes[number])?[saved.ContainerRequest as typeof containerTypes[number]]:allowedContainerTypes(saved.ContainerRequest,saved.ShipmentContainerSizeFT)}
export function requiredContainers(proposed:string[],saved:Row){const required=requestedContainers(saved),matching=proposed.filter(code=>required.includes(code as typeof containerTypes[number]));return matching.length===1?matching:matching.length===0?[required[0]]:[]}
export function proposalProfiles(values:Record<string,string>,saved:Row,code:string,checked:boolean,floorCount?:string){
 const profiles=parseContainerProfiles(values.ContainerLoadProfiles),selected=proposedContainers(values,saved);
 for(const kind of containerTypes)profiles[kind]={...profiles[kind],Proposal:(kind===code?checked:selected.includes(kind))?'1':'0'};
 if(checked&&floorCount)profiles[code].CartonsPerContainer=floorCount;
 return JSON.stringify(profiles);
}
export function profilesPayload(value:unknown){return Object.fromEntries(Object.entries(parseContainerProfiles(value)).map(([code,p])=>[code,{...p,...(p.Proposal!=null?{Proposal:p.Proposal==='1'}:{})}]))}
export function containerProfileError(values:Record<string,string>,configuration?:unknown,child=false){
 if(!child&&['Floor load','Both'].includes(String(configuration??''))&&!/^[1-9]\d{0,9}$/.test(values.CartonsPerContainer||''))return 'Carton / Container is required for Floor load and Both.';
 const profiles=parseContainerProfiles(values.ContainerLoadProfiles);
 for(const [kind,profile] of Object.entries(profiles))for(const key of containerCountKeys){
  const value=profile[key];
  if(value!=null&&value!==''&&(!/^\d{1,10}$/.test(value)||Number(value)<(key==='PalletsPerContainer'?0:1)||Number(value)>2147483647))return 'Check '+kind+' '+key+': use a whole number within the allowed range.';
 }
 return '';
}
function capacity(pallets:Row[],size:string,kind:string){
 const value=pallets.find(p=>p.PalletSize===size)?.['PalletsPer'+kind];
 return value==null?null:String(value);
}
export function containerChange(values:Record<string,string>,key:string,value:string,pallets:Row[],configuration?:unknown){
 const next={...values,[key]:value},profiles=parseContainerProfiles(values.ContainerLoadProfiles),old=values.SelectedContainerType;
 const current=()=>({...profiles[old],...Object.fromEntries(containerCountKeys.map(k=>[k,k==='CartonsPerContainer'&&!['Floor load','Both'].includes(String(configuration??''))?null:values[k]||null]))});
 if(key==='SelectedContainerType'){
  if(old)profiles[old]=current();
  if(value){
   const existing=profiles[value],target=existing??(!old&&!Object.keys(profiles).length?current():{});
   profiles[value]={...target,PalletsPerContainer:['Floor load','Both'].includes(String(configuration??''))?null:existing?existing.PalletsPerContainer:capacity(pallets,values.ResponsePalletSize,value)};
   for(const k of containerCountKeys)next[k]=profiles[value][k]??'';
  }else for(const k of containerCountKeys)next[k]='';
 }else if(key==='ResponsePalletSize'){
  for(const kind of Object.keys(profiles))profiles[kind].PalletsPerContainer=['Floor load','Both'].includes(String(configuration??''))?null:capacity(pallets,value,kind);
  if(old)next.PalletsPerContainer=['Floor load','Both'].includes(String(configuration??''))?'':capacity(pallets,value,old)??'';
 }else if(old&&containerCountKeys.includes(key as typeof containerCountKeys[number])){
  profiles[old]={...current(),[key]:value||null};
 }
 if(old&&key==='ResponsePalletSize')profiles[old]={...current(),PalletsPerContainer:next.PalletsPerContainer||null};
 if(key==='SelectedContainerType'||key==='ResponsePalletSize'||old&&containerCountKeys.includes(key as typeof containerCountKeys[number]))next.ContainerLoadProfiles=JSON.stringify(profiles);
 return next;
}
