import {Children,useEffect,useRef,useState,useId,type ReactNode,type HTMLAttributes} from 'react';
import {createPortal} from 'react-dom';
import {text} from './api';
import {Icon,IconButton} from './icons';
export function Badge({value}:{value:unknown}){return <span className={'badge '+String(value).toLowerCase().replaceAll(' ','-')}>{text(value)}</span>}
export function Notification({value,error=false,onDismiss}:{value:string;error?:boolean;onDismiss?:()=>void}){
 const ref=useRef<HTMLDivElement>(null),[dismissed,setDismissed]=useState(false);
 const dismissRef=useRef(onDismiss);dismissRef.current=onDismiss;
 const dismiss=()=>{setDismissed(true);dismissRef.current?.()};
 useEffect(()=>{setDismissed(false);if(!value)return;const frame=requestAnimationFrame(()=>ref.current?.showPopover?.());return()=>cancelAnimationFrame(frame)},[value]);
 useEffect(()=>{if(!value||error)return;const timer=window.setTimeout(dismiss,12000);return()=>window.clearTimeout(timer)},[value,error]);
 return value&&!dismissed?<div ref={ref} popover="manual" className={'floating-notification notice '+(error?'error':'success')} role={error?'alert':'status'}><span>{value}</span><IconButton icon="close" label="Dismiss notification" onClick={dismiss}/></div>:null;
}
export function ErrorNote({value}:{value:string}){return <Notification value={value} error/>}
export function InfoTip({text}:{text:string}){
 const trigger=useRef<HTMLSpanElement>(null),tip=useRef<HTMLSpanElement>(null),id=useId();
 const [open,setOpen]=useState(false);
 function position(){
  const node=trigger.current,popup=tip.current;if(!node||!popup)return;
  const anchor=node.getBoundingClientRect(),dialog=node.closest('dialog')?.getBoundingClientRect();
  const left=Math.max(8,dialog?dialog.left+8:8),right=Math.min(window.innerWidth-8,dialog?dialog.right-8:window.innerWidth-8);
  const top=Math.max(8,dialog?dialog.top+8:8),bottom=Math.min(window.innerHeight-8,dialog?dialog.bottom-8:window.innerHeight-8);
  popup.style.maxWidth=Math.max(1,Math.min(320,right-left))+'px';
  popup.style.maxHeight=Math.max(1,bottom-top)+'px';
  const box=popup.getBoundingClientRect();
  popup.style.left=Math.max(left,Math.min(anchor.left,right-box.width))+'px';
  const below=anchor.bottom+6;
  popup.style.top=Math.max(top,Math.min(below+box.height<=bottom?below:anchor.top-box.height-6,bottom-box.height))+'px';
 }
 function show(){tip.current?.showPopover();position();setOpen(true)}
 function hide(){tip.current?.hidePopover();setOpen(false)}
 useEffect(()=>{
  if(!open)return;
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true)};
 },[open]);
 return <span ref={trigger} className="info-tip" tabIndex={0} role="note" aria-label={text} aria-describedby={open?id:undefined}
  onMouseEnter={show} onMouseLeave={()=>{if(document.activeElement!==trigger.current)hide()}} onFocus={show} onBlur={hide}
  onClick={show} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();hide()}}}>
  <Icon name="info"/><span ref={tip} id={id} role="tooltip" popover="manual" className="info-tooltip">{text}</span>
 </span>
}
export function FieldLabel({children,help}:{children:ReactNode;help?:string}){return <span className="field-label"><span className="field-label-text">{children}</span>{help&&<InfoTip text={help}/>}</span>}
export function LayoutPanel({children,...props}:HTMLAttributes<HTMLElement>){
 const ref=useRef<HTMLElement>(null);useEffect(()=>{ref.current?.scrollIntoView({block:'nearest'})},[]);
 const parts=Children.toArray(children),footer=parts.pop();
 return <aside ref={ref} {...props}><div className="layout-panel-body">{parts}</div><div className="layout-panel-footer">{footer}</div></aside>;
}
export function ColumnOrder<T extends string>({columns,labels,onChange}:{columns:T[];labels:Record<T,string>;onChange:(columns:T[])=>void}){
 const [dragging,setDragging]=useState<T|null>(null);
 function move(from:T,to:T){if(from===to)return;const next=columns.filter(c=>c!==from);next.splice(columns.indexOf(to),0,from);onChange(next)}
 function step(index:number,offset:number){const next=[...columns];[next[index],next[index+offset]]=[next[index+offset],next[index]];onChange(next)}
 return <ol className="column-order" aria-label="Column order">{columns.map((column,index)=><li key={column} draggable onDragStart={e=>{setDragging(column);e.dataTransfer.setData('text/plain',column);e.dataTransfer.effectAllowed='move'}} onDragEnd={()=>setDragging(null)} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}} onDrop={e=>{e.preventDefault();const source=e.dataTransfer.getData('text/plain') as T;if(columns.includes(source))move(source,column);setDragging(null)}} className={dragging===column?'dragging':''}><span className="drag-handle" title="Drag to reorder"><Icon name="drag"/></span><span>{labels[column]}</span><IconButton icon="up" label={'Move '+labels[column]+' left'} disabled={index===0} onClick={()=>step(index,-1)}/><IconButton icon="down" label={'Move '+labels[column]+' right'} disabled={index===columns.length-1} onClick={()=>step(index,1)}/></li>)}</ol>;
}
export function PageSizeSetting({value,onChange}:{value:number;onChange:(size:number)=>void}){
 const [input,setInput]=useState(String(value));
 useEffect(()=>setInput(String(value)),[value]);
 const apply=()=>{const size=Number(input);if(Number.isInteger(size)&&size>=1&&size<=500)onChange(size);else setInput(String(value))};
 return <label className="page-size-setting">Records per page<input aria-label="Records per page" type="number" min="1" max="500" step="1" value={input} onChange={e=>setInput(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur()}}}/></label>;
}
export function Pager({page,size,total,hasMore=false,busy,onPage,onSize,unit='records'}:{page:number;size:number;total?:number;hasMore?:boolean;busy:boolean;onPage:(n:number)=>void;onSize:(n:number)=>void;unit?:string}){
 const [input,setInput]=useState(String(size));
 useEffect(()=>setInput(String(size)),[size]);
 return <div className="pager"><span>{total===undefined?'Page '+page:total.toLocaleString()+' '+unit+' · Page '+page+' of '+Math.max(1,Math.ceil(total/size))}</span><label>Per page <input aria-label="Rows per page" type="number" min="1" max="500" step="1" value={input} disabled={busy} onChange={e=>setInput(e.target.value)} onBlur={()=>{const n=Number(input);if(Number.isInteger(n)&&n>=1&&n<=500)onSize(n);else setInput(String(size))}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label><IconButton icon="left" label="Previous" disabled={busy||page<=1} onClick={()=>onPage(page-1)}/><IconButton icon="right" label="Next" disabled={busy||(total===undefined?!hasMore:page*size>=total)} onClick={()=>onPage(page+1)}/></div>
}

export function Modal({children,label,onClose,className='dialog',hidden=false}:{children:ReactNode;label:string;onClose:()=>void;className?:string;hidden?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=ref.current!;if(!hidden)node.showModal();else node.close();return()=>node.close()},[hidden]);
 // Escape disabled form fieldsets, but retain workspace styles and session locking.
 return createPortal(<dialog ref={ref} className={className} aria-label={label} onCancel={e=>{e.preventDefault();e.stopPropagation();onClose()}}>{children}</dialog>,document.querySelector('.app')||document.body)
}
