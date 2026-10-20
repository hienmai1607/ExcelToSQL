import {editableProcessTree,classifyProcessLeaves} from './grade-process';
import type {Row} from './api';
import type {Draft} from './opportunity-losses';
import {objectValue,quantityDisplay} from './packaging-summary-model';
import {defaultInputs,manualCostInputs,type TCBInputs,type TCBGrade} from './tcb-model';
import {migrateLossProcesses,lossTotals,processOptions,type LossStep} from './loss-processes';
import {parseGradeSnapshot} from './opportunity-grade-snapshot';
export type TCBVersion={ID:number;Version:number;Name:string;IsActive:boolean;RowVersion:string};
export type TCBData={item:Row;saved:Record<string,unknown>;lossMasters:LossStep[];grades:TCBGrade[];prices:Row[]};
export type VersionReply={version:TCBVersion;tcb:TCBData;rows:(Row&{TCBContext?:TCBData})[]};
export type ComparisonReply={rows:Row[];entries:{ItemID:number;tcb:TCBData}[]};
export function draftFromTCB(row:Row,next:TCBData,tcbVersion?:TCBVersion):Draft{
 const inputs=objectValue(next.saved.Inputs) as TCBInputs,mix=!!next.item.IsMixParent,layers=Number(next.item.LossLayerCount??row.ResponseLayerCount??row.RequestedLayerCount??row.PackagingLayerCount??1);
 const old=migrateLossProcesses(inputs),totals=lossTotals(old);
 const product=(s:LossStep)=>s.ProcessType==='Processing'||s.ProcessType==='Sorting';
 const steps=[...(!mix?old.filter(product).map((s,i)=>({...s,ProcessType:'Processing' as const,Sequence:i+1})):[]),...processOptions(mix,layers).filter(([t])=>t!=='Sorting'&&t!=='Processing').map(([t])=>({ProcessType:t,Sequence:1,LossPct:quantityDisplay(totals[t.replace('Packaging','LossPct') as keyof typeof totals],2).replaceAll(',','')}))];
 const grades=editableProcessTree(parseGradeSnapshot(next.item.ProductGradeSnapshot??row.ProductGradeSnapshot)?.items??[]),selections=Array.isArray(inputs.Prices)?inputs.Prices:[];
 const d:Draft={tcbVersion,grades,baselineGrades:JSON.stringify(grades),selections,baselinePrices:JSON.stringify(selections),quoteGrades:grades.length?classifyProcessLeaves(grades,next.grades??[]):next.grades??[],quotes:next.prices??[],costingInputs:{...defaultInputs(),...inputs},baselineCosts:JSON.stringify(manualCostInputs({...defaultInputs(),...inputs})),pricingGradeKey:JSON.stringify(grades),gradeLocked:!next.item.InactiveTCBVersion&&!!(next.item.HasOpenPackagingRequest??row.HasOpenPackagingRequest),row:{...row,...('WeightGrams' in next.item?{WeightGrams:next.item.WeightGrams}:{}),...('DefaultPalletUSDPerEA' in next.item?{DefaultPalletUSDPerEA:next.item.DefaultPalletUSDPerEA}:{})},version:String(next.item.RowVersion),mix,readonly:next.item.ItemStage!=='Draft'||next.item.HeaderStage!=='Draft',layers,masters:next.lossMasters??[],steps,formula:mix?'':String(inputs.ProductLossFormula??''),baseline:''};
 d.baseline=JSON.stringify({steps:d.steps,formula:d.formula,grades:d.grades,selections:d.selections,costs:manualCostInputs(d.costingInputs)});
 return d;
}
export function contextDrafts(reply:ComparisonReply){
 return reply.entries.map(entry=>draftFromTCB(reply.rows.find(r=>Number(r.ItemID)===entry.ItemID)??{ItemID:entry.ItemID},entry.tcb));
}
