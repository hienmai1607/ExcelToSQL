import {useLayoutEffect,useState,type RefObject} from 'react';

type Connection={id:string;path:string;kind:'grade-material'|'material-pricing';d:string};
type Alignment={cardHeight?:number;connections?:Connection[];rows:Record<string,{top:number;pricingTop?:number;minHeight:number}>;height:number};
export function useGradeMaterialAlignment(ref:RefObject<HTMLDivElement|null>,signature:string,matchCards=false){
 const [layout,setLayout]=useState<Alignment>({rows:{},height:0});
 useLayoutEffect(()=>{
  const root=ref.current;if(!root)return;
  let frame=0,active=true,lastMeasurement='';
  function measure(){
   frame=0;if(!active)return;
   const list=root!.querySelector<HTMLElement>('.grade-material-list'),hierarchy=root!.querySelector<HTMLElement>('.grade-tree-hierarchy');
   if(!list||!hierarchy)return;
   const origin=list.getBoundingClientRect().top;
   const sources=new Map(Array.from(root!.querySelectorAll<HTMLElement>('[data-grade-path]')).map(n=>[n.dataset.gradePath!,n]));
   const rows:Alignment['rows']={};let height=Math.max(0,hierarchy.getBoundingClientRect().bottom-origin);
   const materials=new Map(Array.from(root!.querySelectorAll<HTMLElement>('[data-material-path]')).map(card=>[card.dataset.materialPath!,card]));
   const pricing=new Map(Array.from(root!.querySelectorAll<HTMLElement>('[data-pricing-path]')).map(card=>[card.dataset.pricingPath!,card]));
   const priceOrigin=root!.querySelector('.grade-pricing-list')?.getBoundingClientRect().top??origin;
   // Measure content rather than the shared min-height, so errors can grow and shrink all cards.
   const naturalHeight=(card:HTMLElement)=>{
    const box=card.getBoundingClientRect(),style=getComputedStyle(card);
    const bottom=Math.max(box.top,...Array.from(card.children).map(child=>child.getBoundingClientRect().bottom));
    return Math.ceil(bottom-box.top+parseFloat(style.paddingBottom)+parseFloat(style.borderBottomWidth));
   };
   const cardHeight=matchCards?Math.max(112,...Array.from(root!.querySelectorAll<HTMLElement>('[data-grade-path],[data-material-path],[data-pricing-path]')).map(naturalHeight)):0;
   const connections:Connection[]=[],rootBox=root!.getBoundingClientRect();
   function connect(path:string,from:HTMLElement|undefined,to:HTMLElement|undefined,kind:Connection['kind']){
    if(!from||!to)return;
    const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
    if(b.left<=a.right)return; // Stacked responsive panes do not have horizontal links.
    const round=(n:number)=>Math.round(n*100)/100;
    const x1=round(a.right-rootBox.left),x2=round(b.left-rootBox.left),y1=round(a.top+a.height/2-rootBox.top),y2=round(b.top+b.height/2-rootBox.top),mid=round((x1+x2)/2);
    connections.push({id:kind+':'+path,path,kind,d:'M '+x1+' '+y1+' H '+mid+' V '+y2+' H '+x2});
   }
   for(const [id,source] of sources){
    const material=materials.get(id)?.getBoundingClientRect(),price=pricing.get(id)?.getBoundingClientRect();
    if(!material&&!price)continue;
    const a=source.getBoundingClientRect(),topFor=(start:number,size:number)=>Math.max(0,Math.round((a.top+a.height/2-start-size/2)*100)/100);
    const top=topFor(origin,material?.height??0),pricingTop=topFor(priceOrigin,price?.height??0);
    rows[id]={top,...(price?{pricingTop}:{}),minHeight:matchCards?cardHeight:Math.ceil(Math.max(material?.height??0,price?.height??0))};
    height=Math.max(height,top+(material?.height??0),pricingTop+(price?.height??0));
    if(matchCards){
     connect(id,source,materials.get(id),'grade-material');
     connect(id,materials.get(id),pricing.get(id),'material-pricing');
    }
   }
   const next={rows,height:Math.ceil(height),...(matchCards?{cardHeight,connections}:{})};
   const measurement=JSON.stringify(next);
   if(measurement!==lastMeasurement){
    lastMeasurement=measurement;
    setLayout(old=>JSON.stringify(old)===measurement?old:next);
    // Position-only updates do not notify ResizeObserver. Settle connector endpoints after layout.
    schedule();
   }
  }
  function schedule(){if(!frame&&active)frame=requestAnimationFrame(measure)}
  const observer=new ResizeObserver(schedule);
  observer.observe(root);
  for(const node of root.querySelectorAll('[data-grade-path],[data-material-path],[data-pricing-path],.grade-tree-levels,.grade-material-section>h3,.grade-pricing-section>h3'))observer.observe(node);
  window.addEventListener('resize',schedule);measure();
  return()=>{active=false;observer.disconnect();window.removeEventListener('resize',schedule);if(frame)cancelAnimationFrame(frame)};
 },[ref,signature,matchCards]);
 return layout;
}
