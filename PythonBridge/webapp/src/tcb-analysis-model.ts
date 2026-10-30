import {packingRate} from './tcb-packing';
import type {Row} from './api';
import {childOtherKeys} from './shipment-ownership';
import type {Draft} from './opportunity-losses';
import {costs,packagingUSD,palletizationValue} from './tcb-model';
import {quantity,add,multiply,divide,objectValue,type Fraction} from './packaging-summary-model';
import {lossTotals,lossError,processOptions} from './loss-processes';
import {allowedContainerTypes,containerTypes} from './container-loading';

export type AnalysisCell={value:Fraction|null;issues:string[]};
export type FinalBoxTotals=Record<'FOB'|'CFR'|'DDP',{usd:AnalysisCell;customer:AnalysisCell}>;
export type AnalysisColumn={id:number;label:string;cells:AnalysisCell[];cfrCustomer?:AnalysisCell;finalBox?:FinalBoxTotals};
export type AnalysisScenario={label:string;columns:AnalysisColumn[];currency:string};
export const analysisRows=[
 {label:'Product ($/unit)',help:'Product USD/lb ÷ 453.59237 × net weight in grams ÷ (1 − Product loss % ÷ 100). A 100% loss has no surviving yield.'},
 {label:'Self Packaging ($/unit)',help:'Sum of each own layer price ÷ (1 − that layer loss % / 100) ÷ its smallest-unit count.'},
 {label:'Parent Packaging ($/unit)',help:'Sum of Mix parent layer prices adjusted for each layer loss, normalized per mix unit, then divided by total smallest child units. Equal allocation per smallest child unit.'},
 {label:'Pallet & Floor cost ($/unit)',help:'Pallet: pallet price / total smallest units on a pallet. Floor: USD/MT x applicable net weight (g) / 1,000,000. Floor load and Both use floor cost only; pallet cost is excluded.'},
 {label:'Packing ($/unit)',help:'Packing USD/lb ÷ 453.59237 × this product’s net weight in grams.'},
 {label:'Initial Design ($/unit)',help:'Initial Design ÷ estimated awarded units. For Mix, awarded mix units × this child quantity.'},
 {label:'Fixed costs ($/unit)',help:'Other fixed costs ÷ estimated awarded units. For Mix, awarded mix units × this child quantity.'},
 {label:'Fobbing fee ($/unit)',help:'Fobbing USD/container ÷ total smallest units in that container and loading scenario.'},
 {label:'Interest ($/unit)',help:'Sum of Product through Fobbing x Interest % / 100 x Interest days / 360. Legacy months are converted to days using 30 days/month.'},
 {label:'Margin ($/unit)',help:'Choose percentage of costs through Interest, or Margin USD/lb x product net weight (g) / 453.59237.'},
 {label:'FOB ($/unit)',help:'Sum of all above, including Interest and Margin. USD.'},
 {label:'FOB (customer currency/unit)',help:'FOB USD × Opportunity customer-currency-per-USD rate (VND uses VND-per-USD).'}
,{label:'Freight ($/unit)',help:'Freight USD/container ÷ total smallest product units in one container.'},
 {label:'Duty ($/unit)',help:'(FOB USD/unit + Freight USD/unit) × Duty % / 100.'},
 {label:'Dest. Clearance ($/unit)',help:'Customer-currency clearance per container / customer-currency-per-USD rate / smallest units per container. Historical per-pallet and USD/container amounts retain their original basis.'},
 {label:'Dest. Haulage (Port-WH) ($/unit)',help:'Port–WH USD/container ÷ total smallest product units in one container.'},
 {label:'WH Cost (dest.) ($/unit)',help:'Destination WH USD/pallet ÷ total smallest product units on one pallet.'},
 {label:'Overage, Shortage & Damage ($/unit)',help:'Sum of FOB, Freight, Duty, Clearance, Haulage and destination WH cost × Damage % / 100.'},
 {label:'WH - Co-Man WH ($/unit)',help:'WH–Co-Man WH USD/pallet ÷ total smallest product units on one pallet.'},
 {label:'Co-Man Overhead ($/unit)',help:'Co-Man Overhead USD/pallet ÷ total smallest product units on one pallet.'},
 {label:'Freight to Customer ($/unit)',help:'Freight to Customer USD/pallet ÷ total smallest product units on one pallet.'},
 {label:'Spoilage Allowance ($/unit)',help:'(FOB + Logistics and Co-Man costs 1–9) ÷ (1 − combined fee ratios) × Spoilage Allowance ratio.'},
 {label:'Payment Term ($/unit)',help:'Same grossed-up base × Payment Term ratio.'},
 {label:'Co-Man fee ($/unit)',help:'Same grossed-up base × Co-Man fee ratio.'},
 {label:'Broker Fee ($/unit)',help:'Same grossed-up base × Broker Fee ratio.'},
 {label:'CFR ($/unit)',help:'FOB + Freight. A display subtotal, not added again to DDP.'},
 {label:'DDP ($/unit)',help:'FOB + Logistics and Co-Man costs 1–13. CFR is not added again.'},
 {label:'DDP (customer currency/unit)',help:'DDP USD × Opportunity customer-currency-per-USD rate (VND uses VND-per-USD).'}
] as const;
const zero=quantity('0',true)!,one=quantity('1')!,hundred=quantity('100')!,gramsPerLb=quantity('453.59237')!;
const good=(value:Fraction):AnalysisCell=>({value,issues:[]});
const missing=(issue:string):AnalysisCell=>({value:null,issues:[issue]});
const sum=(cells:AnalysisCell[]):AnalysisCell=>({value:cells.every(c=>c.value!==null)?cells.reduce((v,c)=>add(v,c.value!),zero):null,issues:[...new Set(cells.flatMap(c=>c.issues))]});
const scale=(cell:AnalysisCell,factor:Fraction|null,issue:string):AnalysisCell=>factor?{...cell,value:cell.value?multiply(cell.value,factor):null}:missing(issue);
function optional(value:unknown,label:string){
 if(value===undefined||value===null||value==='')return good(zero);
 const parsed=quantity(value,true);return parsed?good(parsed):missing('Invalid '+label+'.');
}
function perCount(cell:AnalysisCell,count:Fraction|null,issue:string){
 if(cell.value?.n===0n)return cell;
 return count&&count.n>0n?scale(cell,divide(one,count),issue):{value:null,issues:[...cell.issues,issue]};
}
function pct(cell:AnalysisCell,label:string){
 return cell.value&&cell.value.n<=100n*cell.value.d?scale(cell,divide(one,hundred),label):missing('Invalid '+label+'.');
}
export function productLossValue(d:Draft,tested?:string):Fraction|null{
 if(Array.isArray(d.costingInputs.ProcessLosses))return zero;
 if(lossError(d.steps,processOptions(d.mix,d.layers,Number(d.row.PackagingLayerStart)||1)))return null;
 if(!d.formula)return lossTotals(d.steps).LossProductPct;
 if(tested!==undefined)return quantity(tested,true);
 const previous=JSON.parse(d.baseline);
 return previous.formula===d.formula&&JSON.stringify(previous.steps)===JSON.stringify(d.steps)?quantity(d.costingInputs.LossProductPct,true):null;
}
function unitsPerFinal(row:Row){
 const count=Number(row.ResponseLayerCount);
 if(![1,2,3,4].includes(count))return null;
 let units=one;
 for(let i=1;i<count;i++){const next=quantity(row[['UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary'][i-1]]);if(!next||next.d!==1n)return null;units=multiply(units,next)}
 return units;
}
function packaging(d:Draft,owner:Row):AnalysisCell{
 const count=Number(d.row.ResponseLayerCount);
 if(![1,2,3,4].includes(count))return missing('No visible packaging response for '+d.row.ProductCode+'.');
 const steps=d.steps.filter(s=>s.ProcessType.endsWith('Packaging'));
 const error=lossError(steps,processOptions(d.mix,count,Number(d.row.PackagingLayerStart)||1));
 if(error)return missing(error);
 const losses=lossTotals(steps);
 let units:Fraction|null=one;const cells:AnalysisCell[]=[];
 for(let i=0;i<count;i++){
  if(i){const next=quantity(d.row[['UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary'][i-1]]);units=units&&next&&next.d===1n?multiply(units,next):null}
  const price=packagingUSD(d.row,i,owner);
  const field=((d.mix?'Mix':'')+['Primary','Secondary','Tertiary','Quaternary'][i]+'LossPct') as keyof typeof losses;
  const loss=losses[field],yieldValue=loss?{n:100n*loss.d-loss.n,d:100n*loss.d}:null;
  cells.push(!yieldValue||yieldValue.n<=0n?missing('Packaging layer '+(i+1)+' loss must be below 100% for '+d.row.ProductCode+'.'):
   units&&price?good(divide(divide(price,yieldValue),units)):missing('Missing layer price, FX or contained-unit count for '+d.row.ProductCode+'.'));
 }
 return sum(cells);
}
function composition(root:Draft,children:Draft[]){
 const capture=objectValue(root.row.ProductMixSnapshot),items=Array.isArray(capture.items)?capture.items as Row[]:null;
 const quantities=children.map(d=>{
  if(!items)return quantity(d.row.MixUnitQuantity);
  const matches=items.filter(i=>Number(i.ProductID)===Number(d.row.ProductID));
  return matches.length===1?quantity(matches[0].UnitQuantity??matches[0].MixUnitQuantity):null;
 });
 // Never allocate a full parent cost across only a partial captured child set.
 const complete=children.length>0&&quantities.every(Boolean)&&(!items||items.length===children.length&&new Set(children.map(d=>Number(d.row.ProductID))).size===children.length);
 return {quantities,total:complete?quantities.reduce<Fraction>((v,q)=>add(v,q!),zero):null};
}
export function buildTCBAnalysis(drafts:Draft[],tested:Record<number,string>={}):AnalysisScenario[]{
 const scenarios:AnalysisScenario[]=[];
 for(const root of drafts.filter(d=>!d.row.ParentItemID)){
  const children=drafts.filter(d=>Number(d.row.ParentItemID)===Number(root.row.ItemID)),products=root.mix?children.filter(d=>!d.mix):[root];
  if(!products.length)continue;
  const mix=root.mix?composition(root,children):null,total=mix?mix.total:one;
  const shipping={...root.row,...objectValue(root.row.ShipmentCostInfo)},currency=String(root.row.CustomerCurrencyCode??'').trim().toUpperCase();
  const rate=currency==='USD'?one:quantity(currency==='VND'?root.row.ExchangeRateVNDPerUSD:root.row.ExchangeRateCustomerCurrencyPerUSD);
  const customerAmount=(field:string,label:string)=>scale(optional(shipping[field],label),currency&&rate?divide(one,rate):null,'Missing customer exchange rate.');
  // Sales owns the commercial choice. Response plans supply matching capacity only.
  const request=String(root.row.ContainerRequest??'');
  const types=allowedContainerTypes(request,shipping.ContainerSizeFT);
  const kind=containerTypes.includes(request as typeof containerTypes[number])?request:
   ['Dry','Reefer'].includes(request)&&types.length===1?types[0]:'';
  const mode=String(root.row.ConfigurationRequest??'');
  const resolved=mode==='Pallet load'||mode==='Floor load'||mode==='Both';
  const parentPM=root.mix?perCount(packaging(root,root.row),total,'Missing captured Mix unit quantities.'):good(zero);
  const awarded=quantity(root.row.AnnualUnit),award=quantity(root.row.EstPctAwarded,true);
  const palletPrice=quantity(palletizationValue(root.row,root.costingInputs),true);
  const final=unitsPerFinal(root.row),palletUnits=quantity(root.row.UnitsPerPallet);
  {
   const result=objectValue(objectValue(root.row.ContainerLoadResults)[kind]);
   const cartons=result.CalculatedCartonsPerContainer??(root.row.SelectedContainerType===kind?root.row.CalculatedCartonsPerContainer:null);
   const n=quantity(cartons),containerUnits=n&&final&&total?multiply(multiply(n,final),total):null;
   const sharedPalletUnits=palletUnits&&total?multiply(palletUnits,total):null;
   const pallet=!resolved?missing('Choose a loading request.'):['Floor load','Both'].includes(mode)?good(zero):perCount(palletPrice?good(palletPrice):missing('Enter a pallet cost on the parent item (zero is allowed).'),sharedPalletUnits,'Missing units per pallet or Mix unit quantities.');
   const fobbing=!resolved?missing('Choose a loading request.'):perCount(optional(shipping.FobbingUSDPerContainer,'Fobbing/container'),containerUnits,'Missing container capacity, packaging quantities or Mix unit quantities.');
   const columns=products.map(d=>{
    const own=root.mix?Object.fromEntries(Object.entries(objectValue('OwnShipmentCostInfo' in d.row?d.row.OwnShipmentCostInfo:d.row.ShipmentCostInfo)).filter(([key])=>childOtherKeys.has(key))):shipping;
    const childQuantity=mix?mix.quantities[children.indexOf(d)]:one;
    const awardedUnits=awarded&&award&&award.n<=100n*award.d&&childQuantity?divide(multiply(multiply(awarded,award),childQuantity),hundred):null;
    const design=perCount(own.InitialDesignCustomer!=null?scale(optional(own.InitialDesignCustomer,'Initial Design'),rate?divide(one,rate):null,'Missing customer exchange rate.'):optional(own.InitialDesignUSD,'Initial Design'),awardedUnits,'Estimated awarded units must be positive for Initial Design.');
    const fixed=perCount(optional(own.OtherFixedCostsUSD,'Other fixed costs'),awardedUnits,'Estimated awarded units must be positive for fixed costs.');
    const calc=costs({...d.costingInputs,Prices:d.selections},d.quoteGrades,d.quotes),weight=quantity(d.row.WeightGrams),loss=productLossValue(d,tested[Number(d.row.ItemID)]);
    const validLoss=loss&&loss.n<100n*loss.d;
    const factor=weight&&validLoss?divide(divide(weight,gramsPerLb),{n:100n*loss.d-loss.n,d:100n*loss.d}):null;
    const product=d.pricingGradeKey!==JSON.stringify(d.grades)?missing('Reload pricing for current grades.'):
     calc.product&&factor?good(multiply(calc.product,factor)):missing('Product price, weight or current loss calculation is incomplete.');
    const packing=scale(packingRate(root,children)?good(packingRate(root,children)!):missing('Enter a Packing cost on the parent item.'),weight?divide(weight,gramsPerLb):null,'Missing product net weight.');
    const applicableWeight=quantity('ApplicableNetWeightGrams' in d.row?d.row.ApplicableNetWeightGrams:d.row.WeightGrams);
    const floor=['Floor load','Both'].includes(mode)?scale(optional(shipping.FloorLoadUSDPerMT,'Floor load cost'),applicableWeight?divide(applicableWeight,quantity('1000000')!):null,'Missing applicable net weight.'):good(zero);
    const cells=[product,packaging(d,root.row),parentPM,sum([pallet,floor]),packing,design,fixed,fobbing];
    const interestRate=pct(optional(own.InterestPct,'Interest %'),'Interest %'),duration=optional(own.InterestDays??own.InterestMonths,'Interest duration');
    const interestFactor=interestRate.value&&duration.value?divide(multiply(interestRate.value,duration.value),quantity(own.InterestDays!=null?'360':'12')!):null;
    cells.push(scale(sum(cells),interestFactor,'Invalid Interest % or days.'));
    const margin=pct(optional(own.MarginPct,'Margin %'),'Margin %');
    cells.push(own.MarginMode==='USDPerLb'||own.MarginMode==null&&own.MarginUSDPerLb!=null?
     scale(optional(own.MarginUSDPerLb,'Margin USD/lb'),weight?divide(weight,gramsPerLb):null,'Missing product weight.'):
     scale(sum(cells),margin.value,'Invalid Margin %.'));
    cells.push(sum(cells));
    cells.push(scale(cells[10],currency?rate:null,'Missing Opportunity customer currency or exchange rate.'));
    const perContainer=(field:string,label:string)=>!resolved?missing('Choose a loading request.'):
     perCount(optional(shipping[field],label),containerUnits,'Missing container capacity, packaging quantities or Mix unit quantities.');
    const perPallet=(field:string,label:string)=>!resolved?missing('Choose a loading request.'):
     perCount(optional(shipping[field],label),sharedPalletUnits,'Missing units per pallet or Mix unit quantities.');
    const percentage=(field:string,label:string)=>pct(optional(shipping[field],label),label);
    const freight=perContainer('FreightUSDPerContainer','Freight/container');
    const duty=scale(sum([cells[10],freight]),percentage('DutyPct','Duty %').value,'Invalid Duty %.');
    const destination=[
     freight,duty,shipping.ImportClearanceCustomerPerContainer!=null?
      !resolved?missing('Choose a loading request.'):perCount(scale(optional(shipping.ImportClearanceCustomerPerContainer,'Import clearance/customer currency/container'),rate?divide(one,rate):null,'Missing customer exchange rate.'),containerUnits,'Missing units per container.'):
      shipping.ImportClearanceCustomerPerPallet!=null?
      !resolved?missing('Choose a loading request.'):perCount(scale(optional(shipping.ImportClearanceCustomerPerPallet,'Import clearance/customer currency/pallet'),rate?divide(one,rate):null,'Missing customer exchange rate.'),sharedPalletUnits,'Missing units per pallet.'):
      perContainer('ImportClearanceUSDPerContainer','Import clearance/container'),
     shipping.PortToWHCustomerPerContainer!=null?(!resolved?missing('Choose a loading request.'):perCount(customerAmount('PortToWHCustomerPerContainer','Port–WH/container'),containerUnits,'Missing units per container.')):perContainer('PortToWHUSDPerContainer','Port–WH/container'),
     shipping.WHCostCustomerPerPallet!=null?(!resolved?missing('Choose a loading request.'):perCount(customerAmount('WHCostCustomerPerPallet','Destination WH cost/pallet'),sharedPalletUnits,'Missing units per pallet.')):perPallet('WHCostUSDPerPallet','Destination WH cost/pallet')
    ];
    destination.push(scale(sum([cells[10],...destination]),percentage('OverageShortageDamagePct','Damage %').value,'Invalid Damage %.'));
    destination.push(perPallet('WHToCoManWHUSDPerPallet','WH–Co-Man WH/pallet'),
     perPallet('CoManOverheadUSDPerPallet','Co-Man Overhead/pallet'),perPallet('FreightToCustomerUSDPerPallet','Freight to Customer/pallet'));
    const base=sum([cells[10],...destination]);
    const fees=[
     percentage('SpoilageAllowancePct','Spoilage Allowance %'),percentage('PaymentTermPct','Payment Term %'),
     percentage('CoManFeePct','Co-Man fee %'),percentage('BrokerFeePct','Broker Fee %')
    ],combined=sum(fees);
    const remaining=combined.value?{n:combined.value.d-combined.value.n,d:combined.value.d}:null;
    const gross=remaining&&remaining.n>0n?scale(base,divide(one,remaining),'Invalid combined fee ratios.'):
     missing('Spoilage, Payment Term, Co-Man and Broker fee ratios must total less than 100%.');
    const allowances=fees.map(fee=>scale(gross,fee.value,'Invalid fee ratio.'));
    const cfr=sum([cells[10],freight]),ddp=sum([base,...allowances]);
    cells.push(...destination,...allowances,cfr,ddp,scale(ddp,currency?rate:null,'Missing Opportunity customer currency or exchange rate.'));
    return {id:Number(d.row.ItemID),label:String(d.row.ItemNumber??d.row.ItemID)+' · '+d.row.ProductCode+' · '+d.row.ProductName,cells,cfrCustomer:scale(cfr,currency?rate:null,'Missing customer currency or exchange rate.')};
   });
   const finalBox={} as FinalBoxTotals;
   for(const [term,index] of [['FOB',10],['CFR',25],['DDP',26]] as const){
    const usd=sum(columns.map((column,i)=>scale(column.cells[index],final&&(mix?mix.quantities[children.indexOf(products[i])]:one)?multiply(final,(mix?mix.quantities[children.indexOf(products[i])]:one)!):null,'Missing final-box quantities.')));
    finalBox[term]={usd,customer:scale(usd,currency?rate:null,'Missing customer currency or exchange rate.')};
   }
   const boxed:AnalysisColumn[]=columns.map(column=>({...column,finalBox}));
   scenarios.push({label:kind||'Select Sales container',columns:boxed,currency});
  }
 }
 return scenarios;
}
