import {useRef,useState,useEffect,useSyncExternalStore,type InputHTMLAttributes} from 'react';
import {formatDate,parseDate,getDateOptions,subscribeDateOptions} from './date-format';
export function DateInput({value,onValueChange,min,max,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'onChange'> & {value:string;onValueChange:(value:string)=>void}){
 const options=useSyncExternalStore(subscribeDateOptions,getDateOptions);
 const [draft,setDraft]=useState(value?formatDate(value,options.date_format):'');
 const picker=useRef<HTMLInputElement>(null);
 useEffect(()=>setDraft(value?formatDate(value,options.date_format):''),[value,options.date_format]);
 const label=props['aria-label']||props.name||'date';
 return <span className="date-field"><input {...props} type="text" placeholder={options.date_format} value={draft} onChange={event=>{const raw=event.target.value;setDraft(raw);onValueChange(parseDate(raw,options.date_format)??raw)}} aria-invalid={!!value&&!parseDate(String(value))||props['aria-invalid']||undefined}/><button type="button" className="date-picker-button" disabled={props.disabled||props.readOnly} aria-label={'Open calendar for '+label} onClick={()=>{try{picker.current?.showPicker()}catch{picker.current?.focus()}}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 5h16v16H4zM4 10h16M8 2v6m8-6v6"/></svg></button><input ref={picker} className="date-native-picker" type="date" tabIndex={-1} aria-hidden="true" min={min} max={max} value={/^\d{4}-\d{2}-\d{2}$/.test(value)?value:''} onChange={event=>onValueChange(event.target.value)}/></span>;
}
