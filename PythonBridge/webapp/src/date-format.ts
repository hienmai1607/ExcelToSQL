export const dateFormats=['mm/dd/yyyy','dd/mm/yyyy','yyyy-mm-dd','dd.mm.yyyy'] as const;
export type DateFormat=typeof dateFormats[number];
export type TimeFormat='12h'|'24h';
let options:{date_format:DateFormat;time_format:TimeFormat}={date_format:'mm/dd/yyyy',time_format:'12h'};
const listeners=new Set<()=>void>();
export const getDateOptions=()=>options;
export function subscribeDateOptions(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)}}
export function setDateOptions(date_format:DateFormat='mm/dd/yyyy',time_format:TimeFormat='12h'){
 if(options.date_format===date_format&&options.time_format===time_format)return;
 options={date_format,time_format};listeners.forEach(fn=>fn());
}
export function formatDate(value:unknown,format:DateFormat=options.date_format):string{
 if(value===null||value===undefined||value==='')return '—';
 const raw=String(value),match=/^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
 if(!match)return raw;
 const [,y,m,d]=match;
 return format==='mm/dd/yyyy'?m+'/'+d+'/'+y:format==='dd/mm/yyyy'?d+'/'+m+'/'+y:format==='dd.mm.yyyy'?d+'.'+m+'.'+y:y+'-'+m+'-'+d;
}
export function parseDate(value:string,format:DateFormat=options.date_format):string|null{
 if(!value)return '';
 let y:string,m:string,d:string;
 const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 if(iso)[,y,m,d]=iso;
 else{
  const pieces=value.split(format==='dd.mm.yyyy'?'.':'/');
  if(pieces.length!==3||!pieces.every(x=>/^\d+$/.test(x)))return null;
  if(format==='mm/dd/yyyy')[m,d,y]=pieces;else if(format==='dd/mm/yyyy'||format==='dd.mm.yyyy')[d,m,y]=pieces;else return null;
 }
 if(y.length!==4||Number(y)<1||Number(y)>9999||Number(m)<1||Number(m)>12||Number(d)<1)return null;
 const leap=Number(y)%4===0&&(Number(y)%100!==0||Number(y)%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(Number(d)>days[Number(m)-1])return null;
 return y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');
}
