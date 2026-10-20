import type {ButtonHTMLAttributes} from 'react';
import type {Session} from './api';
import {Icon} from './icons';
import {pageAccess} from './workspace-access';
import type {MasterEntity} from './master-config';

export type InlineMasterEntity=Exclude<MasterEntity,'prices'|'raw-prices'>|'customers'|'categories'|'packaging-dimensions'|'ports';
export const masterNames:Record<InlineMasterEntity,string>={ports:'Port of Entry',customers:'Customer',products:'Product',categories:'Category',materials:'Packaging Material',vendors:'Vendor',uoms:'UoM',pallets:'Pallet', 'raw-materials':'Raw Material','raw-grades':'Raw Grade','packaging-types':'Packaging Type','packaging-dimensions':'Packaging Dimension'};
export function canCreateMaster(session:Session|null,entity:InlineMasterEntity){
 if(!session||entity==='uoms')return false;
 if(session.is_admin)return true;
 if(entity==='ports')return false;
 const scope=entity==='customers'?'Customer':entity==='products'||entity==='categories'?'Product':entity.startsWith('raw-')?'RawMaterial':'Packaging';
 // Units are maintained through their standalone Admin-managed screen only.
 return session.scopes.includes(scope)&&pageAccess(session,entity,true)&&(entity!=='categories'||session.permissions?.categories==='edit');
}
export function AddMasterButton({entity,label,...props}:Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'> & {entity:InlineMasterEntity;label?:string}){
 return <button type="button" className="add-master-button" title={'Add new '+masterNames[entity]+' master'} aria-label={label||'Add new '+masterNames[entity]+' master'} {...props}><span className="add-master-symbol" aria-hidden="true"><Icon name="package"/><span>+</span></span></button>;
}
