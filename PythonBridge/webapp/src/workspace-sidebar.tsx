import {pageAccess} from './workspace-access';
import {Icon,type IconName} from './icons';
import {AppearanceControls} from './profile';
import type {Session} from './api';

type NavItem={key:string;label:string;icon:IconName;allowed:boolean};
export function WorkspaceSidebar({session,tab,onNavigate}:{session:Session;tab:string;onNavigate:(tab:string)=>void}){
 const has=(...scopes:string[])=>session.is_admin||scopes.some(scope=>session.scopes.includes(scope));
 const groups:{label:string;items:NavItem[]}[]=[
  {label:'Sales workspace',items:[
   {key:'opportunities',label:'Opportunities',icon:'opportunity',allowed:has('Opportunity')},
   {key:'customers',label:'Customers',icon:'customer',allowed:has('Customer')},
   {key:'products',label:'Products',icon:'package',allowed:has('Product')}]},
  {label:'Packaging',items:[
   {key:'requests',label:'Packaging Requests',icon:'package',allowed:has('Opportunity','Packaging','PackagingManager')},
   {key:'materials',label:'Packaging Material',icon:'package',allowed:has('Packaging','PackagingManager')},
   {key:'prices',label:'Packaging Pricing',icon:'price',allowed:has('Packaging','PackagingManager')},
   {key:'packaging-types',label:'Packaging Type Master',icon:'grade',allowed:has('Packaging','PackagingManager')},
   {key:'grade-densities',label:'Grade Density Master',icon:'grade',allowed:has('Packaging','PackagingManager')},
   {key:'packaging-dimensions',label:'Packaging Dimension Master',icon:'layout',allowed:has('Packaging','PackagingManager')},
   {key:'containers',label:'Container Type Master',icon:'package',allowed:session.is_admin}]},
  {label:'Raw materials',items:[
   {key:'raw-materials',label:'Raw Material',icon:'package',allowed:has('RawMaterial')},
   {key:'raw-prices',label:'Raw Pricing',icon:'price',allowed:has('RawMaterial')},
   {key:'raw-grades',label:'Raw Grade Master',icon:'grade',allowed:has('RawMaterial')}]},
{label:'Shared masters',items:[
   {key:'categories',label:'Category Master',icon:'grade',allowed:has('Product')},{key:'loss-processes',label:'Loss Master',icon:'calculator',allowed:has('Opportunity','Product')},
   {key:'ports',label:'Ports of Entry',icon:'customer',allowed:has('Opportunity','Customer')},
   {key:'vendors',label:'Vendors',icon:'customer',allowed:has('Packaging','PackagingManager')},
   {key:'conversions',label:'Unit Conversions',icon:'price',allowed:has('Packaging','PackagingManager','RawMaterial')},
   {key:'uoms',label:'Units of Measure',icon:'package',allowed:session.is_admin||!!session.permissions&&pageAccess(session,'uoms')}]}
 ,...(session.is_admin?[{label:'Administrator',items:[{key:'admin-roles',label:'User role',icon:'grade' as IconName,allowed:true},{key:'admin-users',label:'User master',icon:'customer' as IconName,allowed:true},{key:'admin-markets',label:'Market Master',icon:'package' as IconName,allowed:true},{key:'admin-currencies',label:'Currency Master',icon:'price' as IconName,allowed:true}]}]:[])
 ];
 const visibleGroups=groups.map(group=>({...group,items:group.items.filter(item=>item.allowed&&(item.key.startsWith('admin-')||pageAccess(session,item.key)))})).filter(group=>group.items.length>0);
 return <aside className="sidebar">
  <div className="brand"><span className="logo">P</span><div>Presales PL3.0<small>Commercial workspace</small></div></div>
  <nav aria-label="Workspace navigation">{visibleGroups.map(group=><section className="nav-group" aria-label={group.label} key={group.label}>
   <h2 className="nav-group-title">{group.label}</h2>
   {group.items.map(item=><button key={item.key} title={item.label} aria-label={item.label} aria-current={tab===item.key?'page':undefined} className={tab===item.key?'active':''} onClick={()=>onNavigate(item.key)}>
    <Icon name={item.icon}/><span className="nav-text">{item.key==='packaging-types'?'Packaging Types':item.key==='packaging-dimensions'?'Packaging Dimensions':item.label}</span>
   </button>)}
  </section>)}</nav>
  <div className="sidebar-account"><AppearanceControls/><div className="identity"><span className="avatar">{session.username.slice(0,1).toUpperCase()}</span><div>{session.username}<small>{session.scopes.join(' · ')}</small></div></div></div>
 </aside>;
}
