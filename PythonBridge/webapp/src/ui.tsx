import {useEffect,useRef,useState,type ReactNode} from 'react';
import {text} from './api';
export function Badge({value}:{value:unknown}){return <span className={'badge '+String(value).toLowerCase().replaceAll(' ','-')}>{text(value)}</span>}
export function ErrorNote({value}:{value:string}){return value?<div className="notice error" role="alert">{value}</div>:null}
export function Pager({page,size,total,busy,onPage,onSize,unit='records'}:{page:number;size:number;total:number;busy:boolean;onPage:(n:number)=>void;onSize:(n:number)=>void;unit?:string}){
 const [input,setInput]=useState(String(size));
 useEffect(()=>setInput(String(size)),[size]);
 return <div className="pager"><span>{total.toLocaleString()} {unit} · Page {page} of {Math.max(1,Math.ceil(total/size))}</span><label>Per page <input aria-label="Rows per page" type="number" min="1" max="500" step="1" value={input} disabled={busy} onChange={e=>setInput(e.target.value)} onBlur={()=>{const n=Number(input);if(Number.isInteger(n)&&n>=1&&n<=500)onSize(n);else setInput(String(size))}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label><button disabled={busy||page<=1} onClick={()=>onPage(page-1)}>Previous</button><button disabled={busy||page*size>=total} onClick={()=>onPage(page+1)}>Next</button></div>
}

export function Modal({children,label,onClose,className='dialog',hidden=false}:{children:ReactNode;label:string;onClose:()=>void;className?:string;hidden?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=ref.current!;if(!hidden)node.showModal();else node.close();return()=>node.close()},[hidden]);
 return <dialog ref={ref} className={className} aria-label={label} onCancel={e=>{e.preventDefault();onClose()}}>{children}</dialog>
}
