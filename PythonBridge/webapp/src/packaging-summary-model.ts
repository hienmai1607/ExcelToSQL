/** Read-only roll-up of one PCR. Never reads today's Material/Pallet Master prices. */
import type {Row} from './api';
import {decimalDisplay} from './number-format';
import {responseOrderFields} from './packaging-orders';
import {capturedDimensions} from './response-dimensions';

export type Fraction={n:bigint;d:bigint};
export type Cost={amounts:Record<string,Fraction>;complete:boolean;issues:string[]};
export type SummaryRow=Record<string,unknown>;
export type OpportunityCurrency={currency:string;vndPerUSD:unknown;customerPerUSD:unknown};
export function opportunityCurrency(row:SummaryRow):OpportunityCurrency{return {currency:String(row.CustomerCurrencyCode??'').trim().toUpperCase(),vndPerUSD:row.ExchangeRateVNDPerUSD,customerPerUSD:row.ExchangeRateCustomerCurrencyPerUSD}}
const one:Fraction={n:1n,d:1n};
const zero:Fraction={n:0n,d:1n};
function fraction(n:bigint,d:bigint):Fraction{
 let a=n,b=d;while(b){const remainder=a%b;a=b;b=remainder}const divisor=a||1n;
 return {n:n/divisor,d:d/divisor};
}
export function quantity(value:unknown,allowZero=false):Fraction|null{
 const scientific=/^((?:\d{1,40}(?:\.\d{0,40})?|\.\d{1,40}))[eE]([+-]?\d{1,3})$/.exec(String(value??''));
 if(scientific){const exponent=Number(scientific[2]),base=quantity(scientific[1],allowZero);if(!base||Math.abs(exponent)>40)return null;const power=10n**BigInt(Math.abs(exponent));return exponent>=0?fraction(base.n*power,base.d):fraction(base.n,base.d*power)}
 const match=/^(?:(\d{1,40})(?:\.(\d{0,40}))?|\.(\d{1,40}))$/.exec(String(value??''));
 if(!match)return null;
 const tail=match[2]||match[3]||'',n=BigInt((match[1]||'0')+tail);
 return n>0n||allowZero?fraction(n,10n**BigInt(tail.length)):null;
}
export const multiply=(a:Fraction,b:Fraction)=>fraction(a.n*b.n,a.d*b.d);
export const divide=(a:Fraction,b:Fraction)=>fraction(a.n*b.d,a.d*b.n);
export const add=(a:Fraction,b:Fraction)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
export function quantityDisplay(value:Fraction|null,places=9){
 if(!value)return '—';const scale=10n**BigInt(places),scaled=value.n*scale;
 const rounded=scaled/value.d+(scaled%value.d*2n>=value.d?1n:0n);
 if(rounded===0n&&value.n>0n)return '< '+(places?'0.'+'0'.repeat(places-1)+'1':'1');
 return decimalDisplay((rounded/scale)+'.'+(rounded%scale).toString().padStart(places,'0'),places)||'0';
}
export const emptyCost=():Cost=>({amounts:{},complete:true,issues:[]});
export const unknownCost=(issue:string):Cost=>({amounts:{},complete:false,issues:[issue]});
export function sumCosts(...costs:Cost[]):Cost{
 const result=emptyCost();
 for(const cost of costs){
  result.complete&&=cost.complete;result.issues.push(...cost.issues);
  for(const [currency,value] of Object.entries(cost.amounts))result.amounts[currency]=add(result.amounts[currency]||zero,value);
 }
 result.issues=[...new Set(result.issues)];return result;
}
export function scaleCost(cost:Cost,factor:Fraction|null):Cost{
 if(!factor)return unknownCost('Missing or invalid Packing Way quantity.');
 return {...cost,amounts:Object.fromEntries(Object.entries(cost.amounts).map(([currency,value])=>[currency,multiply(value,factor)]))};
}
export function costDisplay(cost:Cost,exchange?:OpportunityCurrency):string{
 if(!cost.complete)return 'Incomplete';
 const entries=Object.entries(cost.amounts).sort(([a],[b])=>a.localeCompare(b));
 const display=entries.map(([currency,value])=>{
  const scaled=value.n*100n,rounded=scaled/value.d+(scaled%value.d*2n>=value.d?1n:0n);
  return decimalDisplay((rounded/100n)+'.'+(rounded%100n).toString().padStart(2,'0'),2,true)+' '+currency;
 }).join(' + ')||'—';
 if(!exchange||exchange.currency==='USD'||!entries.length)return display;
 const rate=quantity(exchange.currency==='VND'?exchange.vndPerUSD:exchange.customerPerUSD);
 if(entries.length!==1||entries[0][0]!==exchange.currency||!rate)return display+' (USD unavailable)';
 // Convert the exact amount, not the rounded customer-currency display.
 const usd=divide(entries[0][1],rate);
 return display+' ('+costDisplay({amounts:{USD:usd},complete:true,issues:[]})+')';
}
function layerCost(row:SummaryRow,index:number,exchange?:OpportunityCurrency):Cost{
 const field=responseOrderFields[index],amount=quantity(row[field.price],true),currency=String(row[field.currency]??'').trim().toUpperCase();
 if(!row[field.type]||!amount||!currency)return unknownCost(field.order+' packaging type, price or currency is unavailable.');
 if(!exchange)return {amounts:{[currency]:amount},complete:true,issues:[]};
 const target=exchange.currency;
 if(!target)return unknownCost('The Opportunity customer currency is unavailable.');
 if(currency===target)return {amounts:{[target]:amount},complete:true,issues:[]};
 const vndRate=quantity(exchange.vndPerUSD);
 const usd=currency==='USD'?amount:currency==='VND'?(vndRate?divide(amount,vndRate):null):quantity(row[field.order+'PriceUSDPerUnit'],true);
 const targetRate=target==='USD'?one:target==='VND'?vndRate:quantity(exchange.customerPerUSD);
 if(!usd||!targetRate)return unknownCost(field.order+' packaging cannot be converted to '+target+': Opportunity exchange rate or saved USD price is unavailable.');
 return {amounts:{[target]:multiply(usd,targetRate)},complete:true,issues:[]};
}
export function objectValue(value:unknown):SummaryRow{
 try{const result=typeof value==='string'?JSON.parse(value):value;return result&&typeof result==='object'&&!Array.isArray(result)?result as SummaryRow:{}}catch{return {}}
}
function unitCount(raw:unknown){const result=quantity(raw);return result&&result.d===1n?result:null}
export type PackagingLayer={order:string;type:string;weight:unknown;moq:unknown;dimensions:ReturnType<typeof capturedDimensions>;own:Cost;cumulative:Cost;units:Fraction|null;quantityFromPrevious:Fraction|null};
export type ProductSummary={row:SummaryRow;layers:PackagingLayer[];ownPerUnit:Cost;total:Cost;units:Fraction|null};
export function productSummary(row:SummaryRow,base=emptyCost(),exchange?:OpportunityCurrency):ProductSummary{
 const count=Number(row.ResponseLayerCount);
 if(row.ItemStage==='Canceled'||![1,2,3].includes(count))return {row,layers:[],ownPerUnit:unknownCost('Packaging response is missing or not visible.'),total:unknownCost('Packaging response is missing or not visible.'),units:null};
 let units:Fraction|null=one,total=base,ownPerUnit=emptyCost();const layers:PackagingLayer[]=[];
 for(let index=0;index<count;index++){
  const field=responseOrderFields[index],factor=index?unitCount(row[index===1?'UnitsPerCarton':'UnitsPerTertiary']):one;
  if(index)units=units&&factor?multiply(units,factor):null;
  const own=layerCost(row,index,exchange);
  total=sumCosts(index?scaleCost(total,factor):total,own);
  ownPerUnit=sumCosts(ownPerUnit,scaleCost(own,units?divide(one,units):null));
  const capture=objectValue(objectValue(row.LayerDimensionCaptures)[field.order]);
  // Display only this PCR's active matching capture, never dimensions from another type.
  const dimensions=capture.PackagingTypeName===row[field.type]&&Array.isArray(capture.Dimensions)?capture.Dimensions as ReturnType<typeof capturedDimensions>:[];
  layers.push({order:field.order,type:String(row[field.type]||'—'),weight:row[field.order+'NetWeightGrams'],moq:row[field.moq],dimensions,own,cumulative:total,units,quantityFromPrevious:index?factor:null});
 }
 return {row,layers,ownPerUnit,total,units};
}
export type SmallestUnit={row:SummaryRow;quantity:Fraction|null;own:Cost;shared:Cost;total:Cost};
export type PackagingSummary={root:ProductSummary;children:{product:ProductSummary;quantity:Fraction|null}[];units:SmallestUnit[];issues:string[];mix:boolean;totalPerMix:Cost};
export function buildPackagingSummary(root:SummaryRow,rows:SummaryRow[],exchange?:OpportunityCurrency):PackagingSummary{
 const snapshot=objectValue(root.ProductMixSnapshot),items=Array.isArray(snapshot.items)?snapshot.items as SummaryRow[]:[];
 const mix=!!root.IsMixParent||items.length>0;
 if(!mix){const product=productSummary(root,emptyCost(),exchange);return {root:product,children:[],units:[{row:root,quantity:one,own:product.ownPerUnit,shared:emptyCost(),total:product.ownPerUnit}],issues:product.ownPerUnit.issues,mix:false,totalPerMix:product.ownPerUnit}}
 const children:{product:ProductSummary;quantity:Fraction|null}[]=[],issues:string[]=[],seen=new Set<string>();
 let count:Fraction|null=zero,childCosts=emptyCost();
 if(!items.length){count=null;childCosts=unknownCost('The PCR has no captured Mix Product composition.');issues.push(...childCosts.issues)}
 for(const item of items){
  const matches=rows.filter(row=>Number(row.ParentItemID)===Number(root.OpportunityItemID)&&String(row.ProductID)===String(item.ProductID)&&Number(row.RequestID)===Number(root.RequestID));
  const duplicate=seen.has(String(item.ProductID));seen.add(String(item.ProductID));
  const row=matches.length===1&&!duplicate?matches[0]:{...item,ProductName:item.ProductName,ResponseLayerCount:null};
  if(matches.length!==1||duplicate)issues.push('Missing or ambiguous child response: '+String(item.ProductCode||item.ProductID));
  const q=quantity(item.UnitQuantity??item.MixUnitQuantity),product=productSummary(row,emptyCost(),exchange);
  count=count&&q?add(count,q):null;
  childCosts=sumCosts(childCosts,scaleCost(product.ownPerUnit,q));children.push({product,quantity:q});
 }
 const parent=productSummary(root,childCosts,exchange),shared=count&&count.n>0n?scaleCost(parent.ownPerUnit,divide(one,count)):unknownCost('Mix quantities are unavailable.');
 const units=children.map(child=>({row:child.product.row,quantity:child.quantity,own:child.product.ownPerUnit,shared,total:sumCosts(child.product.ownPerUnit,shared)}));
 const totalPerMix=sumCosts(childCosts,parent.ownPerUnit);
 return {root:parent,children,units,issues:[...new Set([...issues,...totalPerMix.issues])],mix:true,totalPerMix};
}

/** Read every page of the linked PCR, even when its children are off screen. */
export async function loadPackagingSummary(requestID:number,rootOpportunityItemID:number,read:(id:number,page:number,size:number)=>Promise<{rows:Row[];total:number}>,exchange?:OpportunityCurrency):Promise<PackagingSummary>{
 if(!Number.isSafeInteger(requestID)||requestID<=0)throw new Error('No current PCR is linked to this product.');
 const rows:Row[]=[];let total=0;
 for(let page=1;page===1||rows.length<total;page++){
  const result=await read(requestID,page,200);
  if(page>1&&result.total!==total)throw new Error('PCR items changed while loading. Refresh and retry.');total=result.total;
  if(!Array.isArray(result.rows)||!Number.isSafeInteger(total)||total<0||result.rows.some(row=>Number(row.RequestID)!==requestID))throw new Error('Invalid linked PCR response. Refresh and retry.');
  if(result.rows.length!==Math.min(200,total-(page-1)*200))throw new Error('PCR items changed while loading. Refresh and retry.');
  rows.push(...result.rows);
 }
 if(new Set(rows.map(row=>Number(row.ItemID))).size!==rows.length)throw new Error('PCR items changed while loading. Refresh and retry.');
 const matches=rows.filter(row=>Number(row.OpportunityItemID)===rootOpportunityItemID);
 if(matches.length!==1)throw new Error('The linked PCR response was not found. Refresh Opportunities.');
 return buildPackagingSummary(matches[0],rows,exchange);
}
