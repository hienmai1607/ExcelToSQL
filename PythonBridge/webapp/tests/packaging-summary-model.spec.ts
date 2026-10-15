import {test,expect} from '@playwright/test';
import {productSummary,buildPackagingSummary,costDisplay,sumCosts,scaleCost,quantity,quantityDisplay,loadPackagingSummary,opportunityCurrency,type SummaryRow} from '../src/packaging-summary-model';

const root:SummaryRow={ItemID:101,RequestID:9,OpportunityItemID:10,ProductID:20,ProductCode:'PRD-ROOT',
 ResponseLayerCount:3,FirstPMType:'Bag',SecondPMType:'Box',ThirdPMType:'Carton',
 PrimaryPricePerUnit:'100',PrimaryPriceCurrencyCode:'VND',SecondaryPricePerUnit:'300',SecondaryPriceCurrencyCode:'VND',
 TertiaryPricePerUnit:'900',TertiaryPriceCurrencyCode:'VND',UnitsPerCarton:'12',UnitsPerTertiary:'5'};

test('normal layer costs flow down exactly through both Packing Way quantities',()=>{
 const result=productSummary(root);
 expect(result.layers.map(layer=>costDisplay(layer.cumulative))).toEqual(['100.00 VND','1,500.00 VND','8,400.00 VND']);
 expect(costDisplay(result.ownPerUnit)).toBe('140.00 VND');
 expect(costDisplay(scaleCost(result.ownPerUnit,result.units))).toBe(costDisplay(result.total));
 for(const count of [1,2,3])expect(costDisplay(productSummary({...root,ResponseLayerCount:count}).ownPerUnit)).toBe(['100.00 VND','125.00 VND','140.00 VND'][count-1]);
});

test('layer gross weights use PCR values and convert kg to grams without floating point loss',()=>{
 const result=productSummary({...root,PrimaryGrossWeightKG:'0.160123456',SecondaryGrossWeightKG:'2.5',TertiaryGrossWeightKG:'15.75'});
 expect(result.layers.map(layer=>quantityDisplay(layer.gross,3))).toEqual(['160.123','2,500','15,750']);
 expect(productSummary({...root,PrimaryGrossWeightKG:null}).layers[0].gross).toBeNull();
 expect(quantityDisplay(productSummary({...root,PrimaryGrossWeightKG:'0'}).layers[0].gross,3)).toBe('0');
 const parent=buildPackagingSummary({...mix,PrimaryGrossWeightKG:'5.78885',SecondaryGrossWeightKG:'10.88885'},children);
 expect(parent.root.layers.map(layer=>quantityDisplay(layer.gross,3))).toEqual(['5,788.85','10,888.85']);
});

const children:SummaryRow[]=[
 {ItemID:102,RequestID:9,OpportunityItemID:11,ParentItemID:10,ProductID:1,ProductCode:'PRD-A',ResponseLayerCount:2,
  FirstPMType:'Film',SecondPMType:'Box',UnitsPerCarton:'3',PrimaryPricePerUnit:'10',PrimaryPriceCurrencyCode:'VND',SecondaryPricePerUnit:'60',SecondaryPriceCurrencyCode:'VND'},
 {ItemID:103,RequestID:9,OpportunityItemID:12,ParentItemID:10,ProductID:2,ProductCode:'PRD-B',ResponseLayerCount:1,
  FirstPMType:'Bag',PrimaryPricePerUnit:'5',PrimaryPriceCurrencyCode:'VND'}
];
const mix:SummaryRow={...root,IsMixParent:true,ResponseLayerCount:2,UnitsPerCarton:'6',PrimaryPricePerUnit:'24',SecondaryPricePerUnit:'18',
 ProductMixSnapshot:JSON.stringify({items:[{ProductID:1,ProductCode:'PRD-A',UnitQuantity:'2'},{ProductID:2,ProductCode:'PRD-B',UnitQuantity:'1'}]})};

test('mix child quantities count smallest products; all costs conserve with equal unit allocation',()=>{
 const result=buildPackagingSummary(mix,children);
 expect(result.children.map(child=>costDisplay(child.product.ownPerUnit))).toEqual(['30.00 VND','5.00 VND']);
 expect(costDisplay(result.root.total)).toBe('552.00 VND');
 expect(costDisplay(result.totalPerMix)).toBe('92.00 VND');
 expect(result.units.map(unit=>costDisplay(unit.shared))).toEqual(['9.00 VND','9.00 VND']);
 expect(result.units.map(unit=>costDisplay(unit.total))).toEqual(['39.00 VND','14.00 VND']);
 expect(costDisplay(sumCosts(...result.units.map(unit=>scaleCost(unit.total,unit.quantity))))).toBe('92.00 VND');
 expect(result.issues).toEqual([]);
});

test('fractional mix ratios and repeating currency division stay exact until display',()=>{
 const result=buildPackagingSummary({...mix,ResponseLayerCount:1,PrimaryPricePerUnit:'1',ProductMixSnapshot:{items:[
  {ProductID:1,UnitQuantity:'0.25'},{ProductID:2,UnitQuantity:'0.5'}]}},children);
 expect(result.units[0].shared.amounts.VND).toEqual({n:4n,d:3n});
 expect(costDisplay(result.units[0].shared)).toBe('1.33 VND');
 expect(costDisplay(sumCosts(...result.units.map(unit=>scaleCost(unit.total,unit.quantity))))).toBe(costDisplay(result.totalPerMix));
});

test('currencies never silently mix or use a guessed exchange rate',()=>{
 const result=buildPackagingSummary(mix,[{...children[0],PrimaryPriceCurrencyCode:'USD',SecondaryPriceCurrencyCode:'USD'},children[1]]);
 expect(costDisplay(result.totalPerMix)).toBe('60.00 USD + 32.00 VND');
 expect(costDisplay(result.units[0].total)).toBe('30.00 USD + 9.00 VND');
});

test('scientific-notation API prices are retained exactly and money displays two decimals',()=>{
 const result=productSummary({...root,ResponseLayerCount:2,PrimaryPricePerUnit:0,SecondaryPricePerUnit:1e-9,UnitsPerCarton:2000000000});
 expect(result.ownPerUnit.amounts.VND).toEqual({n:1n,d:2000000000000000000n});
 expect(costDisplay(result.ownPerUnit)).toBe('0.00 VND');
 expect(costDisplay(result.total)).toBe('0.00 VND');
 expect(quantity('1e100')).toBeNull();
});

test('unknown prices, quantities, hidden responses and missing children do not become zero',()=>{
 for(const data of [{...root,SecondaryPricePerUnit:null},{...root,UnitsPerCarton:null},{...root,UnitsPerTertiary:'0'},{...root,PrimaryPriceCurrencyCode:null},{...root,ResponseLayerCount:null}])expect(costDisplay(productSummary(data).ownPerUnit)).toBe('Incomplete');
 expect(costDisplay(productSummary({...root,ResponseLayerCount:1,PrimaryPricePerUnit:'0'}).ownPerUnit)).toBe('0.00 VND');
 for(const rows of [children.slice(0,1),[{...children[0],ResponseLayerCount:null},children[1]],children.map(child=>({...child,RequestID:99})),[...children,children[0]]]){
  expect(costDisplay(buildPackagingSummary(mix,rows).totalPerMix)).toBe('Incomplete');
 }
 expect(costDisplay(buildPackagingSummary({...mix,ProductMixSnapshot:null},children).totalPerMix)).toBe('Incomplete');
});

test('current PCR captured dimensions are shown only for the matching packaging type',()=>{
 const capture={PackagingTypeName:'Bag',Dimensions:[{Name:'Length',Unit:'mm',Value:'100'}]};
 expect(productSummary({...root,LayerDimensionCaptures:{Primary:capture}}).layers[0].dimensions).toEqual(capture.Dimensions);
 expect(productSummary({...root,FirstPMType:'Other',LayerDimensionCaptures:{Primary:capture}}).layers[0].dimensions).toEqual([]);
});

test('all PCR pages are loaded before calculating mix children, even off screen',async()=>{
 const pages:number[]=[];
 const result=await loadPackagingSummary(9,10,async(id,page,size)=>{
  expect(id).toBe(9);expect(size).toBe(200);pages.push(page);
  return {rows:(page===1?[mix,...Array.from({length:199},(_,index)=>({ItemID:1000+index,RequestID:9,OpportunityItemID:1000+index}))]:children) as any,total:202};
 });
 expect(pages).toEqual([1,2]);expect(costDisplay(result.totalPerMix)).toBe('92.00 VND');
});

test('Opportunity master rates convert USD and VND to customer currency before mix allocation',()=>{
 const exchange=opportunityCurrency({CustomerCurrencyCode:'EUR',ExchangeRateVNDPerUSD:'25000',ExchangeRateCustomerCurrencyPerUSD:'.8'});
 const result=buildPackagingSummary(mix,[{...children[0],PrimaryPriceCurrencyCode:'USD',SecondaryPriceCurrencyCode:'USD'},children[1]],exchange);
 expect(costDisplay(result.totalPerMix)).toBe('48.00 EUR');
 expect(result.totalPerMix.amounts.EUR).toEqual({n:750016n,d:15625n});
 expect(sumCosts(...result.units.map(unit=>scaleCost(unit.total,unit.quantity))).amounts).toEqual(result.totalPerMix.amounts);
 expect(result.units[0].total.amounts.EUR).toEqual({n:750009n,d:31250n});
 expect(result.issues).toEqual([]);
});
test('Opportunity conversion uses saved USD price only for other supplier currencies',()=>{
 const foreign={...root,ResponseLayerCount:1,PrimaryPricePerUnit:'200',PrimaryPriceCurrencyCode:'JPY',PrimaryPriceUSDPerUnit:'1.25'};
 const exchange=opportunityCurrency({CustomerCurrencyCode:'EUR',ExchangeRateCustomerCurrencyPerUSD:'.8'});
 expect(costDisplay(buildPackagingSummary(foreign,[],exchange).totalPerMix)).toBe('1.00 EUR');
 expect(costDisplay(buildPackagingSummary({...foreign,PrimaryPriceUSDPerUnit:null},[],exchange).totalPerMix)).toBe('Incomplete');
});
test('USD and VND target rates are explicit and missing or invalid master rates do not default',()=>{
 const usd={...root,ResponseLayerCount:1,PrimaryPricePerUnit:'2',PrimaryPriceCurrencyCode:'USD'};
 const vnd={...root,ResponseLayerCount:1,PrimaryPricePerUnit:'25000'};
 expect(costDisplay(buildPackagingSummary(usd,[],opportunityCurrency({CustomerCurrencyCode:'VND',ExchangeRateVNDPerUSD:'25000'})).totalPerMix)).toBe('50,000.00 VND');
 expect(costDisplay(buildPackagingSummary(vnd,[],opportunityCurrency({CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:'25000'})).totalPerMix)).toBe('1.00 USD');
 for(const rate of [null,'0','-1','NaN'])expect(costDisplay(buildPackagingSummary(vnd,[],opportunityCurrency({CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:rate})).totalPerMix)).toBe('Incomplete');
 expect(costDisplay(buildPackagingSummary(usd,[],opportunityCurrency({CustomerCurrencyCode:'USD'})).totalPerMix)).toBe('2.00 USD');
 expect(costDisplay(buildPackagingSummary(vnd,[],opportunityCurrency({CustomerCurrencyCode:'VND'})).totalPerMix)).toBe('25,000.00 VND');
 expect(costDisplay(buildPackagingSummary(usd,[],opportunityCurrency({})).totalPerMix)).toBe('Incomplete');
});
test('currency displays exactly two decimals and rounds once after cost allocation',()=>{
 const result=buildPackagingSummary({...root,ResponseLayerCount:2,UnitsPerCarton:3,PrimaryPricePerUnit:'1.005',SecondaryPricePerUnit:1},[]);
 expect(costDisplay(result.root.layers[0].own)).toBe('1.01 VND');
 expect(costDisplay(result.totalPerMix)).toBe('1.34 VND');
 expect(result.totalPerMix.amounts.VND).toEqual({n:803n,d:600n});
});
test('all linked PCR pages use the provided Opportunity currency',async()=>{
 const result=await loadPackagingSummary(9,10,async()=>({rows:[{...root,ResponseLayerCount:1,PrimaryPricePerUnit:'25000'}] as any,total:1}),opportunityCurrency({CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:'25000'}));
 expect(costDisplay(result.totalPerMix)).toBe('1.00 USD');
});

test('non-USD customer prices show the USD equivalent alongside using exact master rates',()=>{
 const exchange=opportunityCurrency({CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5'});
 const cost={amounts:{AUD:quantity('10')!},complete:true,issues:[]};
 expect(costDisplay(cost,exchange)).toBe('10.00 AUD (6.67 USD)');
 expect(costDisplay({...cost,amounts:{AUD:quantity('.006')!}},exchange)).toBe('0.01 AUD (0.00 USD)');
 expect(costDisplay({...cost,amounts:{AUD:quantity('0',true)!}},exchange)).toBe('0.00 AUD (0.00 USD)');
 const vnd=opportunityCurrency({CustomerCurrencyCode:'VND',ExchangeRateVNDPerUSD:'25000',ExchangeRateCustomerCurrencyPerUSD:'999'});
 expect(costDisplay({...cost,amounts:{VND:quantity('25000')!}},vnd)).toBe('25,000.00 VND (1.00 USD)');
});
test('USD prices are never duplicated and unavailable equivalents are not guessed',()=>{
 const cost={amounts:{USD:quantity('10')!},complete:true,issues:[]};
 expect(costDisplay(cost,opportunityCurrency({CustomerCurrencyCode:'USD'}))).toBe('10.00 USD');
 for(const rate of [null,'0','-1','NaN'])expect(costDisplay({...cost,amounts:{AUD:quantity('10')!}},opportunityCurrency({CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:rate}))).toBe('10.00 AUD (USD unavailable)');
 expect(costDisplay({...cost,complete:false},opportunityCurrency({CustomerCurrencyCode:'AUD'}))).toBe('Incomplete');
 expect(costDisplay({amounts:{},complete:true,issues:[]},opportunityCurrency({CustomerCurrencyCode:'AUD'}))).toBe('—');
});

test('bad or changed PCR pages cannot silently provide a partial or unrelated summary',async()=>{
 for(const rows of [[{...mix,RequestID:99}],[mix,mix]])await expect(loadPackagingSummary(9,10,async()=>({rows:rows as any,total:rows.length}))).rejects.toThrow(/Invalid|changed/);
 await expect(loadPackagingSummary(9,10,async(_id,page)=>({rows:(page===1?[mix]:[]) as any,total:3}))).rejects.toThrow(/changed/);
 await expect(loadPackagingSummary(0,10,async()=>({rows:[],total:0}))).rejects.toThrow(/No current PCR/);
 await expect(loadPackagingSummary(9,999,async()=>({rows:[mix] as any,total:1}))).rejects.toThrow(/not found/);
 expect(quantity('NaN')).toBeNull();expect(quantity('-1')).toBeNull();
});
