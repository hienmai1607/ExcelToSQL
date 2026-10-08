import {type Row} from './api';

export const containerTypes=['20DC','40DC','40HC','20RC','40RHC'] as const;
export const containerCountKeys=['PalletsPerContainer','CartonsPerContainerFloor'] as const;
type Profile=Record<string,string|null>;
export function allowedContainerTypes(family:unknown,size?:unknown){
 const types=family==='Dry'?containerTypes.slice(0,3):family==='Reefer'?containerTypes.slice(3):[...containerTypes];
 return size==='20FT'||size==='40FT'?types.filter(type=>type.startsWith(String(size).slice(0,2))):types;
}
export function parseContainerProfiles(value:unknown):Record<string,Profile>{
 try{
  const parsed=typeof value==='string'?JSON.parse(value):value;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
  return Object.fromEntries(Object.entries(parsed).filter(([key,p])=>containerTypes.includes(key as typeof containerTypes[number])&&p&&typeof p==='object'&&!Array.isArray(p)).map(([key,p])=>[key,Object.fromEntries(containerCountKeys.map(k=>[k,(p as Row)[k]==null?null:String((p as Row)[k])]))]));
 }catch{return {}}
}
export function containerProfileError(values:Record<string,string>){
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
 const current=()=>Object.fromEntries(containerCountKeys.map(k=>[k,k==='CartonsPerContainerFloor'&&!['Floor load','Both'].includes(String(configuration??''))?null:values[k]||null]));
 if(key==='SelectedContainerType'){
  if(old)profiles[old]=current();
  if(value){
   const existing=profiles[value],target=existing??(!old&&!Object.keys(profiles).length?current():{});
   profiles[value]={...target,PalletsPerContainer:existing?existing.PalletsPerContainer:capacity(pallets,values.ResponsePalletSize,value)};
   for(const k of containerCountKeys)next[k]=profiles[value][k]??'';
  }else for(const k of containerCountKeys)next[k]='';
 }else if(key==='ResponsePalletSize'){
  for(const kind of Object.keys(profiles))profiles[kind].PalletsPerContainer=capacity(pallets,value,kind);
  if(old)next.PalletsPerContainer=capacity(pallets,value,old)??'';
 }else if(old&&containerCountKeys.includes(key as typeof containerCountKeys[number])){
  profiles[old]={...current(),[key]:value||null};
 }
 if(old&&key==='ResponsePalletSize')profiles[old]={...current(),PalletsPerContainer:next.PalletsPerContainer||null};
 if(key==='SelectedContainerType'||key==='ResponsePalletSize'||old&&containerCountKeys.includes(key as typeof containerCountKeys[number]))next.ContainerLoadProfiles=JSON.stringify(profiles);
 return next;
}
