/** Duty % tax lines: pure helpers shared by the calculator and shipment validation (no UI/CSS imports). */
export type DutyLine={TaxType:string;Pct:string};
const percent=/^\d{1,3}(\.\d{1,4})?$/;
const SCALE=10000n;

/** Saved breakdown, or one "Duty" line carrying a legacy Duty % so nothing is lost when the calculator opens. */
export function dutyLines(raw:string,current:string):DutyLine[]{
 try{const value=JSON.parse(raw||'null');if(Array.isArray(value))return value.map(line=>({TaxType:String(line?.TaxType??''),Pct:String(line?.Pct??'')}))}catch{}
 return current?[{TaxType:'Duty',Pct:current}]:[];
}
/** Up to four decimals, at least two: 3 -> 3.00, 4.125 -> 4.125, 1.23456 stays invalid elsewhere. */
export function dutyDisplay(value:string){
 if(!/^\d+(\.\d+)?$/.test(value))return value;
 const [whole,tail='']=value.split('.');const digits=tail.replace(/0+$/,'').padEnd(2,'0');
 return whole.replace(/^0+(?=\d)/,'')+'.'+digits;
}
/** Exact sum to four decimals; null when a line is invalid or the total exceeds 100%. */
export function dutyTotal(lines:DutyLine[]):string|null{
 let units=0n;
 for(const line of lines){
  if(!line.TaxType.trim()||line.TaxType.trim().length>100||!percent.test(line.Pct))return null;
  const [whole,tail='']=line.Pct.split('.');units+=BigInt(whole)*SCALE+BigInt(tail.padEnd(4,'0'));
 }
 return units>100n*SCALE?null:dutyDisplay(String(units/SCALE)+'.'+String(units%SCALE).padStart(4,'0'));
}
