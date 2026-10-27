import type {Row,Session} from './api';
import {pageAccess} from './workspace-access';

export function canAssignPackaging(session:Session){
 return (session.can_assign_packaging ?? (session.is_admin||session.scopes.includes('PackagingManager')))
  &&pageAccess(session,'requests',true);
}
export function canRespondPackaging(session:Session,row:Row){
 // Identity IDs are authoritative; legacy snapshots without IDs use the login.
 const owner=row.PICUserID!==null&&(session.user_id!==undefined&&row.PICUserID!==undefined
  ? Number(row.PICUserID)>0&&Number(row.PICUserID)===session.user_id
  : !!row.PIC&&String(row.PIC).toLowerCase()===session.username.toLowerCase());
 const review=String(row.ItemStage)==='Pending Review'&&(session.is_admin||canAssignPackaging(session)&&!owner);
 return (review||(session.is_admin||owner)&&['Assigned','Working','Returned'].includes(String(row.ItemStage)))
  &&(review||session.is_admin||session.scopes.includes('Packaging'))&&pageAccess(session,'requests',true);
}
