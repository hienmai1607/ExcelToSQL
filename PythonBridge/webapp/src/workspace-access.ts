import type {Session} from './api';
export const workspacePages:Record<string,string>={'grade-densities':'Grade Density Master',opportunities:'Opportunities',customers:'Customers',products:'Products',requests:'Packaging Requests',materials:'Packaging Material',prices:'Packaging Pricing','packaging-types':'Packaging Types','packaging-dimensions':'Packaging Dimensions',containers:'Container Type Master',pallets:'Pallet Master','raw-materials':'Raw Material','raw-prices':'Raw Pricing','raw-grades':'Raw Grade Master',categories:'Category Master','loss-processes':'Process Types','loss-defaults':'Loss Process Master',ports:'Ports of Entry',vendors:'Vendors',conversions:'Unit Conversions',uoms:'Units of Measure'};
export function pageAccess(session:Session,page:string,edit=false){
 if(page==='containers'&&!session.is_admin)return false;
 return session.is_admin||(!session.permissions?true:edit?session.permissions[page]==='edit':['display','edit'].includes(session.permissions[page]||'none'));
}
