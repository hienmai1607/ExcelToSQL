import type {RecipeDetails} from './recipe-levels';
import {quantity,multiply,divide,quantityDisplay} from './packaging-summary-model';
import {call,type Row} from './api';
export type NPDRow=Record<string,unknown>&{ID:number;RowVersion:string};
export type RecipeLine={Kind:'Raw'|'Seasoning';GradePath:string|null;IngredientID:number|null;RatioPct:string;LossPct:string;PriceID:number|null;PriceMode?:'Auto'|'Direct';IngredientNote?:string;Note?:string;DirectPricePerKg?:string|null;DirectPriceCurrency?:'VND'|'USD'|null;DirectVendorID?:number|null};
export type RecipeQuote=NPDRow&{VendorName:string;CurrencyCode:string;UnitPrice:string;PriceUnit:string;USDPerLb:string;RequiredQuantity:string;BaseUoM:string;VendorID?:number;QuantityFrom?:string;QuantityTo?:string|null;EffectiveFrom?:string;EffectiveTo?:string|null;USDPerKg?:string;VNDPerKg?:string|null};
export type CalculatedLine=RecipeLine&{BufferRatio?:string;TotalQtyMT?:string;DirectPrice?:{IngredientCode:string;USDPerKg:string;VNDPerKg:string|null;USDPerLb:string};GradeNature?:string;Origin?:string;VendorName?:string;USDPerKg?:string;VNDPerKg?:string|null;Description?:string;SelectedPrice?:RecipeQuote;PriceIssue?:string;Candidates?:RecipeQuote[];Price?:RecipeQuote;EffectiveUSDPerLb?:string};
export type RecipeCalculation={RecipeDetails?:RecipeDetails;OrderEstimatedAwardedMT?:string;GradeSharePct?:string;LossWeightBasis?:string;CostFGUSDPerKg?:string|null;CostFGWithBufferUSDPerKg?:string|null;LossByValuePct?:string|null;SeasoningUSDPerKg?:string|null;SeasoningLossPct?:string;SeasoningCostBasis?:string;ExchangeRateVNDPerUSD?:string;EstimatedAwardedMT:string;RatioTotal:string;SeasoningRatio:string;SeasoningUSDPerLb:string;Lines:CalculatedLine[];Issues:string[];Warnings:string[]};
export type NPDLookups={units:Row[];vendors:Row[];currencies:Row[];ingredients:NPDRow[];members:Row[]};
export const npd={
 lookups:()=>call<NPDLookups>('/api/npd/lookups'),
 list:(resource:string,page=1,search='',size=25,filters?:Record<string,string>)=>call<{rows:NPDRow[];total:number}>(`/api/npd/${resource}?page=${page}&page_size=${size}&search=${encodeURIComponent(search)}${filters?'&'+new URLSearchParams(filters):''}`),
 save:(resource:string,body:unknown)=>call<{row:NPDRow}>(`/api/npd/${resource}`,body),
 sheet:(id:number)=>call<{row:NPDRow;lines:RecipeLine[];calculation:RecipeCalculation}>(`/api/npd/sheets/${id}`),
 request:(id:number)=>call<{row:NPDRow}>(`/api/npd/requests/${id}`),
 items:(id:number)=>call<{rows:NPDRow[]}>(`/api/npd/requests/${id}/items`),
};
export const emptyIngredient:Record<string,string>={Description:'',GradeNature:'',Origin:'',BaseUoMID:'',Status:'Active'};
export const emptyPrice:Record<string,string>={IngredientID:'',VendorID:'',CurrencyID:'',UnitPrice:'',PriceUoMID:'',QuantityFrom:'0',QuantityTo:'',EffectiveFrom:new Date().toISOString().slice(0,10),EffectiveTo:'',ExchangeRateToUSD:'',Status:'Active'};
export function masterBody(kind:string,values:Record<string,string>,row?:NPDRow){
 const fields=kind==='ingredients'?emptyIngredient:emptyPrice;
 const result:Record<string,unknown>={...Object.fromEntries(Object.keys(fields).map(key=>[key,values[key]===undefined?fields[key]:values[key]]))};
 if(row)Object.assign(result,{ID:row.ID,RowVersion:row.RowVersion});
 for(const key of ['BaseUoMID','IngredientID','VendorID','CurrencyID','PriceUoMID'])if(key in result)result[key]=Number(result[key]);
 for(const key of ['QuantityTo','EffectiveTo','ExchangeRateToUSD'])if(result[key]==='')result[key]=null;
 return result;
}
export const seasoningLine=():RecipeLine=>({Kind:'Seasoning',GradePath:null,IngredientID:null,RatioPct:'0',LossPct:'0',PriceID:null});
export const recipeLines=(lines:CalculatedLine[]):RecipeLine[]=>lines.map(({Kind,GradePath,IngredientID,RatioPct,LossPct,PriceID,PriceMode,IngredientNote,Note,DirectPricePerKg,DirectPriceCurrency,DirectVendorID})=>({Kind,GradePath,IngredientID,RatioPct,LossPct,PriceID,PriceMode,IngredientNote,Note,DirectPricePerKg,DirectPriceCurrency,DirectVendorID}));


export function directPriceValues(line:RecipeLine,exchangeRate:string){
 if(line.DirectPricePerKg==null||!line.DirectPriceCurrency)return null;
 const value=quantity(line.DirectPricePerKg,true),rate=quantity(exchangeRate,true);
 const validRate=rate&&rate.n>0n?rate:null;
 const usd=value&&(line.DirectPriceCurrency==='USD'?value:validRate?divide(value,validRate):null);
 const vnd=value&&(line.DirectPriceCurrency==='VND'?value:validRate?multiply(value,validRate):null);
 const input=(amount:typeof value)=>amount?quantityDisplay(amount,6).replaceAll(',',''):'';
 return {USDPerKg:input(usd),VNDPerKg:input(vnd),USDPerLb:input(usd?multiply(usd,{n:45359237n,d:100000000n}):null)};
}

// Resolve defaults only for an unselected source; explicit manual prices and
// vendor selections remain user-owned when a sheet is reopened or recalculated.
export function defaultRecipePrices(lines:RecipeLine[],calculation:RecipeCalculation):RecipeLine[]{
 return lines.map((line,index)=>{
  if(line.Kind!=='Seasoning'||!line.IngredientID||line.PriceID||line.PriceMode==='Direct'||line.DirectPricePerKg!=null)return line;
  const priced=calculation.Lines[index];
  if(!priced)return line;
  const mode=priced.Price?'Auto':'Direct';
  return line.PriceMode===mode?line:{...line,PriceMode:mode};
 });
}


export function recipeRequestState(item:NPDRow){
 const approval=String(item.LatestSheetApprovalStatus??''),pending=approval==='Pending';
 const stage=pending?'Submitted':item.IsOpen===false?(item.ActiveSheetID?'Approved':'Closed'):approval==='Returned'?'Returned':String(item.Status??(item.PICUserID?'Assigned':'Open'));
 return {stage,pending,assignable:item.CanAssignPIC==null?item.IsOpen!==false&&item.IsLinked!==false&&!['Pending','Approved'].includes(approval):Boolean(item.CanAssignPIC)};
}

/** Sheet quantity uses the captured product share, not editable sheet ratios. */
export function recipeMT(row:Record<string,unknown>,lines:RecipeLine[]):number{
 const snapshot=typeof row.GradeSnapshot==='string'?JSON.parse(row.GradeSnapshot):row.GradeSnapshot;
 const captured=(snapshot as {items?:{ParentID:unknown;ID:unknown;RatioPct:unknown}[]})?.items??[];
 const retained=new Set(lines.filter(line=>line.Kind==='Raw').map(line=>line.GradePath));
 const share=captured.filter(g=>String(g.ParentID)==='0'&&retained.has('0/'+g.ID)).reduce((sum,g)=>sum+Number(g.RatioPct),0);
 return Number(row.AnnualUnit)*Number(row.EstPctAwarded)/100*Number(row.WeightGrams)/1000000*share/100;
}
