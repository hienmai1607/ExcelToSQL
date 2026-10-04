import {decimalDisplay} from './number-format';
import {layerCount} from './packaging-orders';
import {palletLayers} from './packing-way';

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
export function responseEfficiency(netWeight:unknown,values:Record<string,string>,geometry:GeometryMetrics,palletAreaMM2:unknown){
 const layers=layerCount(values.ResponseLayerCount),height=value(values.HeightMM);
 const palletCount=count(palletLayers(values),true),maximum=value(values.ResponseMaxPalletHeightMM);
 let last=value(netWeight,true);
 for(const key of ['UnitsPerCarton','UnitsPerTertiary'].slice(0,layers-1)){
  const units=count(values[key]);last=last&&units?multiply(last,units):null;
 }
 const volume=value(geometry.VolumeM3),area=value(geometry.AreaM2),density=value(values.NutDensity);
 const cartons=count(values.CartonsPerLayer),palletArea=value(palletAreaMM2);
 const palletHeight=height&&palletCount?{...multiply(height,palletCount),n:height.n*palletCount.n+150n*height.d*palletCount.d}:null;
 const carton=last&&volume?divide(divide(last,constant(1000)),volume):null;
 return {
  palletHeight:display(palletHeight),
  carton:display(carton),
  relative:display(carton&&density?multiply(divide(divide(carton,density),constant(1000)),constant(100)):null,2,true),
  utilization:display(area&&cartons&&palletArea?multiply(divide(multiply(area,cartons),divide(palletArea,constant(1000000))),constant(100)):null,2,true),
  heightEfficiency:display(palletHeight&&maximum?multiply(divide(palletHeight,maximum),constant(100)):null,2,true),
 };
}
