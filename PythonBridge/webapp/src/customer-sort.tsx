import {columnLabels,type Column,type SortRule} from './profile';
import {IconButton} from './icons';
export const defaultSort:SortRule[]=[{column:'CustomerName',direction:'asc'}];
export function SortPanel({rules,onChange,onClose}:{rules:SortRule[];onChange:(v:SortRule[])=>void;onClose:()=>void}){
 const used=new Set(rules.map(r=>r.column)),available=(Object.keys(columnLabels) as Column[]).filter(c=>!used.has(c));
 function move(i:number,offset:number){const next=[...rules];[next[i],next[i+offset]]=[next[i+offset],next[i]];onChange(next)}
 return <aside className="layout-panel sort-panel" aria-label="Customer sort"><h2>Sort customers</h2><p>Top rule first. Applies to all matching records. Save your layout to remember this order.</p>
 {rules.map((rule,i)=><div className="sort-rule" key={rule.column}><span>{i+1}</span><label>Column<select aria-label={'Sort column '+(i+1)} value={rule.column} onChange={e=>onChange(rules.map((r,n)=>n===i?{...r,column:e.target.value as Column}:r))}>{[rule.column,...available].map(c=><option key={c} value={c}>{columnLabels[c]}</option>)}</select></label><label>Direction<select aria-label={'Sort direction '+(i+1)} value={rule.direction} onChange={e=>onChange(rules.map((r,n)=>n===i?{...r,direction:e.target.value as 'asc'|'desc'}:r))}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label><IconButton icon="up" label={'Raise sort priority '+(i+1)} disabled={i===0} onClick={()=>move(i,-1)}/><IconButton icon="down" label={'Lower sort priority '+(i+1)} disabled={i===rules.length-1} onClick={()=>move(i,1)}/><IconButton icon="close" label={'Remove sort '+(i+1)} onClick={()=>onChange(rules.filter((_,n)=>n!==i))}/></div>)}
 {!rules.length&&<p>Default record order (ID).</p>}
 <div className="actions"><button disabled={!available.length} onClick={()=>onChange([...rules,{column:available[0],direction:'asc'}])}>Add sort column</button><button onClick={()=>onChange(defaultSort)}>Reset sort</button><button onClick={onClose}>Close sort</button></div></aside>
}

