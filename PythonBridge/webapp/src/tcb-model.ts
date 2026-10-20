import type {Row} from './api';
import {quantity,add,multiply,divide,costDisplay,type Fraction,objectValue} from './packaging-summary-model';
import {responseOrderFields} from './packaging-orders';

export type TCBSelection={Path:string;PriceID?:number;PriceVersion?:string;ExpectedUSDPerLb?:string;DirectUSDPerLb?:string|null};
export type MaterialCost={Path:string}&Record<string,unknown>;
export type TCBInputs={Prices:TCBSelection[];MaterialCosts?:MaterialCost[]}&Record<string,unknown>;
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
export const defaultInputs=():TCBInputs=>({Prices:[],RMRatio:'100',SeasoningUSDPerLb:null,SeasoningRatio:'0',OilUSDPerLb:null,OilPct:'0',ProcessingUSDPerLb:'0',LossProductPct:'0',PrimaryLossPct:'0',SecondaryLossPct:'0',TertiaryLossPct:'0',MixPrimaryLossPct:'0',MixSecondaryLossPct:'0',MixTertiaryLossPct:'0',PalletUSDPerEA:null});
const zero=()=>quantity('0',true)!;
const hundred=quantity('100')!;
export function materialRecipe(inputs:TCBInputs,path:string):Record<string,unknown>{
 return inputs.MaterialCosts?.find(r=>r.Path===path)??inputs;
}
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
export function rawPrice(inputs:TCBInputs,leaf:TCBGrade,prices:Row[]){
 const selected=inputs.Prices.find(p=>p.Path===leaf.Path);
 const price=prices.find(p=>p.PriceID===selected?.PriceID&&p.PriceVersion===selected?.PriceVersion&&(selected?.ExpectedUSDPerLb===undefined||String(p.USDPerLb)===selected.ExpectedUSDPerLb)&&p.RawGradeID===leaf.RawGradeID&&(!leaf.RawMaterialID||p.MaterialID===leaf.RawMaterialID));
 return selected&&!selected.PriceID&&'DirectUSDPerLb' in selected?quantity(selected.DirectUSDPerLb,true):quantity(price?.USDPerLb,true);
}
export type CostGroup={Path:string;Grade:string;process:boolean;leaves:TCBGrade[];proportion:Fraction;rm:Fraction|null;product:Fraction|null;balanced:boolean};
export function costGroups(inputs:TCBInputs,grades:TCBGrade[],prices:Row[]):CostGroup[]{
 const groups=new Map<string,CostGroup>();
 for(const leaf of [...grades].sort(compareGradePaths)){
  const owner=leaf.ProcessPath===undefined?leaf.Path:leaf.ProcessPath as string|null,key=owner||leaf.Path;
  let group=groups.get(key);
  if(!group){group={Path:key,Grade:String(leaf.ProcessGrade??leaf.Grade),process:!!owner,leaves:[],proportion:zero(),rm:zero(),product:null,balanced:true};groups.set(key,group)}
  group.leaves.push(leaf);
  const share=quantity(leaf.Proportion)??zero(),price=rawPrice(inputs,leaf,prices);
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
 for(const group of groups){
  rm=rm&&group.rm?add(rm,multiply(group.rm,group.proportion)):null;
  product=product&&group.product?add(product,multiply(group.product,group.proportion)):null;
 }
 return {rm,product,balanced:groups.every(g=>g.balanced)};
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

export const manualCostInputs=(inputs:TCBInputs)=>({...Object.fromEntries(productFields.map(([key])=>key).map(key=>[key,inputs[key]])),MaterialCosts:inputs.MaterialCosts??[]});

export function palletizationValue(row:Row,inputs:TCBInputs):unknown{
 if(row.ParentItemID)return null;
 if('DefaultPalletUSDPerEA' in row)return row.DefaultPalletUSDPerEA;
 if('PalletPricingJSON' in row)return objectValue(row.PalletPricingJSON).UnitUSDPrice??null;
 return inputs.PalletUSDPerEA??null;
}
