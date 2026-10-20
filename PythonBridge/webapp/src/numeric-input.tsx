import {useState,type InputHTMLAttributes} from 'react';
import {numberDisplay} from './number-format';
import {palletCapacityKeys} from './pallet-capacities';

// Keep raw decimal strings in state/payloads; grouping belongs only in the control.
export function NumericInput({field,value,onValueChange,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'> & {field:string;value:string;onValueChange:(value:string)=>void}){
 const [focused,setFocused]=useState(false),[edited,setEdited]=useState(false);
 const invalid=edited&&!!numericEntryError(field,value);
 const formatted=invalid?value:numberDisplay(field,value)??'';
 return <input {...props} data-numeric-field={field} type="text" inputMode="decimal" value={focused?(edited?value:formatted.replaceAll(',','')):formatted}
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
 if(['SupplierD1','SupplierD2','SupplierD3','MaterialD1','MaterialD2','MaterialD3'].includes(field))return /^\d{1,12}(\.\d{0,6})?$/.test(value)&&Number(value)>0?'':'Use a positive measurement with up to 12 whole digits and 6 decimal places.';
 if(palletCapacityKeys.includes(field))return /^\d{1,10}$/.test(value)&&Number(value)<=2147483647?'':'Use a whole number from 0 to 2,147,483,647, or leave blank.';
 if(field==='HeightMM')return /^\d{1,10}(\.\d{0,2})?$/.test(value)&&Number(value)>0?'':'Use a positive height in mm with up to 2 decimal places.';
 if(field==='ResponseMaxPalletHeightMM')return /^\d{1,9}$/.test(value)&&Number(value)>=1?'':'Use a positive whole number of millimeters up to 999,999,999.';
 if(['UnitsPerCarton','UnitsPerTertiary','CartonsPerLayer','LayersPerPallet','LayersPerContainer','PalletsPerContainer','CartonsPerContainerFloor','CartonsPerContainer'].includes(field))return /^\d{1,10}$/.test(value)&&Number(value)>=1&&Number(value)<=2147483647?'':'Use a positive whole number up to 2,147,483,647.';
 if(field==='ApplicableNetWeightGrams')return /^\d{1,12}(\.\d{0,6})?$/.test(value)?'':'Use non-negative grams with up to 6 decimals.';
 if(field==='NutDensity')return /^\d{1,12}(\.\d{0,6})?$/.test(value)&&Number(value)>0?'':'Use a positive density with up to 12 whole digits and 6 decimal places.';
 if(field==='Width'||field==='Length')return /^\d{1,8}(\.\d{0,4})?$/.test(value)&&Number(value)>0?'':'Use a positive number with up to 8 whole digits and 4 decimal places.';
 if(field==='ShelfLifeDays')return /^\d+$/.test(value)&&Number(value)<=2147483647?'':'Use whole days from 0 to 2,147,483,647.';
 if(field==='BaseFactor')return /^\d{1,12}(\.\d{0,12})?$/.test(value)&&Number(value)>0?'':'Use a positive factor with up to 12 decimal places.';
 const places=field==='TareWeight'||field==='Factor'||field==='ConversionFactor'?9:field==='UnitPrice'?2:3;
 if(!new RegExp('^\\d+(\\.\\d{0,'+places+'})?$').test(value))return 'Use a non-negative number with up to '+places+' decimal places.';
 return '';
}
