import type {Draft} from './opportunity-losses';
import {quantity,add,multiply,divide,objectValue,type Fraction} from './packaging-summary-model';

const zero=()=>quantity('0',true)!;
export function packingRate(root:Draft,children:Draft[]):Fraction|null{
 const entered=root.costingInputs.PackingUSDPerLb;
 if(entered!=null)return entered===''?zero():quantity(entered,true);
 const shipping=objectValue(root.row.ShipmentCostInfo);
 if(!root.mix)return quantity(shipping.PackingUSDPerLb??root.row.PackingUSDPerLb??'0',true);
 const capture=objectValue(root.row.ProductMixSnapshot).items;
 if(!children.length||Array.isArray(capture)&&capture.length!==children.length)return null;
 let total=zero(),cost=zero();
 for(const child of children){
  const matches=Array.isArray(capture)?capture.filter(c=>c.ProductID===child.row.ProductID):null;
  const count=quantity(matches?.length===1?matches[0].UnitQuantity??matches[0].MixUnitQuantity:matches?null:child.row.MixUnitQuantity);
  const weight=quantity(child.row.WeightGrams),own=objectValue('OwnShipmentCostInfo' in child.row?child.row.OwnShipmentCostInfo:child.row.ShipmentCostInfo);
  const rate=quantity(own.PackingUSDPerLb??'0',true);
  if(!count||!weight||!rate)return null;
  const mass=multiply(count,weight);total=add(total,mass);cost=add(cost,multiply(mass,rate));
 }
 return total.n>0n?divide(cost,total):null;
}
