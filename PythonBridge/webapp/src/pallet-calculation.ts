// Same decimal rounding as fn_PalletArea. Never calculate dimensions using floats.
import {decimalDisplay} from './number-format';
const decimal=/^(\d+)(?:\.(\d*))?$/;
function scaled(value:string,places:number){
 const match=decimal.exec(value);if(!match||(match[2]||'').length>places)return null;
 return BigInt(match[1])*10n**BigInt(places)+BigInt((match[2]||'').padEnd(places,'0')||'0');
}
function compact(value:string){return value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,'').replace(/^0+(?=\d)/,''):value.replace(/^0+(?=\d)/,'')}
export function palletPreview(width:string,length:string,unit:string,factor:unknown){
 const w=scaled(width,4),l=scaled(length,4);
 const size=w!==null&&l!==null&&w>0n&&l>0n&&unit?compact(width)+'x'+compact(length)+unit:'';
 if(!size)return {size,area:'',error:''};
 if(w! >=1000000000000n||l! >=1000000000000n)return {size,area:'',error:'Dimensions are out of range.'};
 const f=factor==null?null:scaled(String(factor),9);
 if(f===null||f<=0n)return {size,area:'',error:'Admin must maintain an active general conversion from this UoM to MM.'};
 const wm=(w!*f+50000n)/100000n,lm=(l!*f+50000n)/100000n;
 if(wm<=0n||lm<=0n||wm>=1000000000000000000n||lm>=1000000000000000000n)return {size,area:'',error:'Converted dimensions or area are out of range.'};
 const area=(wm*lm+50000000n)/100000000n;
 if(area===0n)return {size,area:'',error:'Converted dimensions or area are out of range.'};
 return {size,area:decimalDisplay((area/100000000n)+'.'+(area%100000000n).toString().padStart(8,'0'),8)!,error:''};
}
