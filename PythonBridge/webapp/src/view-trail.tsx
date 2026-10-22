import {createContext,useContext,useLayoutEffect,useRef,type ReactNode} from 'react';

export const ViewTrailContext=createContext<string[]>([]);
const listNames:Record<string,string>={opportunities:'Opportunities',customers:'Customers',products:'Products',prices:'Packaging Pricing',materials:'Packaging Material',vendors:'Vendors','raw-prices':'Raw Pricing','raw-materials':'Raw Material','raw-grades':'Raw Grade Master','packaging-types':'Packaging Types','packaging-dimensions':'Packaging Dimensions','grade-densities':'Grade Density Master',categories:'Category Master',ports:'Ports of Entry','loss-processes':'Process Types','loss-defaults':'Loss Process Master',uoms:'Units of Measure',pallets:'Pallet Master',containers:'Container Type Master',requests:'Packaging Requests',conversions:'Unit Conversions'};
export function ViewTrailRoot({page,children}:{page:string;children:ReactNode}){
 return <ViewTrailContext.Provider value={[(listNames[page]||page)+' List']}>{children}</ViewTrailContext.Provider>;
}
export function viewLabel(label:string){
 const names:Record<string,string>={'New price':'Add new Pricing','New raw material price':'Add new Raw Pricing','New material':'Add new Packaging Material'};
 return names[label]||label.replace(/^New /,'Add new ').replace(/^Add new (.)/,(_,first:string)=>'Add new '+first.toUpperCase());
}
export function ViewTrail({path}:{path:string[]}){
 const ref=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const node=ref.current,dialog=node?.closest('dialog');if(!node||!dialog)return;
  const measure=()=>dialog.style.setProperty('--view-trail-height',node.getBoundingClientRect().height+'px');
  const observer=new ResizeObserver(measure);observer.observe(node);measure();
  return()=>{observer.disconnect();dialog.style.removeProperty('--view-trail-height')};
 },[]);
 return <nav ref={ref} className="view-trail" aria-label="Open views"><ol>{path.map((name,index)=><li key={index} aria-current={index===path.length-1?'location':undefined}><span title={name}>{name}</span></li>)}</ol></nav>;
}
