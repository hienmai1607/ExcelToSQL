// SQL DATETIME2 audit values are UTC, even when the API omits a timezone suffix.
const display = new Intl.DateTimeFormat('en-US', {
 timeZone:'Asia/Bangkok',day:'2-digit',month:'short',year:'numeric',
 hour:'2-digit',minute:'2-digit',hour12:true,
});
export function timestamp(value:unknown):string|null {
 if(value===null||value===undefined||value==='')return null;
 const raw=String(value).trim();
 const normalized=raw.replace(' ','T').replace(/(\.\d{3})\d+/, '$1');
 const explicitZone=/([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
 const instant=new Date(explicitZone?normalized:normalized+'Z');
 if(Number.isNaN(instant.getTime()))return raw;
 const parts=Object.fromEntries(display.formatToParts(instant).map(p=>[p.type,p.value]));
 return parts.day+' '+parts.month+' '+parts.year+', '+parts.hour+':'+parts.minute+' '+parts.dayPeriod.toUpperCase();
}
