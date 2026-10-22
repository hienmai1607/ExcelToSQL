import {useState,type ButtonHTMLAttributes} from 'react';
import type {Session,Row} from './api';
import {InlineMasterEdit} from './inline-master-edit';
import {Notification} from './ui';
import {Icon} from './icons';
import {pageAccess} from './workspace-access';
import type {MasterEntity} from './master-config';

export type InlineMasterEntity=Exclude<MasterEntity,'prices'>|'customers'|'categories'|'packaging-dimensions'|'ports';
export const masterNames:Record<InlineMasterEntity,string>={ports:'Port of Entry',customers:'Customer',products:'Product',categories:'Category',materials:'Packaging Material',vendors:'Vendor',uoms:'UoM',pallets:'Pallet', 'raw-materials':'Raw Material','raw-prices':'Raw material price','raw-grades':'Raw Grade','packaging-types':'Packaging Type','packaging-dimensions':'Packaging Dimension'};
export function canCreateMaster(session:Session|null,entity:InlineMasterEntity){
 if(!session||entity==='uoms')return false;
 if(session.is_admin)return true;
 if(entity==='ports')return session.permissions?.ports==='edit'&&(session.scopes.includes('Customer')||session.scopes.includes('Opportunity'));
 const scope=entity==='customers'?'Customer':entity==='products'||entity==='categories'?'Product':entity.startsWith('raw-')?'RawMaterial':'Packaging';
 // Units are maintained through their standalone Admin-managed screen only.
 return session.scopes.includes(scope)&&pageAccess(session,entity,true)&&(entity!=='categories'||session.permissions?.categories==='edit');
}
export function AddMasterButton({entity,label,selectedValue,onEdited,...props}:Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'> & {entity:InlineMasterEntity;label?:string;selectedValue?:string|number|null;onEdited?:(record:Row)=>void|Promise<void>}){
 const [editing,setEditing]=useState(false),[notice,setNotice]=useState(''),selected=String(selectedValue??''),edit=!!selected;
 const actionLabel=edit?(label?label.replace(/^Add new /,'Edit ').replace(/^New /,'Edit '):'Edit '+masterNames[entity]+' master'):label||'Add new '+masterNames[entity]+' master';
 const multiple=edit&&entity==='packaging-types'&&selected.includes(',');
 return <><button type="button" className="add-master-button" title={multiple?'Select a single master to edit':(edit?'Edit selected ':'Add new ')+masterNames[entity]+' master'} aria-label={actionLabel} {...props} disabled={props.disabled||multiple} onClick={event=>{if(edit)setEditing(true);else props.onClick?.(event)}}><span className="add-master-symbol" aria-hidden="true"><Icon name="package"/>{edit?<span className="edit-master-mark"><Icon name="edit"/></span>:<span>+</span>}</span></button>{editing&&<InlineMasterEdit entity={entity} selected={selected} onClose={()=>setEditing(false)} onSaved={records=>{setEditing(false);void (async()=>{try{if(records[0])await onEdited?.(records[0]);setNotice('Master updated.')}catch{setNotice('Master updated, but choices could not be refreshed. Reload choices before saving.')}})()}}/>}<Notification value={notice} severity={notice.includes('could not')?'warning':'success'} onDismiss={()=>setNotice('')}/></>;
}
