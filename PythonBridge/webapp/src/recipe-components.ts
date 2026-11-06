import {seasoningAllowed} from './recipe-scope';
import {quantity,add,quantityDisplay} from './packaging-summary-model';
import type {Draft} from './opportunity-losses';
import {materialRecipe,recipePath} from './tcb-model';
import {gradePath} from './grade-process';
import {processLossRows} from './grade-process-loss';
type RecipeContext=Pick<Draft,'row'|'steps'|'costingInputs'>&Partial<Pick<Draft,'grades'|'masters'|'formula'|'lossDefaults'>>;
export type RecipeComponent={ID:number;ComponentName:string;SystemKey:string;Status:string};
export type ComponentCost={SourceSheetID?:number|null;ManualFields?:('USDPerLb'|'RatioPct')[];CostBasis?:string;ComponentID:number;ComponentName:string;SystemKey:string;USDPerLb:unknown;RatioPct:unknown};
export const legacyComponentFields:Record<string,[string,string]>={Seasoning:['SeasoningUSDPerLb','SeasoningRatio'],Oil:['OilUSDPerLb','OilPct']};
function approvedPriceInput(value:unknown){
 const text=String(value??''),decimal=/^(\d+)\.(\d{7,100})$/.exec(text);
 // Recipe calculations retain 50 significant digits, beyond display parsing's limit.
 const amount=decimal?{n:BigInt(decimal[1]+decimal[2]),d:10n**BigInt(decimal[2].length)}:quantity(value,true);
 if(!amount||/^\d*\.?\d{0,6}$/.test(text))return value;
 // Match the server's DECIMAL(19,6) conversion, including half-even ties.
 const scaled=amount.n*1000000n,whole=scaled/amount.d,remainder=scaled%amount.d;
 const rounded=whole+(remainder*2n>amount.d||remainder*2n===amount.d&&whole%2n===1n?1n:0n);
 return (String(rounded/1000000n)+'.'+String(rounded%1000000n).padStart(6,'0')).replace(/0+$/,'').replace(/\.$/,'');
}
export function recipeOnly(values:Record<string,unknown>){return Object.fromEntries(['RMRatio','SeasoningCostBasis','SeasoningUSDPerLb','SeasoningRatio','OilUSDPerLb','OilPct','ProcessingUSDPerLb','Components'].filter(k=>k in values).map(k=>[k,values[k]]))}
export function componentValues(values:Record<string,unknown>,definitions:RecipeComponent[]):ComponentCost[]{
 if(Array.isArray(values.Components))return values.Components as ComponentCost[];
 return definitions.filter(c=>legacyComponentFields[c.SystemKey]).map(c=>{const [price,ratio]=legacyComponentFields[c.SystemKey];return {CostBasis:c.SystemKey==='Seasoning'?String(values.SeasoningCostBasis??'Ingredient'):'Ingredient',ComponentID:c.ID,ComponentName:c.ComponentName,SystemKey:c.SystemKey,USDPerLb:values[price]??null,RatioPct:values[ratio]??'0'}});
}
export function componentConfig(d:RecipeContext):{components:RecipeComponent[];mappings:{ProcessID:number;ComponentID:number}[]}{
 try{const config=JSON.parse(String(d.row.RecipeComponentsSnapshot));if(!config?.components)throw new Error();return config}catch{return {components:[{ID:1,SystemKey:'Seasoning',ComponentName:'Seasoning',Status:'Active'},{ID:2,SystemKey:'Oil',ComponentName:'Oil',Status:'Active'}],mappings:[]}}
}
export function applicableComponents(d:RecipeContext,path:string):Set<number>{
 const config=componentConfig(d),masters=new Set<number>();
 const stages=d.grades?.length?processLossRows({...d,grades:d.grades}):d.costingInputs.ProcessLosses;
 for(const stage of stages??[])if(stage.Path==='0'||stage.Path===path||stage.Path.startsWith(path+'/')||path.startsWith(stage.Path+'/'))for(const code of stage.Codes??[])if(code.MasterID)masters.add(code.MasterID);
 if(!stages)for(const step of d.steps)if(step.MasterID)masters.add(step.MasterID);
 const ids=new Set(config.mappings.filter(m=>masters.has(m.ProcessID)).map(m=>m.ComponentID));
 if(path!=='0'&&!seasoningAllowed(d.row,path))for(const c of config.components)if(c.SystemKey==='Seasoning')ids.delete(c.ID);
 return ids;
}
export function displayedComponents(d:RecipeContext):RecipeComponent[]{
 const config=componentConfig(d),ids=applicableComponents(d,'0');
 if(d.row.InactiveTCBVersion)for(const values of [d.costingInputs,...d.costingInputs.MaterialCosts??[]])for(const c of componentValues(values,config.components))if(Number(c.RatioPct)>0)ids.add(c.ComponentID);
 return config.components.filter(c=>ids.has(c.ID));
}
/** Keep visible components, their cost contributions and approved defaults in sync. */
export function syncRecipeComponents<T extends RecipeContext&Partial<Pick<Draft,'grades'|'quoteGrades'|'mix'>>>(d:T):T{
 const config=componentConfig(d);
 // Older captured contexts without a catalog retain their original calculation.
 if(!d.row.RecipeComponentsSnapshot||d.row.RecipeComponentsSnapshot==='null'||d.mix||d.row.InactiveTCBVersion)return d;
 const approved=d.row.NPDRecipeSnapshot?JSON.parse(String(d.row.NPDRecipeSnapshot)):null;
 const recipe=(path:string,values:Record<string,unknown>)=>{
  const allowed=applicableComponents(d,path),current=componentValues(values,config.components);
  if(path==='0'&&roots.size)for(const id of allowed)if([...roots].some(root=>!applicableComponents(d,root).has(id)))allowed.delete(id);
  const Components=config.components.filter(c=>allowed.has(c.ID)).map(c=>{
   const saved=current.find(v=>v.ComponentID===c.ID);
   const row:ComponentCost={ComponentID:c.ID,SystemKey:c.SystemKey,ComponentName:c.ComponentName,USDPerLb:saved?.USDPerLb??null,RatioPct:saved?.RatioPct??'0',CostBasis:saved?.CostBasis??'Ingredient'};
   if(c.SystemKey==='Seasoning'&&approved&&!approved.Inactive&&!approved.Stale){
    const manual=approved.SheetID&&saved?.SourceSheetID===approved.SheetID?saved?.ManualFields??[]:[];
    if(!manual.includes('USDPerLb'))row.USDPerLb=approvedPriceInput(approved.SeasoningUSDPerLb);
    if(!manual.includes('RatioPct'))row.RatioPct=approved.SeasoningRatio;
    row.CostBasis=approved.SeasoningCostBasis??'Ingredient';
    if(approved.SheetID){row.SourceSheetID=approved.SheetID;row.ManualFields=manual}
   }
   return row;
  });
  const result:Record<string,unknown>={...recipeOnly(values),Components,SeasoningRatio:'0',SeasoningUSDPerLb:null,SeasoningCostBasis:'Ingredient',OilPct:'0',OilUSDPerLb:null};
  const total=Components.reduce((a,c)=>add(a,quantity(c.RatioPct,true)??quantity('0',true)!),quantity('0',true)!);
  const remaining={n:100n*total.d-total.n,d:total.d};result.RMRatio=remaining.n>=0n?quantityDisplay(remaining,6).replaceAll(',',''):null;
  for(const c of Components){const fields=legacyComponentFields[c.SystemKey];if(fields)Object.assign(result,{[fields[0]]:c.USDPerLb,[fields[1]]:c.RatioPct,...(c.SystemKey==='Seasoning'?{SeasoningCostBasis:c.CostBasis}:{})})}
  return result;
 };
 const roots=new Set([...(d.grades??[]).filter(g=>g.ParentID==='0').map(gradePath),...(d.quoteGrades??[]).map(g=>recipePath(g.Path)),...(d.costingInputs.MaterialCosts??[]).map(r=>r.Path)]);
 return {...d,costingInputs:{...d.costingInputs,...recipe('0',d.costingInputs),MaterialCosts:[...roots].map(Path=>({Path,...recipe(Path,materialRecipe(d.costingInputs,Path))}))}};
}
export function changeComponent(values:Record<string,unknown>,component:RecipeComponent,field:'USDPerLb'|'RatioPct',value:unknown,definitions:RecipeComponent[]){
 const components=componentValues(values,definitions).map(c=>({...c}));let target=components.find(c=>c.ComponentID===component.ID);
 if(!target){target={ComponentID:component.ID,ComponentName:component.ComponentName,SystemKey:component.SystemKey,USDPerLb:null,RatioPct:'0'};components.push(target)}
 target[field]=value;
 if(target.SourceSheetID)target.ManualFields=[...new Set([...target.ManualFields??[],field])];
 const total=components.reduce((a,c)=>add(a,quantity(c.RatioPct,true)??quantity('0',true)!),quantity('0',true)!);
 const remaining={n:100n*total.d-total.n,d:total.d};
 const result={...recipeOnly(values),Components:components,RMRatio:remaining.n>=0n?quantityDisplay(remaining,6).replaceAll(',',''):null};
 for(const c of components){const fields=legacyComponentFields[c.SystemKey];if(fields)Object.assign(result,{[fields[0]]:c.USDPerLb,[fields[1]]:c.RatioPct})}
 return result;
}
