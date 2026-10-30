import type {Fraction} from './packaging-summary-model';

export function finalBoxDisplay(value:Fraction,currency:string){
 const cents=(value.n*100n+value.d-1n)/value.d;
 return (cents/100n).toLocaleString('en-US')+'.'+String(cents%100n).padStart(2,'0')+' '+currency;
}
