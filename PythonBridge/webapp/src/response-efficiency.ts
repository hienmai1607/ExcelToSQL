import {savedLoadPlan} from './load-plan-values';
import {decimalDisplay} from './number-format';
import {layerCount} from './packaging-orders';
import {palletLayers,palletBaseHeight} from './packing-way';

type Rational={n:bigint;d:bigint};
export type GeometryMetrics={AreaM2?:unknown;VolumeM3?:unknown};
function value(raw:unknown,zero=false):Rational|null{
 const match=/^(?:(\d{1,40})(?:\.(\d{0,40}))?|\.(\d{1,40}))$/.exec(String(raw??''));
 if(!match)return null;
 const fraction=match[2]||match[3]||'',n=BigInt((match[1]||'0')+fraction);
 return n>0n||zero?{n,d:10n**BigInt(fraction.length)}:null;
}
const constant=(n:number):Rational=>({n:BigInt(n),d:1n});
const multiply=(a:Rational,b:Rational):Rational=>({n:a.n*b.n,d:a.d*b.d});
const divide=(a:Rational,b:Rational):Rational=>({n:a.n*b.d,d:a.d*b.n});
const add=(a:Rational,b:Rational):Rational=>({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
export type MixTotals={weight:Rational|null;volume:Rational|null};
export function mixTotals(snapshot:unknown,children:unknown):MixTotals{
 const empty={weight:null,volume:null};
 try{
  const structure=typeof snapshot==='string'?JSON.parse(snapshot):snapshot;
  const responses=typeof children==='string'?JSON.parse(children):children;
  if(!structure||!Array.isArray(structure.items)||!structure.items.length)return empty;
  const densities=new Map<string,Rational|null>(),weights=new Map<string,Rational|null>();
  for(const child of Array.isArray(responses)?responses:[]){
   if(!child||typeof child!=='object')continue;
   const key=String(child.ProductID);if('ApplicableNetWeightGrams' in child)weights.set(key,value(child.ApplicableNetWeightGrams,true));densities.set(key,densities.has(key)?null:value(child.NutDensity));
  }
  let weight=constant(0),volume=constant(0),complete=true;
  const seen=new Set<string>();
  for(const child of structure.items){
   if(!child||typeof child!=='object')return empty;
   const key=String(child.ProductID),quantity=value(child.UnitQuantity??child.MixUnitQuantity),grams=weights.has(String(child.ProductID))?weights.get(String(child.ProductID))??null:value(child.WeightGrams,true);
   if(['undefined','null',''].includes(key)||seen.has(key)||!quantity||!grams)return empty;
   seen.add(key);const used=multiply(quantity,grams),density=densities.get(key);
   weight=add(weight,used);if(density)volume=add(volume,divide(used,density));else complete=false;
  }
  return {weight,volume:complete?volume:null};
 }catch{return empty}
}
export const mixWeightDisplay=(totals:MixTotals)=>display(totals.weight);
export const mixVolumeDisplay=(totals:MixTotals)=>display(totals.volume);
function count(raw:unknown,zero=false){
 const v=value(raw,zero);
 return v&&v.n%v.d===0n&&v.n/v.d<=2147483647n?v:null;
}
function display(v:Rational|null,places=6,fixed=false){
 if(!v)return '';
 const scale=10n**BigInt(places),scaled=v.n*scale;
 const rounded=scaled/v.d+(scaled%v.d*2n>=v.d?1n:0n);
 return decimalDisplay((rounded/scale)+'.'+(rounded%scale).toString().padStart(places,'0'),places,fixed)||'';
}
export function responseEfficiency(netWeight:unknown,values:Record<string,string>,geometry:GeometryMetrics,palletAreaMM2:unknown,mix?:MixTotals){
 const layers=layerCount(values.ResponseLayerCount),height=value(values.HeightMM);
 const palletCount=count(palletLayers(values),true),maximum=value(values.ResponseMaxPalletHeightMM);
 let last=value(values.ApplicableNetWeightGrams||netWeight,true);
 for(const key of ['UnitsPerCarton','UnitsPerTertiary'].slice(0,layers-1)){
  const units=count(values[key]);last=last&&units?multiply(last,units):null;
 }
 const volume=value(geometry.VolumeM3),area=value(geometry.AreaM2),density=value(values.NutDensity);
 const saved=savedLoadPlan(values.LoadPlanJSON);
 const cartons=count(saved?saved.Result.cartons_per_layer:values.CartonsPerLayer),palletArea=value(saved?.Inputs.pallet?saved.Inputs.pallet.length*saved.Inputs.pallet.width:palletAreaMM2);
 const palletHeight=saved?value(saved.Result.loaded_unit_height):height&&palletCount?add(multiply(height,palletCount),value(palletBaseHeight(values))!):null;
 if(mix)last=mix.weight;
 const carton=last&&volume?divide(divide(last,constant(1000)),volume):null;
 const relative=mix?(mix.volume&&volume?multiply(divide(divide(mix.volume,constant(1000000)),volume),constant(100)):null)
  :(carton&&density?multiply(divide(divide(carton,density),constant(1000)),constant(100)):null);
 return {
  palletHeight:display(palletHeight),
  carton:display(carton),
  relative:display(relative,2,true),
  utilization:display(area&&cartons&&palletArea?multiply(divide(multiply(area,cartons),divide(palletArea,constant(1000000))),constant(100)):null,2,true),
  heightEfficiency:display(palletHeight&&(saved?value(saved.Inputs.max_pallet_height):maximum)?multiply(divide(palletHeight,(saved?value(saved.Inputs.max_pallet_height):maximum)!),constant(100)):null,2,true),
 };
}
