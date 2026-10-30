import type {Row} from './api';

export function PackagingPeople({item,showPIC=true}:{item:Row;showPIC?:boolean}){
 const pic=String(item.PIC||'Unassigned');
 const approver=String(item.ApprovedByName||'Not recorded');
 if(!showPIC&&item.ItemStage!=='Approved')return null;
 return <span className="item-review-people">
  {showPIC&&<span className="item-review-pic" title={'PIC: '+pic}>PIC: {pic}</span>}
  {item.ItemStage==='Approved'&&<span className="item-review-pic" title={'Approved by: '+approver}>Approved by: {approver}</span>}
 </span>;
}
