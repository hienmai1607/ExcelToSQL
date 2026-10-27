import {type Row} from './api';
import {decimalDisplay} from './number-format';

export type CapturedDimension={Name:string;Unit:string;Value:string};
export type LayerDimensionCapture={PackagingTypeName:string;LayerCount:number;Dimensions:CapturedDimension[]};

/** Diameter is a square shipping envelope, not an occupied-area formula. */
export function shippingDimensionsMM(dimensions:CapturedDimension[]){
 const measured:Record<string,number>={},factors:Record<string,number>={mm:1,cm:10,m:1000};
 for(const d of dimensions){const name=d.Name.trim().toLowerCase(),factor=factors[d.Unit.trim().toLowerCase()],value=Number(d.Value);if(factor&&value>0&&Number.isFinite(value)&&measured[name]===undefined)measured[name]=value*factor;}
 const diameter=measured.dia??measured.diameter;
 if(!measured.length&&!measured.width&&diameter){measured.length=diameter;measured.width=diameter;}
 return {length:measured.length||0,width:measured.width||0,height:measured.height||0};
}

export function savedLayerDimensions(captures:unknown,order:string,typeName:string,layers:number,preserveDraft=false):CapturedDimension[]{
 if(!captures||typeof captures!=='object')return [];
 const capture=(captures as Record<string,LayerDimensionCapture>)[order];
 return capture?.PackagingTypeName===typeName&&(capture.LayerCount===layers||preserveDraft)&&Array.isArray(capture.Dimensions)
  ?capture.Dimensions:[];
}

export function capturedDimensions(definition:Row|undefined|null,measurements:Row|undefined|null):CapturedDimension[]{
 return ['D1','D2','D3'].flatMap(key=>{
  const value=measurements?.[key],name=definition?.[key+'Name'],unit=definition?.[key+'Unit'];
  return name&&unit&&value!=null&&Number(value)>0&&Number.isFinite(Number(value))
   ?[{Name:String(name),Unit:String(unit),Value:String(value)}]:[];
 });
}

export function dimensionDisplay(dimensions:CapturedDimension[]){
 const measured=dimensions.filter(d=>d.Name&&d.Unit&&Number.isFinite(Number(d.Value))&&Number(d.Value)>0);
 return {
  label:measured.length?measured.map(d=>d.Name).join(' × '):'Dimensions',
  value:measured.length?measured.map(d=>(decimalDisplay(d.Value,6)??'')+d.Unit).join(' × '):'—',
 };
}
