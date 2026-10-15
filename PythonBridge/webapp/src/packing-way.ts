import {savedLoadPlan} from './load-plan-values';
import {decimalDisplay} from './number-format';
import {layerCount} from './packaging-orders';

type DecimalInteger={amount:bigint;scale:number};
function weightValue(value:unknown):DecimalInteger|null{
 const match=/^(\d{1,40})(?:\.(\d{0,20}))?$/.exec(String(value??''));
 return match?{amount:BigInt(match[1]+(match[2]||'')),scale:(match[2]||'').length}:null;
}
function unitCount(value:string|undefined){
 return value&&/^\d{1,10}$/.test(value)&&BigInt(value)>0n&&BigInt(value)<=2147483647n?BigInt(value):null;
}
function multiply(value:DecimalInteger|null,factor:bigint|null){return value&&factor!==null?{...value,amount:value.amount*factor}:null}
function display(value:DecimalInteger|null){
 if(!value)return '';
 const scale=10n**BigInt(value.scale),whole=value.amount/scale,tail=value.amount%scale;
 return decimalDisplay(whole.toString()+(value.scale?'.'+tail.toString().padStart(value.scale,'0'):''),6)||'';
}
export function loadSections(configuration:unknown){
 const value=String(configuration??'').trim();
 return {pallet:value!=='Floor load'&&value!=='Both',floor:value==='Floor load'||value==='Both'};
}
export function palletBaseHeight(values:Record<string,string>):number{
 try{const p=JSON.parse(values.PalletPricingJSON||'null');if(p?.PalletSize===values.ResponsePalletSize&&Number(p?.Dimensions?.height)>0)return Number(p.Dimensions.height)}catch{}
 return 150;
}
export function palletLayers(values:Record<string,string>):string{
 const planned=savedLoadPlan(values.LoadPlanJSON);if(planned)return String(planned.Result.pallet_layers);
 const raw=values.HeightMM;
 if(!raw)return /^(0|[1-9]\d{0,9})$/.test(values.LayersPerPallet||'')&&BigInt(values.LayersPerPallet)<=2147483647n?values.LayersPerPallet:'';
 const height=weightValue(raw),maximum=values.ResponseMaxPalletHeightMM;
 if(!/^\d{1,10}(\.\d{0,2})?$/.test(raw)||!height||height.amount<=0n||!/^\d{1,9}$/.test(maximum||'')||BigInt(maximum)<=0n)return '';
 const base=weightValue(String(palletBaseHeight(values)))!,scale=10n**BigInt(base.scale);
 const available=BigInt(maximum)*scale>base.amount?BigInt(maximum)*scale-base.amount:0n;
 const count=available*10n**BigInt(height.scale)/(height.amount*scale);
 return count<=2147483647n?count.toString():'';
}
export function packingWeights(netWeight:unknown,values:Record<string,string>,configuration?:unknown){
 const layers=layerCount(values.ResponseLayerCount),primary=weightValue(values.ApplicableNetWeightGrams||netWeight);
 const secondary=layers>=2?multiply(primary,unitCount(values.UnitsPerCarton)):null;
 const tertiary=layers===3?multiply(secondary,unitCount(values.UnitsPerTertiary)):null;
 const last=[primary,secondary,tertiary][layers-1];
 const primaryUnits=layers===1?1n:unitCount(values.UnitsPerCarton),secondaryUnits=layers<3?1n:unitCount(values.UnitsPerTertiary);
 const cartonsPerLayer=unitCount(values.CartonsPerLayer),count=palletLayers(values),layersPerPallet=count!==''?BigInt(count):null;
 let unitsPerPallet=primaryUnits!==null&&secondaryUnits!==null&&cartonsPerLayer!==null&&layersPerPallet!==null?primaryUnits*secondaryUnits*cartonsPerLayer*layersPerPallet:null;
 let pallet=multiply(multiply(last,cartonsPerLayer),layersPerPallet);
 const load=loadSections(configuration);
 const cartons=unitCount(values.CartonsPerLayer),containerCount=containerLayers(values);
 const containerLayerCount=containerCount!==''?BigInt(containerCount):null;
 const pallets=values.SelectedContainerType&&values.PalletsPerContainer==='0'?0n:unitCount(values.PalletsPerContainer);
 let containerCartons=load.pallet&&pallets!==null&&cartons!==null&&layersPerPallet!==null?pallets*cartons*layersPerPallet*(values.ResponsePalletStacking==='Double'?2n:1n):load.floor?unitCount(values.CartonsPerContainer):null;
 const planned=savedLoadPlan(values.LoadPlanJSON);
 if(planned){containerCartons=BigInt(planned.Result.cartons);pallet=multiply(last,BigInt(planned.Result.cartons_per_pallet));unitsPerPallet=primaryUnits!==null&&secondaryUnits!==null?primaryUnits*secondaryUnits*BigInt(planned.Result.cartons_per_pallet):null}
 const container=multiply(last,containerCartons);
 const floor=load.floor?multiply(last,unitCount(values.CartonsPerContainer)):null;
 return {primary:display(primary),secondary:display(secondary),tertiary:display(tertiary),layersPerPallet:count,layersPerContainer:containerCount,unitsPerPallet:unitsPerPallet?.toLocaleString('en-US')||'',
  palletKG:display(pallet?{...pallet,scale:pallet.scale+3}:null),
  containerCartons:containerCartons?.toLocaleString('en-US')??'',
  containerKG:display(container?{...container,scale:container.scale+3}:null),
  floorKG:display(floor?{...floor,scale:floor.scale+3}:null)};
}

export function containerLayers(values:Record<string,string>):string{
 if(!values.SelectedContainerType)return unitCount(values.LayersPerContainer)?.toString()??'';
 const height=weightValue(values.HeightMM);
 if(!height||height.amount<=0n)return '';
 const count=(values.SelectedContainerType==='20RC'?2070n:2090n)*10n**BigInt(height.scale)/height.amount;
 return count<=2147483647n?count.toString():'';
}
