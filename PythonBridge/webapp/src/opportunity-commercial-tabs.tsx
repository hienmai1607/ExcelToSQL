import type {Row} from './api';
import {FieldLabel} from './ui';
import {tcbInputIssues} from './tcb-validation';
import {GradeTree} from './grade-tree';
import {gradeError,type GradeItem,type RawGradeOption,type RawMaterialOption} from './product-grades';
import type {Draft} from './opportunity-losses';
export type CommercialProps={d:Draft;lookups:{rows:RawGradeOption[];materials:RawMaterialOption[]};busy:boolean;review:boolean;update:(id:number,fn:(d:Draft)=>Draft)=>void;changeGrades:(id:number,fn:(items:GradeItem[])=>GradeItem[])=>void;loadPrices:(d:Draft)=>void};
export function ItemGradeEditor({d,lookups,busy,review,changeGrades}:CommercialProps){
 const id=Number(d.row.ItemID),locked=d.readonly||d.gradeLocked;
 return <>
 {JSON.stringify(d.grades)!==d.baselineGrades&&gradeError(d.grades)&&<p className="tcb-field-error">{gradeError(d.grades)}</p>}
 {d.gradeLocked&&<p>Grades are captured by an active Packaging Request. Complete or cancel that request before changing the snapshot.</p>}
 <GradeTree items={d.grades} rawGrades={lookups.rows} rawMaterials={lookups.materials} busy={busy} readonly={locked} disabled={locked||busy||review}
 onAdd={parent=>changeGrades(id,items=>[...items,{ParentID:parent,ID:Math.max(0,...items.filter(i=>i.ParentID===parent).map(i=>i.ID))+1,Grade:'',RawGradeID:null,RawMaterialID:null,RatioPct:'100'}])}
 onRemove={item=>changeGrades(id,items=>{const path=item.ParentID+'/'+item.ID;return items.filter(i=>i!==item&&i.ParentID!==path&&!i.ParentID.startsWith(path+'/'))})}
 onChange={(item,patch)=>changeGrades(id,items=>{const path=item.ParentID+'/'+item.ID;return items.filter(i=>patch.RawGradeID===undefined||i===item||(i.ParentID!==path&&!i.ParentID.startsWith(path+'/'))).map(i=>i===item?{...i,...patch}:i)})}/>
 </>;
}
export function ItemRawPricing({d,busy,review,update,loadPrices}:CommercialProps){
 const id=Number(d.row.ItemID),ready=d.pricingGradeKey===JSON.stringify(d.grades),disabled=d.readonly||busy||review;
 if(!ready)return <button disabled={busy||review||!!gradeError(d.grades)} onClick={()=>loadPrices(d)}>Load pricing for current grades</button>;
 function select(path:string,value:Draft['selections'][number]|null){update(id,x=>({...x,selections:[...x.selections.filter(s=>s.Path!==path),...(value?[value]:[])]}))}
 return <div className="table-scroll"><table className="commercial-price-table"><thead><tr><th>Grades (summary)</th><th>Final proportion</th><th>Material / vendor / quantity tier</th><th>Direct price</th><th>USD/lb</th></tr></thead><tbody>{d.quoteGrades.map(leaf=>{
 const selected=d.selections.find(p=>p.Path===leaf.Path),manual=!!selected&&!selected.PriceID&&'DirectUSDPerLb' in selected,candidates=d.quotes.filter(p=>p.RawGradeID===leaf.RawGradeID&&(!leaf.RawMaterialID||p.MaterialID===leaf.RawMaterialID));
 const key=(p:Row)=>p.PriceID+':'+p.PriceVersion+':'+p.USDPerLb;
 const value=selected&&!manual?selected.PriceID+':'+selected.PriceVersion+':'+(selected.ExpectedUSDPerLb??candidates.find(p=>p.PriceID===selected.PriceID&&p.PriceVersion===selected.PriceVersion)?.USDPerLb):'';
 const quote=candidates.find(p=>key(p)===value),error=disabled?'':tcbInputIssues(d).find(x=>x.field==='Price:'+leaf.Path)?.message,errorId='tcb-price-error-'+id+'-'+leaf.Path;
 return <tr key={leaf.Path}><td>{leaf.Path+' · '+leaf.Grade}</td><td>{Number(leaf.Proportion)*100}%</td><td><select aria-label={'Raw price item '+id+' grade '+leaf.Path} disabled={disabled||manual} value={value} onChange={e=>{
 const p=candidates.find(p=>key(p)===e.target.value);select(leaf.Path,p?{Path:leaf.Path,PriceID:Number(p.PriceID),PriceVersion:String(p.PriceVersion),ExpectedUSDPerLb:String(p.USDPerLb)}:null);
 }}><option value="">Choose existing material price</option>{selected&&!manual&&!quote&&<option value={value}>Saved quote is unavailable; select a current price</option>}{candidates.map(p=><option key={key(p)} value={key(p)} disabled={p.USDPerLb==null}>{p.MaterialCode+' · '+(p.VendorName||'No vendor')+' · '+p.QuantityFrom+'–'+(p.QuantityTo??'∞')+' '+p.PriceBasis+' · '+p.USDPerLb+' USD/lb'}</option>)}</select></td>
 <td><label className="direct-grade-price"><FieldLabel help="Opportunity-only USD/lb price. Does not change the pricing master. Uncheck to choose a master quote."><input type="checkbox" aria-label={'Direct price item '+id+' grade '+leaf.Path} checked={manual} disabled={disabled} onChange={e=>select(leaf.Path,e.target.checked?{Path:leaf.Path,DirectUSDPerLb:null}:null)}/></FieldLabel></label></td>
 <td data-tcb-field={'Price:'+leaf.Path}>{manual?<input aria-label={'Direct USD/lb item '+id+' grade '+leaf.Path} aria-invalid={!!error} aria-describedby={error?errorId:undefined} type="number" min="0" step="0.000001" value={selected?.DirectUSDPerLb??''} disabled={disabled} onChange={e=>select(leaf.Path,{Path:leaf.Path,DirectUSDPerLb:e.target.value===''?null:e.target.value})}/>:quote?Number(quote.USDPerLb).toFixed(2)+' USD':'—'}{error&&<small id={errorId} className="tcb-field-error">{error}</small>}</td></tr>;
 })}</tbody></table>{!d.quoteGrades.length&&<p>Maintain Nuts Grades before selecting raw prices.</p>}</div>;
}
