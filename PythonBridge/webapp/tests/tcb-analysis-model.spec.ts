import {test,expect} from '@playwright/test';
import {buildTCBAnalysis,analysisRows} from '../src/tcb-analysis-model';
import type {Draft} from '../src/opportunity-losses';
import {defaultInputs,manualCostInputs} from '../src/tcb-model';
import {quantityDisplay} from '../src/packaging-summary-model';

function draft(id=1,extra:Partial<Draft>={}):Draft{
 const row={ItemID:id,ProductID:id,ProductCode:'P'+id,ProductName:'Product '+id,ItemNumber:String(id),WeightGrams:'453.59237',AnnualUnit:'1000',EstPctAwarded:'50',ResponseLayerCount:2,UnitsPerCarton:'10',UnitsPerPallet:'1000',PrimaryPricePerUnit:'.1',PrimaryPriceCurrencyCode:'USD',SecondaryPricePerUnit:'1',SecondaryPriceCurrencyCode:'USD',CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5',ContainerRequest:'Dry',ConfigurationRequest:'Pallet load',SelectedContainerType:'20DC',ContainerLoadProfiles:{'20DC':{PalletsPerContainer:10,CartonsPerContainerFloor:200}},ContainerLoadResults:{'20DC':{CalculatedCartonsPerContainer:100}},ShipmentCostInfo:{PackingUSDPerLb:'.5',InitialDesignUSD:'100',OtherFixedCostsUSD:'50',FobbingUSDPerContainer:'200',InterestPct:'12',InterestMonths:'10',MarginPct:'10'}};
 const costingInputs={...defaultInputs(),PalletUSDPerEA:'10'};
 const d:Draft={row,version:'rv',mix:false,readonly:false,layers:2,masters:[],steps:[{ProcessType:'Processing',Sequence:1,LossPct:'10'}],formula:'',grades:[],baselineGrades:'[]',selections:[{Path:'0/1',DirectUSDPerLb:'2'}],baselinePrices:'[]',quoteGrades:[{Path:'0/1',Proportion:'1'}],quotes:[],costingInputs,baselineCosts:JSON.stringify(manualCostInputs(costingInputs)),pricingGradeKey:'[]',gradeLocked:false,baseline:'',...extra};
 d.baseline=JSON.stringify({formula:d.formula,steps:d.steps});return d;
}
const values=(column:ReturnType<typeof buildTCBAnalysis>[number]['columns'][number])=>column.cells.map(c=>quantityDisplay(c.value,8).replaceAll(',',''));

function pair(child=draft(11)){
 const parent=draft(10,{mix:true,steps:[]});
 parent.row={...child.row,ItemID:10,ProductID:10,ProductCode:'MIX',ProductName:'Mix parent',ParentItemID:null,PrimaryPricePerUnit:'0',SecondaryPricePerUnit:'0',TertiaryPricePerUnit:'0',ProductMixSnapshot:{items:[{ProductID:child.row.ProductID,UnitQuantity:1}]}};
 parent.costingInputs={...child.costingInputs};
 child.row.ParentItemID=10;child.row.MixUnitQuantity=1;
 return [parent,child];
}
test('child Analysis uses exact unit conversions and sequential interest and margin',()=>{
 const drafts=pair(),scenarios=buildTCBAnalysis(drafts);
 expect(analysisRows).toHaveLength(28);expect(scenarios).toHaveLength(1);
 expect(scenarios[0].columns.map(c=>c.id)).toEqual([11]);
 expect(values(scenarios[0].columns[0]).slice(0,12)).toEqual(['1.8','0.2','0','0.01','0.5','0.2','0.1','0.2','0.301','0.3311','3.6421','5.46315']);
 drafts[0].row.ConfigurationRequest='Floor load';drafts[0].row.ContainerLoadResults={"20DC":{CalculatedCartonsPerContainer:200}};
 expect(values(buildTCBAnalysis(drafts)[0].columns[0]).slice(3,12)).toEqual(['0','0.5','0.2','0.1','0.1','0.29','0.319','3.509','5.2635']);
});
test('unequal Mix quantities allocate shared costs equally without a parent column',()=>{
 const root=draft(10,{mix:true,steps:[]}),a=draft(11),b=draft(12);
 root.row.ProductMixSnapshot={items:[{ProductID:11,UnitQuantity:2},{ProductID:12,UnitQuantity:1}]};
 for(const child of [a,b]){child.row.ParentItemID=10;child.row.MixUnitQuantity=child===a?2:1}
 b.row.WeightGrams='907.18474';
 const [scenario]=buildTCBAnalysis([root,a,b]),[first,second]=scenario.columns;
 expect(scenario.columns.map(c=>c.id)).toEqual([11,12]);
 for(const index of [2,3,5,6,7])expect(values(first)[index]).toBe(values(second)[index]);
 expect(values(first)[2]).toBe('0.06666667');expect(values(first)[3]).toBe('0.00333333');
 expect(values(first)[5]).toBe('0.06666667');expect(values(first)[7]).toBe('0.06666667');
});
test('Both has one child-only result with pallet plus floor cost',()=>{
 const drafts=pair();drafts[0].row.ConfigurationRequest='Both';
 drafts[0].row.ShipmentCostInfo={FloorLoadUSDPerMT:'100'};
 drafts[1].row.ApplicableNetWeightGrams='150';
 const scenario=buildTCBAnalysis(drafts)[0];
 expect(scenario.columns.map(c=>c.id)).toEqual([11]);
 expect(values(scenario.columns[0])[3]).toBe('0.025');
 expect(scenario.columns[0].cells[10].value).not.toBeNull();
});

test('days, USD-per-lb margin and customer clearance use exact revised units',()=>{
 const d=draft();d.row.ShipmentCostInfo={InterestPct:'12',InterestDays:30,MarginMode:'USDPerLb',MarginUSDPerLb:'.5',ImportClearanceCustomerPerPallet:'150',PaymentTermDays:999};
 const actual=values(buildTCBAnalysis([d])[0].columns[0]);
 expect(actual[8]).toBe('0.0201');expect(actual[9]).toBe('0.5');expect(actual[14]).toBe('0.1');
 d.row.ShipmentCostInfo={...d.row.ShipmentCostInfo as object,PaymentTermDays:0};
 expect(values(buildTCBAnalysis([d])[0].columns[0])).toEqual(actual);
});

test('standalone products use their own costs and Mix parents without children remain excluded',()=>{
 const scenarios=buildTCBAnalysis([draft()]);
 expect(scenarios).toHaveLength(1);expect(scenarios[0].columns.map(c=>c.id)).toEqual([1]);
 expect(values(scenarios[0].columns[0]).slice(0,12)).toEqual(['1.8','0.2','0','0.01','0.5','0.2','0.1','0.2','0.301','0.3311','3.6421','5.46315']);
 expect(buildTCBAnalysis([draft(10,{mix:true})])).toEqual([]);
});
test('missing input or zero denominator never fabricates a complete FOB',()=>{
 const drafts=pair(),[root,child]=drafts;root.row.EstPctAwarded='0';
 let col=buildTCBAnalysis(drafts)[0].columns[0];
 expect(col.cells[5].value).toBeNull();expect(col.cells[10].value).toBeNull();
 root.row.ShipmentCostInfo={};root.costingInputs.PalletUSDPerEA=null;
 col=buildTCBAnalysis(drafts)[0].columns[0];expect(col.cells[3].value).toBeNull();
 root.row.ConfigurationRequest='Floor load';
 col=buildTCBAnalysis(drafts)[0].columns[0];expect(col.cells[3].value?.n).toBe(0n);
 child.row.ResponseLayerCount=null;
 col=buildTCBAnalysis(drafts)[0].columns[0];expect(col.cells[1].value).toBeNull();expect(col.cells[10].value).toBeNull();
});
test('each child and Mix parent packaging layer uses its own yield before allocation',()=>{
 const root=draft(10,{mix:true,steps:[
  {ProcessType:'MixPrimaryPackaging',Sequence:1,LossPct:'10'},
  {ProcessType:'MixSecondaryPackaging',Sequence:1,LossPct:'20'},
  {ProcessType:'MixTertiaryPackaging',Sequence:1,LossPct:'50'}
 ]}),child=draft(11),other=draft(12);
 root.layers=3;root.row.ResponseLayerCount=3;root.row.UnitsPerTertiary=5;
 root.row.TertiaryPricePerUnit=5;root.row.TertiaryPriceCurrencyCode='USD';
 root.row.ProductMixSnapshot={items:[{ProductID:11,UnitQuantity:2},{ProductID:12,UnitQuantity:1}]};
 for(const d of [child,other])d.row.ParentItemID=10;
 child.layers=3;child.row.ResponseLayerCount=3;child.row.UnitsPerTertiary=5;
 child.row.TertiaryPricePerUnit=5;child.row.TertiaryPriceCurrencyCode='USD';
 child.steps.push(
  {ProcessType:'PrimaryPackaging',Sequence:1,LossPct:'10'},
  {ProcessType:'SecondaryPackaging',Sequence:1,LossPct:'20'},
  {ProcessType:'TertiaryPackaging',Sequence:1,LossPct:'50'}
 );
 const [a,b]=buildTCBAnalysis([root,child,other])[0].columns;
 expect(values(a)[1]).toBe('0.43611111');expect(values(b)[1]).toBe('0.2');
 expect(values(a)[2]).toBe('0.14537037');expect(values(b)[2]).toBe('0.14537037');
 expect(a.cells[10].value).not.toBeNull();
 const previousFOB=values(a)[10];child.steps[1].LossPct='0';
 expect(values(buildTCBAnalysis([root,child,other])[0].columns[0])[10]).not.toBe(previousFOB);
});
test('standalone layer loss handles zero and refuses zero yield or invalid ratios',()=>{
 const d=draft();d.steps.push({ProcessType:'PrimaryPackaging',Sequence:1,LossPct:'0'});
 expect(values(buildTCBAnalysis([d])[0].columns[0])[1]).toBe('0.2');
 for(const ratio of ['100','101','-1','invalid']){
  d.steps[1].LossPct=ratio;
  const col=buildTCBAnalysis([d])[0].columns[0];
  expect(col.cells[1].value).toBeNull();expect(col.cells[10].value).toBeNull();
 }
});
test('destination costs and shared fee gross-up produce CFR and DDP without double counting',()=>{
 const d=draft();
 d.row.ShipmentCostInfo={...(d.row.ShipmentCostInfo as object),FreightUSDPerContainer:'1000',DutyPct:'10',
  ImportClearanceUSDPerContainer:'100',PortToWHUSDPerContainer:'200',WHCostUSDPerPallet:'300',
  OverageShortageDamagePct:'5',WHToCoManWHUSDPerPallet:'400',CoManOverheadUSDPerPallet:'500',
  FreightToCustomerUSDPerPallet:'600',SpoilageAllowancePct:'2',PaymentTermPct:'3',CoManFeePct:'4',BrokerFeePct:'1'};
 const col=buildTCBAnalysis([d])[0].columns[0],actual=values(col).map(Number);
 const base=7.4916255,gross=base/.9;
 const expected=[1,.46421,.1,.2,.3,.2853155,.4,.5,.6,gross*.02,gross*.03,gross*.04,gross*.01,4.6421,gross,gross*1.5];
 expected.forEach((value,i)=>expect(actual[i+12]).toBeCloseTo(value,7));
 d.row.ConfigurationRequest='Floor load';d.row.ContainerLoadResults={"20DC":{CalculatedCartonsPerContainer:200}};
 expect(values(buildTCBAnalysis([d])[0].columns[0])[12]).toBe('0.5');
 expect(values(buildTCBAnalysis([d])[0].columns[0])[16]).toBe('0.3');
 d.row.CustomerCurrencyCode='USD';
 const usd=values(buildTCBAnalysis([d])[0].columns[0]);expect(usd[27]).toBe(usd[26]);
 d.row.CustomerCurrencyCode='VND';d.row.ExchangeRateVNDPerUSD='25000';
 const vnd=values(buildTCBAnalysis([d])[0].columns[0]).map(Number);expect(vnd[27]/25000).toBeCloseTo(vnd[26],7);
});
test('Mix logistics allocate equally per smallest child unit and invalid fees cannot create DDP',()=>{
 const root=draft(10,{mix:true}),a=draft(11),b=draft(12);
 root.row.ProductMixSnapshot={items:[{ProductID:11,UnitQuantity:2},{ProductID:12,UnitQuantity:1}]};
 for(const child of [a,b])child.row.ParentItemID=10;
 root.row.ShipmentCostInfo={FreightUSDPerContainer:'300',WHCostUSDPerPallet:'600',SpoilageAllowancePct:'50',PaymentTermPct:'50'};
 const [first,second]=buildTCBAnalysis([root,a,b])[0].columns;
 for(const column of [first,second]){
  expect(values(column)[12]).toBe('0.1');expect(values(column)[16]).toBe('0.2');
  expect(column.cells[25].value).not.toBeNull();expect(column.cells[26].value).toBeNull();
  expect(column.cells[21].issues.join(' ')).toContain('less than 100%');
 }
 root.row.ConfigurationRequest='Both';
 const deferred=buildTCBAnalysis([root,a,b])[0].columns[0];
 expect(deferred.cells[12].value).not.toBeNull();expect(deferred.cells[26].value).toBeNull();
});
test('custom loss formulas require current server result and use unrounded percentages',()=>{
 const d=draft(11,{formula:'L1'});d.steps[0].LossPct='20';const drafts=pair(d);
 expect(buildTCBAnalysis(drafts)[0].columns[0].cells[0].value).toBeNull();
 expect(values(buildTCBAnalysis(drafts,{11:'20'})[0].columns[0])[0]).toBe('1.6');
});
test('VND and USD conversion use Opportunity rates and missing FX is incomplete',()=>{
 const drafts=pair(),d=drafts[0];d.row.CustomerCurrencyCode='VND';d.row.ExchangeRateVNDPerUSD='25000';
 expect(values(buildTCBAnalysis(drafts)[0].columns[0])[11]).toBe('91052.5');
 d.row.ExchangeRateVNDPerUSD=null;expect(buildTCBAnalysis(drafts)[0].columns[0].cells[11].value).toBeNull();
 d.row.CustomerCurrencyCode='USD';expect(values(buildTCBAnalysis(drafts)[0].columns[0])[11]).toBe('3.6421');
});
test('tertiary normalization uses the selected container only, not separate tables',()=>{
 const d=draft(11);d.row.ResponseLayerCount=3;d.layers=3;d.row.UnitsPerTertiary=5;d.row.TertiaryPricePerUnit=5;d.row.TertiaryPriceCurrencyCode='USD';
 const drafts=pair(d),root=drafts[0];
 root.row.ContainerLoadProfiles={'20DC':{CartonsPerContainerFloor:200},'40DC':{CartonsPerContainerFloor:400}};
 root.row.ContainerLoadResults={'20DC':{CalculatedCartonsPerContainer:100},'40DC':{CalculatedCartonsPerContainer:300}};
 let scenarios=buildTCBAnalysis(drafts);
 expect(scenarios).toHaveLength(1);expect(values(scenarios[0].columns[0])[1]).toBe('0.3');
 expect(values(scenarios[0].columns[0])[7]).toBe('0.04');
 root.row.SelectedContainerType='40DC';scenarios=buildTCBAnalysis(drafts);
 expect(scenarios).toHaveLength(1);expect(values(scenarios[0].columns[0])[7]).toBe('0.01333333');
});
test('partial captured Mix compositions do not allocate parent costs across visible children only',()=>{
 const root=draft(10,{mix:true}),a=draft(11);a.row.ParentItemID=10;
 root.row.ProductMixSnapshot={items:[{ProductID:11,UnitQuantity:2},{ProductID:12,UnitQuantity:1}]};
 const [child]=buildTCBAnalysis([root,a])[0].columns;
 expect(child.cells[2].value).toBeNull();expect(child.cells[10].value).toBeNull();
});
