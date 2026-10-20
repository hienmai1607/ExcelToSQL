// SQL DATETIME2 audit values are UTC; display remains in the workspace Bangkok timezone.
import {formatDate,getDateOptions} from './date-format';
const displays={
 '12h':new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}),
 '24h':new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
};
export function timestamp(value:unknown):string|null {
 if(value===null||value===undefined||value==='')return null;
 const raw=String(value).trim(),normalized=raw.replace(' ','T').replace(/(\.\d{3})\d+/, '$1');
 const explicitZone=/([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
 const instant=new Date(explicitZone?normalized:normalized+'Z');
 if(Number.isNaN(instant.getTime()))return raw;
 const {time_format}=getDateOptions();
 const display=displays[time_format];
 const parts=Object.fromEntries(display.formatToParts(instant).map(p=>[p.type,p.value]));
 return formatDate(parts.year+'-'+parts.month+'-'+parts.day)+', '+parts.hour+':'+parts.minute+(parts.dayPeriod?' '+parts.dayPeriod.toUpperCase():'');
}
