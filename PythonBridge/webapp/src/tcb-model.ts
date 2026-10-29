import type {Row} from './api';
import {quantity,add,multiply,divide,costDisplay,type Fraction,objectValue,quantityDisplay} from './packaging-summary-model';
import {responseOrderFields} from './packaging-orders';
import type {GradeItem} from './product-grades';
import {processLossValue,type GradeLoss,type GradeLossResult} from './grade-process-loss';

export type TCBSelection={Path:string;PriceID?:number|null;PriceVersion?:string|null;ExpectedUSDPerLb?:string|null;DirectUSDPerLb?:string|null};
export type MaterialCost={Path:string}&Record<string,unknown>;
export type TCBInputs={Prices:TCBSelection[];MaterialCosts?:MaterialCost[];ProcessLosses?:GradeLoss[]|null;ProcessLossMode?:'Stages'|'GradePath';ProcessLossLayout?:'Local'|'Aligned';ProcessLossFormulas?:Record<string,string>;ProcessLossResults?:GradeLossResult[];ProcessLossWeight?:unknown}&Record<string,unknown>;
export type TCBGrade=Row&{Path:string;Proportion:string};
export function compareGradePaths(a:{Path:string},b:{Path:string}){
 const left=a.Path.split('/').map(Number),right=b.Path.split('/').map(Number);
 for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]-right[i];
 return left.length-right.length;
}
export const productFields=[
 ['RMRatio','RM Ratio (%)'],['SeasoningUSDPerLb','Seasoning/salt ($/lbs)'],
 ['SeasoningRatio','Seasoning/salt Ratio (%)'],['OilUSDPerLb','Oil ($/lbs)'],
 ['OilPct','Oil %'],['ProcessingUSDPerLb','Processing ($/lbs)']
] as const;
export const defaultInputs=():TCBInputs=>({Prices:[],RMRatio:'100',SeasoningUSDPerLb:null,SeasoningRatio:'0',OilUSDPerLb:null,OilPct:'0',ProcessingUSDPerLb:'0',LossProductPct:'0',PrimaryLossPct:'0',SecondaryLossPct:'0',TertiaryLossPct:'0',QuaternaryLossPct:'0',MixPrimaryLossPct:'0',MixSecondaryLossPct:'0',MixTertiaryLossPct:'0',PalletUSDPerEA:null});
const zero=()=>quantity('0',true)!;
const hundred=quantity('100')!;
export function materialRecipe(inputs:TCBInputs,path:string):Record<string,unknown>{
 const exact=inputs.MaterialCosts?.find(r=>r.Path===path);
 if(exact)return exact;
 const children=(inputs.MaterialCosts??[]).filter(r=>r.Path.startsWith(path+'/'));
 return children.length&&new Set(children.map(row=>JSON.stringify(productFields.map(([key])=>row[key]??inputs[key])))).size===1?children[0]:inputs;
}
/** Salt and oil take their share from the raw-material percentage. */
export function changeRecipe(values:Record<string,unknown>,field:string,value:unknown):Record<string,unknown>{
 const next={...values,[field]:value};
 if(field!=='SeasoningRatio'&&field!=='OilPct')return next;
 const salt=quantity(next.SeasoningRatio??'0',true),oil=quantity(next.OilPct??'0',true);
 if(!salt||!oil)return {...next,RMRatio:null};
 const total=add(salt,oil),remaining={n:100n*total.d-total.n,d:total.d};
 return {...next,RMRatio:remaining.n>=0n?quantityDisplay(remaining,6):null};
}
export const recipePath=(path:string)=>path.split('/').slice(0,2).join('/');
export function recipeCost(inputs:Record<string,unknown>,rm:Fraction|null){
 const ratios=['RMRatio','SeasoningRatio','OilPct'].map(k=>quantity(inputs[k],true));
 const total=ratios.reduce<Fraction>((a,b)=>add(a,b??zero()),zero());
 const balanced=ratios.every(Boolean)&&total.n===hundred.n&&total.d===hundred.d;
 let product=balanced?quantity(inputs.ProcessingUSDPerLb,true):null;
 const values=[rm,quantity(inputs.SeasoningUSDPerLb,true),quantity(inputs.OilUSDPerLb,true)];
 for(let i=0;i<3;i++){
  const ratio=ratios[i];if(ratio?.n===0n)continue;
  product=product&&ratio&&values[i]?add(product,divide(multiply(values[i]!,ratio),hundred)):null;
 }
 return {product,balanced};
}
export function matchesRawQuote(price:Row,selected:TCBSelection|undefined){
 if(selected?.PriceID==null||price.PriceID!==selected.PriceID||typeof price.PriceVersion!=='string'||!selected.PriceVersion||price.PriceVersion.toLowerCase()!==selected.PriceVersion.toLowerCase())return false;
 if(selected.ExpectedUSDPerLb==null)return true;
 const actual=quantity(price.USDPerLb,true),expected=quantity(selected.ExpectedUSDPerLb,true);
 return !!actual&&!!expected&&actual.n*expected.d===expected.n*actual.d;
}
export function rawPrice(inputs:TCBInputs,leaf:TCBGrade,prices:Row[]){
 const selected=inputs.Prices.find(p=>p.Path===leaf.Path);
 const price=prices.find(p=>matchesRawQuote(p,selected)&&p.RawGradeID===leaf.RawGradeID&&(!leaf.RawMaterialID||p.MaterialID===leaf.RawMaterialID));
 return selected&&!selected.PriceID&&'DirectUSDPerLb' in selected?quantity(selected.DirectUSDPerLb,true):quantity(price?.USDPerLb,true);
}
export type CostGroup={Path:string;Grade:string;process:boolean;leaves:TCBGrade[];proportion:Fraction;rm:Fraction|null;product:Fraction|null;balanced:boolean};
const leafProcessPaths=(leaf:TCBGrade):string[]=>typeof leaf.ProcessPaths==='string'?JSON.parse(leaf.ProcessPaths):Array.isArray(leaf.ProcessPaths)?leaf.ProcessPaths.map(String):leaf.ProcessPath===undefined?[leaf.Path]:leaf.ProcessPath?[String(leaf.ProcessPath)]:[];
function activeLossInputs(inputs:TCBInputs,grades:TCBGrade[]){
 if(inputs.ProcessLossLayout!=='Aligned')return inputs;
 const paths=new Set(['0',...grades.flatMap(leafProcessPaths)]);
 return {...inputs,ProcessLosses:inputs.ProcessLosses?.filter(r=>paths.has(r.Path))};
}
export function yieldAdjustedPrice(inputs:TCBInputs,leaf:TCBGrade,prices:Row[]){
 let raw=rawPrice(inputs,leaf,prices);
 const paths=leafProcessPaths(leaf);
 for(const path of inputs.ProcessLossMode==='GradePath'?[paths[0]??leaf.Path]:[...paths,'0']){const loss=processLossValue(inputs,path,inputs.ProcessLossMode==='GradePath'?paths:undefined);raw=raw&&loss?divide(raw,{n:100n*loss.d-loss.n,d:100n*loss.d}):null}
 return raw;


}
function effectiveGradeLoss(inputs:TCBInputs,leaf:TCBGrade):Fraction|null{
 const paths=leafProcessPaths(leaf);
 let surviving=quantity('1')!;
 for(const path of inputs.ProcessLossMode==='GradePath'?[paths[0]??leaf.Path]:[...paths,'0']){
  const loss=processLossValue(inputs,path,inputs.ProcessLossMode==='GradePath'?paths:undefined);
  if(!loss)return null;
  surviving=multiply(surviving,{n:100n*loss.d-loss.n,d:100n*loss.d});
 }
 return {n:100n*(surviving.d-surviving.n),d:surviving.d};
}
export function costGroups(inputs:TCBInputs,grades:TCBGrade[],prices:Row[]):CostGroup[]{
 inputs=activeLossInputs(inputs,grades);
 const groups=new Map<string,CostGroup>();
 for(const leaf of [...grades].sort(compareGradePaths)){
  const key=recipePath(leaf.Path),owner=key;
  let group=groups.get(key);
  if(!group){group={Path:key,Grade:String(leaf.ProcessGrade??leaf.Grade),process:!!owner,leaves:[],proportion:zero(),rm:zero(),product:null,balanced:true};groups.set(key,group)}
  group.leaves.push(leaf);
  const share=quantity(leaf.Proportion)??zero(),price=yieldAdjustedPrice(inputs,leaf,prices);
  group.proportion=add(group.proportion,share);
  group.rm=group.rm&&price?add(group.rm,multiply(price,share)):null;
 }
 return [...groups.values()].map(group=>{
  const rm=group.rm&&group.proportion.n>0n?divide(group.rm,group.proportion):null;
  const line=group.process?recipeCost(materialRecipe(inputs,group.Path),rm):{product:rm,balanced:true};
  return {...group,rm,...line};
 }).sort(compareGradePaths);
}
export function costs(inputs:TCBInputs,grades:TCBGrade[],prices:Row[]){
 const groups=costGroups(inputs,grades,prices);
 let rm:Fraction|null=groups.length?zero():null,product:Fraction|null=groups.length?zero():null;
 let rmWithoutLoss:Fraction|null=grades.length?zero():null;
 for(const leaf of grades){
  const raw=rawPrice(inputs,leaf,prices),share=quantity(leaf.Proportion);
  rmWithoutLoss=rmWithoutLoss&&raw&&share?add(rmWithoutLoss,multiply(raw,share)):null;
 }
 for(const group of groups){
  rm=rm&&group.rm?add(rm,multiply(group.rm,group.proportion)):null;
  product=product&&group.product?add(product,multiply(group.product,group.proportion)):null;
 }
 return {rmWithoutLoss,rm,product,balanced:groups.every(g=>g.balanced)};
}
export const money=(v:Fraction|null)=>v?costDisplay({amounts:{USD:v},complete:true,issues:[]}):'—';
export function packagingUSD(row:Row,index:number,opportunity:Row){
 if(index>=Number(row.ResponseLayerCount))return null;
 const field=responseOrderFields[index],price=quantity(row[field.price],true),currency=String(row[field.currency]||'');
 if(!price||!currency)return null;
 if(currency==='USD')return price;
 if(currency==='VND'){const rate=quantity(opportunity.ExchangeRateVNDPerUSD);return rate?divide(price,rate):null}
 if(currency===String(opportunity.CustomerCurrencyCode)){const rate=quantity(opportunity.ExchangeRateCustomerCurrencyPerUSD);return rate?divide(price,rate):null}
 const snapshot=objectValue(row[field.order+'LayerPricingSnapshot']);
 return quantity(snapshot.UnitUSDPrice??row[field.order+'PriceUSDPerUnit'],true);
}

export const manualCostInputs=(inputs:TCBInputs)=>({...Object.fromEntries(productFields.map(([key])=>key).map(key=>[key,inputs[key]])),MaterialCosts:inputs.MaterialCosts??[],...(Array.isArray(inputs.ProcessLosses)?{ProcessLosses:inputs.ProcessLosses,...(inputs.ProcessLossMode==='GradePath'?{ProcessLossMode:inputs.ProcessLossMode,...(inputs.ProcessLossLayout==='Aligned'?{ProcessLossLayout:inputs.ProcessLossLayout}:{}),ProcessLossFormulas:inputs.ProcessLossFormulas??{}}:{})}:{})});

export type RecipeRow={Path:string;Grade:string;RatioPct:string;depth:number;process:boolean;lossPct:Fraction|null;rmWithoutLoss:Fraction|null;rm:Fraction|null;product:Fraction|null;balanced:boolean};
export function recipeRows(inputs:TCBInputs,items:GradeItem[],grades:TCBGrade[],prices:Row[]):RecipeRow[]{
 inputs=activeLossInputs(inputs,grades);
 const result:RecipeRow[]=[];
 function visit(item:GradeItem,underProcess=false):RecipeRow{
  const path=item.ParentID+'/'+item.ID,children=items.filter(g=>g.ParentID===path),process=item.ParentID==='0';
  const rows=children.map(g=>visit(g,underProcess||process));
  let rmWithoutLoss:Fraction|null=zero(),rm:Fraction|null=zero(),product:Fraction|null=zero();
  if(rows.length){for(const row of rows){const ratio=quantity(row.RatioPct);rmWithoutLoss=rmWithoutLoss&&row.rmWithoutLoss&&ratio?add(rmWithoutLoss,divide(multiply(row.rmWithoutLoss,ratio),hundred)):null;rm=rm&&row.rm&&ratio?add(rm,divide(multiply(row.rm,ratio),hundred)):null;product=product&&row.product&&ratio?add(product,divide(multiply(row.product,ratio),hundred)):null}}
  else{const leaf=grades.find(g=>g.Path===path);rmWithoutLoss=leaf?rawPrice(inputs,leaf,prices):null;rm=leaf?yieldAdjustedPrice(inputs,leaf,prices):null;product=rm}
  const line=process?recipeCost(materialRecipe(inputs,path),rm):{product,balanced:true};
  const leaf=grades.find(g=>g.Path===path);
  const common=rows[0]?.lossPct;
  // A blend's effective loss must reconcile with its weighted RM prices, not an
  // arithmetic average of child percentages. Leaves retain their formula result.
  const implied=rows.length&&rmWithoutLoss&&rm&&rm.n>0n?{n:100n*(rm.n*rmWithoutLoss.d-rmWithoutLoss.n*rm.d),d:rm.n*rmWithoutLoss.d}:null;
  const lossPct=rows.length?(implied??(common&&rows.every(r=>r.lossPct&&r.lossPct.n*common.d===common.n*r.lossPct.d)?common:null)):leaf?effectiveGradeLoss(inputs,leaf):null;
  const row={Path:path,Grade:item.Grade,RatioPct:String(item.RatioPct),depth:path.split('/').length-2,process,lossPct,rmWithoutLoss,rm,...line};result.push(row);return row;
 }
 items.filter(g=>g.ParentID==='0').forEach(g=>visit(g));
 return result.sort(compareGradePaths);
}

export function palletizationValue(row:Row,inputs:TCBInputs):unknown{
 if(row.ParentItemID)return null;
 if('DefaultPalletUSDPerEA' in row)return row.DefaultPalletUSDPerEA;
 if('PalletPricingJSON' in row){
  const snapshot=objectValue(row.PalletPricingJSON);if(snapshot.UnitUSDPrice!=null)return snapshot.UnitUSDPrice;
  const price=quantity(snapshot.UnitPrice,true),currency=snapshot.CurrencyCode;
  if(currency==='USD')return snapshot.UnitPrice??null;
  const rate=quantity(currency==='VND'?row.ExchangeRateVNDPerUSD:currency&&currency===row.CustomerCurrencyCode?row.ExchangeRateCustomerCurrencyPerUSD:null);
  if(!price||!rate)return null;
  const value=divide(price,rate),scale=10n**24n,rounded=(value.n*scale+value.d/2n)/value.d;
  return (String(rounded/scale)+'.'+String(rounded%scale).padStart(24,'0')).replace(/0+$/,'').replace(/[.]$/,'');
 }
 return inputs.PalletUSDPerEA??null;
}
