import {test,expect} from '@playwright/test';
import {lossTotals,lossDisplay,lossError,processOptions,migrateLossProcesses,type LossStep} from '../src/loss-processes';
import {defaultInputs} from '../src/tcb-model';

test('losses compound by process sequence and remain separate per packaging layer',()=>{
 const steps:LossStep[]=[
  {ProcessType:'Processing',Sequence:2,LossPct:'10'},
  {ProcessType:'Sorting',Sequence:1,LossPct:'5'},
  {ProcessType:'PrimaryPackaging',Sequence:3,LossPct:'2'},
  {ProcessType:'PrimaryPackaging',Sequence:4,LossPct:'3'},
  {ProcessType:'SecondaryPackaging',Sequence:5,LossPct:'7'}];
 const result=lossTotals(steps);
 expect(lossDisplay(result.LossProductPct)).toBe('14.50%');
 expect(lossDisplay(result.PrimaryLossPct)).toBe('4.94%');
 expect(lossDisplay(result.SecondaryLossPct)).toBe('7.00%');
 expect(lossError(steps,processOptions(false,2))).toBe('');
 expect(lossError(steps,processOptions(false,1))).toContain('does not apply');
});
test('validation, Mix-layer options, zero/100 percent and legacy loss preservation',()=>{
 const options=processOptions(true,2);
 expect(options.map(([key])=>key)).toEqual(['MixPrimaryPackaging','MixSecondaryPackaging']);
 expect(lossError([{ProcessType:'Sorting',Sequence:1,LossPct:'5'}],options)).toContain('does not apply');
 expect(lossError([{ProcessType:'Sorting',Sequence:1,LossPct:'5'},{ProcessType:'Processing',Sequence:1,LossPct:'5'}],processOptions(false,1))).toContain('unique');
 expect(lossError([{ProcessType:'Sorting',Sequence:1,LossPct:'1.001'}],processOptions(false,1))).toContain('two decimals');
 expect(lossDisplay(lossTotals([{ProcessType:'Sorting',Sequence:1,LossPct:'100'}]).LossProductPct)).toBe('100.00%');
 expect(lossDisplay(lossTotals([]).LossProductPct)).toBe('0.00%');
 const migrated=migrateLossProcesses({...defaultInputs(),LossProductPct:'14.5',PrimaryLossPct:'2'});
 expect(migrated).toEqual([{ProcessType:'Processing',Sequence:1,LossPct:'14.5'},{ProcessType:'PrimaryPackaging',Sequence:2,LossPct:'2'}]);
 expect(lossDisplay(lossTotals(migrated).LossProductPct)).toBe('14.50%');
 expect(migrateLossProcesses({...defaultInputs(),LossProcesses:[]})).toEqual([]);
});
