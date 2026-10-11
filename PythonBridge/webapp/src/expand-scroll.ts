import type {SyntheticEvent} from 'react';

function revealEnd(target:HTMLElement){
 requestAnimationFrame(()=>{if(target.isConnected)target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'end',inline:'nearest'})});
}
export function scrollExpandedSection(event:SyntheticEvent<HTMLDetailsElement>){
 const section=event.currentTarget;
 if(event.target===section&&section.open)revealEnd(section);
}
export function scrollExpandedItem(button:HTMLElement){
 const item=button.closest('.opportunity-entry-row');
 requestAnimationFrame(()=>{
  const children=item?.parentElement?.querySelectorAll('.opportunity-entry-row');
  const index=children?Array.from(children).indexOf(item as Element):-1;
  let last=item as HTMLElement|null;
  if(children&&index>=0)for(let i=index+1;i<children.length&&children[i].classList.contains('opportunity-mix-child');i++)last=children[i] as HTMLElement;
  if(last)revealEnd(last);
 });
}

/** Resolve after React has committed the newly opened/added content. */
export function scrollRevealedContent(find:()=>HTMLElement|null){
 requestAnimationFrame(()=>{const target=find();if(target)revealEnd(target)});
}
export function scrollAddedRecord(button:HTMLElement){
 // The button moves below the newly committed record; reveal both, above Save.
 scrollRevealedContent(()=>button.isConnected?button:null);
}
