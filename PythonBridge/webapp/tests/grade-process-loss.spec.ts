import {test,expect} from '@playwright/test';
import {costs,recipeRows,defaultInputs,type TCBInputs} from '../src/tcb-model';
import {classifyProcessLeaves} from '../src/grade-process';
import {quantityDisplay} from '../src/packaging-summary-model';
import {processLossValue} from '../src/grade-process-loss';
import type {GradeItem} from '../src/product-grades';

const tree:GradeItem[]=[{ParentID:'0',ID:1,Grade:'Cashews',RatioPct:'20',Process:true},
 {ParentID:'0/1',ID:1,Grade:'W320',RatioPct:'80',RawGradeID:1,Process:false},
 {ParentID:'0/1',ID:2,Grade:'W210',RatioPct:'20',RawGradeID:2,Process:false},
 {ParentID:'0',ID:2,Grade:'Almonds',RatioPct:'80',RawGradeID:3,Process:false}];
const grades=classifyProcessLeaves(tree,[{Path:'0/1/1',Grade:'W320',RawGradeID:1,Proportion:'.16'},{Path:'0/1/2',Grade:'W210',RawGradeID:2,Proportion:'.04'},{Path:'0/2',Grade:'Almonds',RawGradeID:3,Proportion:'.8'}]);
const inputs=():TCBInputs=>({...defaultInputs(),Prices:[{Path:'0/1/1',DirectUSDPerLb:'3.6'},{Path:'0/1/2',DirectUSDPerLb:'1.8'},{Path:'0/2',DirectUSDPerLb:'2'}],ProcessLosses:[{Path:'0/1',Ratios:['10'],Formula:''}],MaterialCosts:[{Path:'0/1',RMRatio:'80',SeasoningRatio:'20',SeasoningUSDPerLb:'1',OilPct:'0',ProcessingUSDPerLb:'.1'}]});

test('grade loss adjusts only raw cost, keeps Processing and rolls up every hierarchy level',()=>{
 const i=inputs(),total=costs(i,grades,[]),rows=recipeRows(i,tree,grades,[]);
 expect(quantityDisplay(total.rm,8)).toBe('2.32');expect(quantityDisplay(total.product,8)).toBe('2.236');
 expect(quantityDisplay(total.rmWithoutLoss,8)).toBe('2.248');
 expect(rows.map(r=>[r.Path,r.RatioPct])).toEqual([['0/1','20'],['0/1/1','80'],['0/1/2','20'],['0/2','80']]);
 expect(quantityDisplay(rows[0].rm,8)).toBe('3.6');expect(quantityDisplay(rows[0].product,8)).toBe('3.18');
 expect(quantityDisplay(rows[1].rm,8)).toBe('4');expect(quantityDisplay(rows[2].rm,8)).toBe('2');
 expect(rows.map(row=>quantityDisplay(row.rmWithoutLoss,8))).toEqual(['3.24','3.6','1.8','2']);
 expect(rows.map(row=>quantityDisplay(row.lossPct,8))).toEqual(['10','10','10','0']);
});

test('before-loss RM stays available when the loss is unknown and missing raw prices stay incomplete',()=>{
 const i=inputs();i.ProcessLosses=[{Path:'0/1',Ratios:['10'],Formula:'L1'}];
 const rows=recipeRows(i,tree,grades,[]);
 expect(quantityDisplay(rows[0].rmWithoutLoss,8)).toBe('3.24');
 expect(rows[0].rm).toBeNull();
 expect(rows[0].lossPct).toBeNull();expect(rows[1].lossPct).toBeNull();
 expect(quantityDisplay(rows[3].lossPct,8)).toBe('0');
 expect(quantityDisplay(costs(i,grades,[]).rmWithoutLoss,8)).toBe('2.248');
 i.Prices=i.Prices.filter(price=>price.Path!=='0/1/2');
 const incomplete=recipeRows(i,tree,grades,[]);
 expect(incomplete[0].rmWithoutLoss).toBeNull();
 expect(costs(i,grades,[]).rmWithoutLoss).toBeNull();
 expect(incomplete[2].rmWithoutLoss).toBeNull();
 expect(quantityDisplay(incomplete[1].rmWithoutLoss,8)).toBe('3.6');
});

test('custom Process Loss is unknown until tested and becomes stale after ratio, formula or NW changes',()=>{
 const i=inputs();i.ProcessLosses=[{Path:'0/1',Ratios:['10'],Formula:'1-(1-L1)*(1-2/NW)'}];i.ProcessLossWeight='100';
 expect(processLossValue(i,'0/1')).toBeNull();
 i.ProcessLossResults=[{Path:'0/1',Ratios:['10'],Formula:i.ProcessLosses[0].Formula,LossPct:'11.8',WeightGrams:'100.000000'}];
 expect(quantityDisplay(processLossValue(i,'0/1'),8)).toBe('11.8');
 expect(processLossValue({...i,ProcessLossWeight:'200'},'0/1')).toBeNull();
 expect(processLossValue({...i,ProcessLosses:[{...i.ProcessLosses[0],Ratios:['11']}]},'0/1')).toBeNull();
 expect(processLossValue({...i,ProcessLosses:[{...i.ProcessLosses[0],Formula:'L1'}]},'0/1')).toBeNull();
});

test('parent loss matches the cost-implied change across differently priced child grades',()=>{
 const items=tree.map(g=>({...g,Process:g.ParentID==='0/1'})),leaves=classifyProcessLeaves(items,grades),i=inputs();
 i.ProcessLosses=[{Path:'0/1/1',Ratios:['10']},{Path:'0/1/2',Ratios:['20']}];
 const rows=recipeRows(i,items,leaves,[]);
 expect(quantityDisplay(rows[0].rmWithoutLoss,8)).toBe('3.24');expect(quantityDisplay(rows[0].rm,8)).toBe('3.65');
 expect(quantityDisplay(rows[0].lossPct,8)).toBe('11.23287671');
 expect(rows.slice(1).map(row=>quantityDisplay(row.lossPct,8))).toEqual(['10','20','0']);
});

test('100% loss remains unknown rather than producing Infinity or zero cost',()=>{
 const i=inputs();i.ProcessLosses=[{Path:'0/1',Ratios:['100']}];
 expect(costs(i,grades,[]).rm).toBeNull();expect(costs(i,grades,[]).product).toBeNull();
});

test('Recipe loss percentages use complete per-grade formulas without requiring a raw price',()=>{
 const items=tree.map(g=>({...g,Process:g.ParentID==='0/1'})),leaves=classifyProcessLeaves(items,grades);
 const i:TCBInputs={...defaultInputs(),ProcessLossMode:'GradePath',ProcessLossLayout:'Aligned',ProcessLosses:[{Path:'0/1/1',Ratios:['5']},{Path:'0/1/2',Ratios:['0']},{Path:'0',Ratios:['2']}],ProcessLossFormulas:{'0/1/1':'L1+L2','0/1/2':'L1+L2','0/2':'L2'},ProcessLossResults:[{Path:'0/1/1',Ratios:['5','2'],Formula:'L1+L2',LossPct:'7'},{Path:'0/1/2',Ratios:['0','2'],Formula:'L1+L2',LossPct:'2'},{Path:'0/2',Ratios:['0','2'],Formula:'L2',LossPct:'2'}]};
 const rows=recipeRows(i,items,leaves,[]);
 expect(rows[0].lossPct).toBeNull(); // Different child losses have no single calculated parent result.
 expect(rows.slice(1).map(row=>quantityDisplay(row.lossPct,6))).toEqual(['7','2','2']);
 expect(rows.every(row=>row.rm===null)).toBe(true);
 const zero:TCBInputs={...i,ProcessLosses:i.ProcessLosses!.map(row=>({...row,Ratios:row.Ratios.map(()=>'0')})),ProcessLossResults:i.ProcessLossResults!.map(row=>({...row,Ratios:['0','0'],LossPct:'0'}))};
 expect(recipeRows(zero,items,leaves,[]).map(row=>quantityDisplay(row.lossPct,6))).toEqual(['0','0','0','0']);
 const stale={...i,ProcessLosses:i.ProcessLosses!.map(row=>row.Path==='0'?{...row,Ratios:['3']}:row)};
 expect(recipeRows(stale,items,leaves,[]).every(row=>row.lossPct===null)).toBe(true);
});
