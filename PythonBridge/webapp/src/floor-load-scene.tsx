import {useMemo} from 'react';
import {LoadScene} from './load-scene';
import {floorVisualization,sectionDescription,type FloorPosition,type Dimensions3D} from './load-visualization';
export function FloorLoadScene({positions,count,tiers,cartonHeight,bounds,label}:{positions:FloorPosition[];count:number;tiers?:number;cartonHeight:number;bounds:Dimensions3D;label:string}){
 const model=useMemo(()=>floorVisualization(positions,count,tiers??Math.floor(bounds.height/cartonHeight),cartonHeight,bounds),[positions,count,tiers,cartonHeight,bounds]);
 return <><LoadScene boxes={model.boxes} bounds={bounds} label={label} loadingDirection/>{model.error?<p className="load-warning" role="alert">{model.error}</p>:<div className="load-section-legend" aria-label="Load section counts">
  <small>Back wall → doors. Rows run along the length; cartons/row/layer run across the width.</small>
  <small><i className="load-detail-key"/>Detailed back section ({(model.cutMM/bounds.length*100).toFixed(1)}% of container length, aligned to complete rows): {sectionDescription(model.detailed)}.</small>
  <small><i className="load-group-key"/>Grouped remaining block: {sectionDescription(model.grouped)}.</small>
  <small>Total represented: {model.total.toLocaleString('en-US')} cartons. {model.grouped.envelope?'The grouped block is an enclosing envelope; gaps and the partial row are not drawn individually.':''}</small>
 </div>}</>;
}
