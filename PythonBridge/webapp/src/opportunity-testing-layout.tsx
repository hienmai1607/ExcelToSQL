export const entryTabs=[['product','Product Info'],['packaging','Packaging'],['palletization','Palletization'],['logistics','Logistics & Co-Man'],['financials','Financials']] as const;
export type EntryTab=typeof entryTabs[number][0];
export type EntrySummary={key:number;number:string;product:string;kind:string;parent?:number;weight:string;quantity:string;annual:string;packing:string;types:string;pallet:string;height:string;comments:string;container:string;loading:string;incoterm:string;port:string;shelf:string;design:string;interest:string;status:string};
const columns:Record<EntryTab,[keyof EntrySummary,string][]>={
 product:[['weight','Net weight (g)'],['quantity','Mix quantity'],['annual','Annual units']],
 packaging:[['packing','Packing way'],['types','Requested types']],
 palletization:[['pallet','Pallet size'],['height','Max height (mm)'],['comments','Special comments']],
 logistics:[['container','Container Type'],['loading','Loading request'],['incoterm','Incoterm'],['port','Port of Entry']],
 financials:[['shelf','Shelf price'],['design','Initial Design'],['interest','Interest %']],
};
export function OpportunityEntryTabs({tab,onChange}:{tab:EntryTab;onChange:(tab:EntryTab)=>void}){
 return <div className="opportunity-testing-tabs" role="tablist" aria-label="Opportunity sections">{entryTabs.map(([key,label],index)=><button type="button" role="tab" key={key} id={'entry-tab-'+key} aria-controls="entry-tab-panel" aria-selected={tab===key} tabIndex={tab===key?0:-1} onClick={()=>onChange(key)} onKeyDown={event=>{
  const next=event.key==='Home'?0:event.key==='End'?entryTabs.length-1:event.key==='ArrowRight'?(index+1)%entryTabs.length:event.key==='ArrowLeft'?(index+entryTabs.length-1)%entryTabs.length:null;
  if(next!==null){event.preventDefault();onChange(entryTabs[next][0]);(event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement|undefined)?.focus()}
 }}>{label}</button>)}</div>;
}
export function OpportunityItemSummary({items,tab,onEdit}:{items:EntrySummary[];tab:EntryTab;onEdit:(key:number)=>void}){
 return <div className="opportunity-testing-summary"><table aria-label="Opportunity item summary"><thead><tr><th>Item</th><th>Product</th>{columns[tab].map(([key,label])=><th key={key}>{label}</th>)}<th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{items.map(item=><tr key={item.key} className={item.parent?'testing-summary-child':'testing-summary-parent'}>
  <td>{item.number}</td><td><strong>{item.product||'Choose a product'}</strong><small>{item.kind}</small></td>{columns[tab].map(([key])=><td key={key} title={String(item[key]??'')}>{String(item[key]||'—')}</td>)}<td><span className="testing-status">{item.status}</span></td><td><button type="button" className="testing-edit-details" aria-label={'Edit details item '+item.number} onClick={()=>onEdit(item.key)}>Edit details</button></td>
 </tr>)}</tbody></table></div>;
}
