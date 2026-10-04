import {createContext,useContext,useRef,type ReactNode} from 'react';
import './column-widths.css';
export type ColumnWidths=Record<string,number>;
export const columnWidth=(widths:ColumnWidths|undefined,key:string)=>Math.max(80,Math.min(800,Math.round(widths?.[key]??(key==='_Actions'?110:180))));
const WidthContext=createContext<{disabled?:boolean;widths?:ColumnWidths;resize:(key:string,width:number)=>void}>({resize:()=>{}});
export function ResizableTable({columns,widths,onResize,disabled=false,leading=[],trailing=[],pinFirstColumn=false,children,...props}:{columns:string[];disabled?:boolean;widths?:ColumnWidths;onResize:(key:string,width:number)=>void;leading?:number[];trailing?:number[];pinFirstColumn?:boolean;children:ReactNode;'aria-label'?:string}){
 const sizes=[...leading,...columns.map(c=>columnWidth(widths,c)),...trailing];
 return <WidthContext.Provider value={{disabled,widths,resize:onResize}}><table {...props} className={'resizable-table'+(pinFirstColumn?' pin-first-column':'')} style={{width:sizes.reduce((sum,w)=>sum+w,0),tableLayout:'fixed'}}><colgroup>{sizes.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>{children}</table></WidthContext.Provider>;
}
export function ColumnResizer({column,label}:{column:string;label:string}){
 const {disabled,widths,resize}=useContext(WidthContext),width=columnWidth(widths,column);
 const drag=useRef<{x:number;width:number}|null>(null);
 const update=(w:number)=>resize(column,Math.max(80,Math.min(800,Math.round(w))));
 return <span className="column-resizer" role="separator" tabIndex={disabled?-1:0} aria-disabled={disabled} aria-label={'Resize '+label} aria-orientation="vertical" aria-valuemin={80} aria-valuemax={800} aria-valuenow={width}
 title="Drag to resize. Arrow keys adjust width. Save using Layout."
 onClick={e=>e.stopPropagation()}
 onPointerDown={e=>{if(disabled||e.button!==0)return;e.preventDefault();e.stopPropagation();drag.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId)}}
 onPointerMove={e=>{if(!disabled&&drag.current)update(drag.current.width+e.clientX-drag.current.x)}}
 onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}
 onPointerCancel={()=>{if(drag.current)update(drag.current.width);drag.current=null}}
 onLostPointerCapture={()=>{drag.current=null}}
 onDoubleClick={()=>{if(!disabled)update(columnWidth(undefined,column))}}
 onKeyDown={e=>{if(disabled)return;if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();update(e.key==='Home'?80:e.key==='End'?800:width+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?50:10))}}/>;
}
