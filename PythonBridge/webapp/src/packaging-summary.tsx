import {useEffect,useState} from 'react';
import {api,type Row} from './api';
import {Modal,FieldLabel} from './ui';
import {IconButton as ButtonIcon} from './icons';
import {dimensionDisplay} from './response-dimensions';
import {decimalDisplay} from './number-format';
import {allowedContainerTypes,parseContainerProfiles,containerTypes} from './container-loading';
import {loadSections} from './packing-way';
import {containerPlans,savedLoadPlan} from './load-plan-values';
import {opportunityCurrency,palletCost,containerFee,costDisplay,quantityDisplay,quantity,multiply,divide,scaleCost,objectValue,loadPackagingSummary,type Cost,type ProductSummary,type PackagingSummary as Summary,type SummaryRow,type OpportunityCurrency} from './packaging-summary-model';
import './packaging-summary.css';

const shown=(value:unknown,places=6)=>decimalDisplay(value,places)??'—';
const productName=(row:SummaryRow)=>String(row.ProductCode||'Product')+' · '+String(row.ProductName||'');
function Detail({label,value,help}:{label:string;value:unknown;help?:string}){return <tr><th scope="row"><FieldLabel help={help}>{label}</FieldLabel></th><td>{value==null||value===''?'—':String(value)}</td></tr>}
function Layers({product,title,exchange,focus=false,allocated,label='Total packaging / smallest unit'}:{product:ProductSummary;title:string;exchange:OpportunityCurrency;focus?:boolean;allocated?:Cost;label?:string}){
 const price=(cost:Cost)=>costDisplay(cost,exchange);
 return <section className={'summary-product'+(focus?' summary-focused':'')} aria-label={title}>
  <h3>{title}</h3>
  {!product.layers.length?<p className="summary-unavailable">No visible packaging response. Cost is incomplete.</p>:<ol className="summary-layer-chain">{product.layers.map((layer,index)=>{
   const dimensions=dimensionDisplay(layer.dimensions);
   return <li key={layer.order}>
    {index>0&&<div className="summary-edge">{quantityDisplay(layer.quantityFromPrevious)} × {product.layers[index-1].order} units</div>}
    <article className="summary-node" aria-label={title+' '+layer.order+' packaging'}>
     <h4>{layer.order} packaging</h4>
     <table className="summary-details" aria-label={layer.order+' packaging details'}><tbody><Detail label="Net weight (g)" value={shown(layer.weight)}/><Detail label="Gross weight (g)" value={quantityDisplay(layer.gross,3)}/><Detail label="Packaging Type" value={layer.type}/>
      <Detail label={dimensions.label} value={dimensions.value}/><Detail label="MOQ" value={shown(layer.moq)}/>
      <Detail label="Packaging cost / unit" value={price(layer.own)}/>
      <Detail label="Cumulative packaging cost / unit" value={price(layer.cumulative)} help="This layer's own packaging cost plus all contained lower-layer packaging costs. Pallet cost is excluded."/>
      <Detail label="Smallest units contained" value={quantityDisplay(layer.units)}/>{index===0&&<Detail label={label} value={price(allocated??product.ownPerUnit)} help="All allocated packaging costs, including higher packaging layers, per smallest product unit. Pallet cost is excluded."/>}
     </tbody></table>
    </article>
   </li>;
  })}</ol>}
 </section>;
}
function Logistics({summary,exchange,commercial}:{summary:Summary;exchange:OpportunityCurrency;commercial:SummaryRow}){
 const price=(cost:Cost)=>costDisplay(cost,exchange);
 const root=summary.root.row,load=loadSections(root.ConfigurationRequest),profiles=parseContainerProfiles(root.ContainerLoadProfiles),results=objectValue(root.ContainerLoadResults);
 const plans=containerPlans(root.ContainerPlansJSON),selected=savedLoadPlan(root.LoadPlanJSON);
 if(selected?.Code&&!plans[selected.Code])plans[selected.Code]=selected;
 const cartons=quantity(root.CartonsPerLayer),layers=quantity(root.LayersPerPallet,true),cartonsPerPallet=cartons&&layers?multiply(cartons,layers):null;
 const proposed=Array.isArray(root.ProposedContainerTypes)?root.ProposedContainerTypes:Object.values(profiles).some(p=>p.Proposal!=null)?Object.keys(profiles).filter(code=>profiles[code].Proposal==='1'):null;
 const containers=proposed==null?allowedContainerTypes(root.ResponseContainerFamily??root.ContainerRequest,root.ShipmentContainerSizeFT):containerTypes.filter(code=>proposed.includes(code));
 const branches=(floor:boolean)=><div className="summary-container-branches">{containers.map(kind=>{
  const plan=plans[kind],matchingPlan=plan?.Inputs.mode===(floor?'floor':'pallet')?plan:null;
  const profile=profiles[kind]??(root.SelectedContainerType===kind?{PalletsPerContainer:root.PalletsPerContainer==null?null:String(root.PalletsPerContainer),CartonsPerContainer:root.CalculatedCartonsPerContainer==null?null:String(root.CalculatedCartonsPerContainer)}:{});
  const result:SummaryRow={...(root.SelectedContainerType===kind?{LayersPerContainer:root.LayersPerContainer,NetWeightPerContainerKG:root.NetWeightPerContainerKG,NetWeightPerContainerFloorKG:root.NetWeightPerContainerFloorKG}:{}),...objectValue(results[kind])},cartonCount=floor?(profile.CartonsPerContainer??result.CalculatedCartonsPerContainer??(root.SelectedContainerType===kind?root.CalculatedCartonsPerContainer:null)):(result.CalculatedCartonsPerContainer??(root.SelectedContainerType===kind?root.CalculatedCartonsPerContainer:null));
  const weight=floor?(result.NetWeightPerContainerFloorKG??result.NetWeightPerContainerKG):result.NetWeightPerContainerKG;
  const complete=!!matchingPlan||profiles[kind]!=null||root.SelectedContainerType===kind;
  const displayedCartons=matchingPlan?.Result.cartons??cartonCount;
  const displayedPallets=matchingPlan?.Result.loaded_units??profile.PalletsPerContainer;
  return <article className="summary-node summary-container" key={kind} aria-label={'Container Load '+kind}>
   <h4>{kind}</h4>{!complete&&<small>Not configured</small>}
   <table className="summary-details" aria-label={kind+' '+(floor?'floor':'pallet')+' load details'}><tbody>{!floor&&<><Detail label="Pallet / Container" value={shown(displayedPallets)}/></>}
    <Detail label="Carton / Container" value={shown(displayedCartons)}/>
    <Detail label="Net weight / Container (kg)" value={shown(weight)}/>
    <Detail label="Packaging subtotal / Container" value={price(scaleCost(summary.root.total,quantity(displayedCartons,true)))}/>
    <Detail label="Fobbing fee / Container" value={price(containerFee(commercial,'FobbingUSDPerContainer',exchange))} help="Opportunity Fobbing fee per container in USD, converted using Opportunity exchange rates. Shown separately from packaging subtotals."/>
    <Detail label="Freight / Container" value={price(containerFee(commercial,'FreightUSDPerContainer',exchange))} help="Opportunity Freight per container in USD, converted using Opportunity exchange rates. Shown separately from packaging subtotals."/>
   </tbody></table>
  </article>;
 })}</div>;
 return <section className="summary-logistics" aria-label="Shipping configuration tree">
  <div className="summary-edge">Last layer → Shipping configurations</div>
  <div className={'summary-loading-paths'+(load.pallet&&load.floor?' summary-both-loads':'')}>
   {<section className="summary-loading-branch" aria-label="Palletization branch"><article className="summary-node summary-pallet">
    <h3>Palletization</h3><table className="summary-details" aria-label="Palletization details"><tbody><Detail label="Pallet size" value={root.ResponsePalletSize}/><Detail label="Pallet stacking" value={root.ResponsePalletStacking}/>
     <Detail label="Cartons / layer" value={shown(root.CartonsPerLayer)}/><Detail label="Layers / pallet" value={shown(root.LayersPerPallet)}/>
     <Detail label="Cartons / pallet" value={quantityDisplay(cartonsPerPallet)}/><Detail label="Pallet height (mm)" value={shown(root.PalletHeightMM)}/>
     <Detail label="Net weight / pallet (kg)" value={shown(root.NetWeightPerPalletKG)}/>
     <Detail label="Packaging subtotal / pallet" value={price(scaleCost(summary.root.total,cartonsPerPallet))}/>
     <Detail label="Pallet cost" value={root.PalletPricingJSON?price(palletCost(root,exchange)):'Not configured — excluded'} help="Saved pallet pricing per pallet, not today\'s master price. Captured USD is used when available; otherwise Opportunity exchange rates apply. Excluded from packaging subtotals."/>
    </tbody></table></article>{load.pallet&&<><div className="summary-edge">× Pallets / Container</div>{branches(false)}</>}</section>}
   {load.floor&&<section className="summary-loading-branch" aria-label="Container Load branch"><div className="summary-node summary-floor"><h3>Container Load</h3><p>× Last-layer cartons / Container</p></div><div className="summary-edge">Containers</div>{branches(true)}</section>}
  </div>
 </section>;
}
export function PackagingSummary({row,rows,opportunity,onClose}:{row:Row;rows:Row[];opportunity:Row;onClose:()=>void}){
 const root=row.ParentItemID?rows.find(item=>Number(item.ItemID)===Number(row.ParentItemID)):row;
 const exchange=opportunityCurrency(opportunity);
 const price=(cost:Cost)=>costDisplay(cost,exchange);
 const [summary,setSummary]=useState<Summary|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setError('');setSummary(null);
  if(!root){setError('The Mix Product parent is unavailable. Refresh Opportunities.');setLoading(false);return}
  loadPackagingSummary(Number(root.PackagingRequestID),Number(root.ItemID),api.requestItems,exchange).then(data=>{if(active)setSummary(data)}).catch(e=>{if(active)setError((e as Error).message)}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[root?.ItemID,root?.PackagingRequestID,exchange.currency,exchange.vndPerUSD,exchange.customerPerUSD]);
 return <Modal label="Packaging Summary" className="dialog packaging-summary-dialog" onClose={onClose}>
  <header className="customer-editor-heading"><div><h2>Packaging Summary</h2><p>{productName(root||row)} · {String(root?.PackagingRequestNumber||'No linked PCR')}</p></div><ButtonIcon icon="close" label="Close Packaging Summary" onClick={onClose}/></header>
  <div className="packaging-summary-body">
   {loading?<p role="status">Loading all linked PCR responses…</p>:error?<p role="alert">{error}</p>:summary&&<>
    <p className="summary-disclaimer">Read-only summary of saved PCR packaging and Opportunity commercial costs. Packaging subtotals exclude pallet cost, Fobbing and Freight; these are shown separately. Prices are shown in {exchange.currency||'the Opportunity customer currency'} using Opportunity exchange rates{exchange.currency&&exchange.currency!=='USD'?' with USD equivalents alongside':''}; monetary values are rounded to 2 decimals for display only.</p>
    {summary.issues.length>0&&<div className="summary-warnings" role="status"><strong>Cost summary is incomplete.</strong><ul>{summary.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>}
    <section className="summary-tree" aria-label="Packaging response tree">
     {summary.mix&&<><div className="summary-mix-children">{summary.children.map((child,index)=><div className="summary-child-branch" key={String(child.product.row.ProductID??index)}>
      <Layers exchange={exchange} product={child.product} title={productName(child.product.row)} focus={!!row.ParentItemID&&String(child.product.row.ProductID)===String(row.ProductID)} allocated={summary.units[index]?.total}/>
      <div className="summary-edge summary-mix-edge">{quantityDisplay(child.quantity)} × smallest product units <span>from captured Mix ratio</span>{child.quantity&&child.product.units&&<span>Equivalent to {quantityDisplay(divide(child.quantity,child.product.units))} × final child packages</span>}</div>
     </div>)}</div><div className="summary-mix-join" aria-hidden="true">↓</div></>}
     <Layers exchange={exchange} product={summary.root} title={(summary.mix?'Mix Product: ':'')+productName(summary.root.row)} allocated={summary.totalPerMix} label={summary.mix?'Total packaging / mix unit':'Total packaging / smallest unit'}/>
     {summary.root.layers.length>0&&<Logistics summary={summary} exchange={exchange} commercial={root||{}}/>}
    </section>
    <section className="summary-unit-costs" aria-label="Smallest unit packaging costs"><h3>Packaging cost / smallest product unit</h3>
     {summary.mix&&<p>Shared parent packaging is allocated equally per smallest unit: parent packaging cost / mix unit ÷ total captured child quantity.</p>}
     <div className="table-scroll"><table><thead><tr><th>Product</th>{summary.mix&&<th>Quantity / mix unit</th>}<th>Own packaging / unit</th>{summary.mix&&<th>Shared parent packaging / unit</th>}<th>Total packaging / unit</th></tr></thead>
      <tbody>{summary.units.map((unit,index)=><tr key={String(unit.row.ProductID??index)}><td>{productName(unit.row)}</td>{summary.mix&&<td>{quantityDisplay(unit.quantity)}</td>}<td>{price(unit.own)}</td>{summary.mix&&<td>{price(unit.shared)}</td>}<td>{price(unit.total)}</td></tr>)}</tbody>
     </table></div>
     {summary.mix&&<p className="summary-mix-total">All child + parent packaging / mix unit: <strong>{price(summary.totalPerMix)}</strong></p>}
    </section>
   </>}
  </div>
 </Modal>;
}
