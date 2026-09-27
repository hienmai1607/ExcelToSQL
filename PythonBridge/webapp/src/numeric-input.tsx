import {useState,type InputHTMLAttributes} from 'react';
import {numberDisplay} from './number-format';

// Keep raw decimal strings in state/payloads; grouping belongs only in the control.
export function NumericInput({field,value,onValueChange,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'> & {field:string;value:string;onValueChange:(value:string)=>void}){
 const [focused,setFocused]=useState(false),[edited,setEdited]=useState(false);
 const invalid=edited&&!!numericEntryError(field,value);
 const formatted=invalid?value:numberDisplay(field,value)??'';
 return <input {...props} type="text" inputMode="decimal" value={focused?(edited?value:formatted.replaceAll(',','')):formatted}
 aria-invalid={invalid||props['aria-invalid']||false}
 onFocus={e=>{setFocused(true);props.onFocus?.(e)}}
 onBlur={e=>{setFocused(false);props.onBlur?.(e)}}
 onChange={e=>{setEdited(true);const raw=e.target.value;
 // Only strip properly grouped commas; malformed grouping remains invalid.
 const clean=/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(raw)?raw.replaceAll(',',''):raw;
 onValueChange(clean);
 }}/>;
}
export function numericEntryError(field:string,value:string){
 if(!value)return '';
 const places=field==='UnitPrice'?2:3;
 if(!new RegExp('^\\d+(\\.\\d{0,'+places+'})?$').test(value))return 'Use a non-negative number with up to '+places+' decimal places.';
 return '';
}
