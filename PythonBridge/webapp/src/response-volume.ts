import {decimalDisplay} from './number-format';
import {numericEntryError} from './numeric-input';

// Calculate with decimal integers, avoiding binary-float rounding in the preview.
export function usedVolumeDisplay(weight:unknown,density:string):string{
 if(!density||numericEntryError('NutDensity',density))return '';
 const parse=(value:unknown)=>{
  const match=/^(\d+)(?:\.(\d*))?$/.exec(String(value??''));
  return match?{value:BigInt(match[1]+(match[2]||'')),scale:(match[2]||'').length}:null;
 };
 const w=parse(weight),d=parse(density);if(!w||!d||d.value<=0n)return '';
 const numerator=w.value*10n**BigInt(d.scale+6),denominator=d.value*10n**BigInt(w.scale);
 const amount=(numerator+denominator/2n)/denominator;
 return decimalDisplay((amount/1000000n).toString()+'.'+(amount%1000000n).toString().padStart(6,'0'),6)||'';
}
