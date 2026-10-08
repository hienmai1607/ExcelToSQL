import type {Row} from './api';
import {quantity,add,multiply,divide,costDisplay,type Fraction,objectValue} from './packaging-summary-model';
import {responseOrderFields} from './packaging-orders';

export type TCBSelection={Path:string;PriceID?:number;PriceVersion?:string;ExpectedUSDPerLb?:string;DirectUSDPerLb?:string|null};
export type TCBInputs={Prices:TCBSelection[]}&Record<string,unknown>;
export type TCBGrade=Row&{Path:string;Proportion:string};
export const productFields=[
 ['RMRatio','RM Ratio (%)'],['SeasoningUSDPerLb','Seasoning/salt ($/lbs)'],
 ['SeasoningRatio','Seasoning/salt Ratio (%)'],['OilUSDPerLb','Oil ($/lbs)'],
 ['OilPct','Oil %'],['ProcessingUSDPerLb','Processing ($/lbs)']
] as const;
export const defaultInputs=():TCBInputs=>({Prices:[],RMRatio:'100',SeasoningUSDPerLb:null,SeasoningRatio:'0',OilUSDPerLb:null,OilPct:'0',ProcessingUSDPerLb:'0',LossProductPct:'0',PrimaryLossPct:'0',SecondaryLossPct:'0',TertiaryLossPct:'0',MixPrimaryLossPct:'0',MixSecondaryLossPct:'0',MixTertiaryLossPct:'0',PalletUSDPerEA:null});
const zero=()=>quantity('0',true)!;
const hundred=quantity('100')!;
export function costs(inputs:TCBInputs,grades:TCBGrade[],prices:Row[]){
 let rm:Fraction|null=grades.length?zero():null;
 for(const leaf of grades){
  const selected=inputs.Prices.find(p=>p.Path===leaf.Path);
  const price=prices.find(p=>p.PriceID===selected?.PriceID&&p.PriceVersion===selected?.PriceVersion&&(selected?.ExpectedUSDPerLb===undefined||String(p.USDPerLb)===selected.ExpectedUSDPerLb)&&p.RawGradeID===leaf.RawGradeID&&(!leaf.RawMaterialID||p.MaterialID===leaf.RawMaterialID));
  const value=selected&&!selected.PriceID&&'DirectUSDPerLb' in selected?quantity(selected.DirectUSDPerLb,true):quantity(price?.USDPerLb,true),proportion=quantity(leaf.Proportion);
  rm=rm&&value&&proportion?add(rm,multiply(value,proportion)):null;
 }
 const ratios=['RMRatio','SeasoningRatio','OilPct'].map(k=>quantity(inputs[k],true));
 const total=ratios.reduce<Fraction>((a,b)=>add(a,b??zero()),zero());
 const balanced=ratios.every(Boolean)&&total.n===hundred.n&&total.d===hundred.d;
 const seasoning=quantity(inputs.SeasoningUSDPerLb,true),oil=quantity(inputs.OilUSDPerLb,true),processing=quantity(inputs.ProcessingUSDPerLb,true);
 let product:Fraction|null=processing&&balanced?processing:null;
 const values=[rm,seasoning,oil];
 for(let i=0;i<3;i++){
  const ratio=ratios[i];
  if(ratio?.n===0n)continue;
  product=product&&ratio&&values[i]?add(product,divide(multiply(values[i]!,ratio),hundred)):null;
 }
 return {rm,product,balanced};
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

export const manualCostInputs=(inputs:TCBInputs)=>Object.fromEntries([...productFields.map(([key])=>key),'PalletUSDPerEA'].map(key=>[key,inputs[key]]));
