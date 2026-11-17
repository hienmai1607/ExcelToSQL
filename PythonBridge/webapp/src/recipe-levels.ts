import {quantity,add,multiply,divide,type Fraction} from './packaging-summary-model';
import type {RecipeLine} from './npd-model';
import type {Row} from './api';
export type LevelIngredient={IngredientID:number|null;RatioPct:string};
export type RecipeLevel={ProcessName:string;ProcessTypeID?:number|null;LossPct?:string;OutputName:string;BaseRatioPct:string;Ingredients:LevelIngredient[]};
export const emptyLevel=():RecipeLevel=>({ProcessName:'',ProcessTypeID:null,LossPct:'0',OutputName:'',BaseRatioPct:'100',Ingredients:[]});
export type NutRecipe={GradePath:string;BlendRatioPct:string;Levels:RecipeLevel[]};
export type RecipeDetails={Version:1;Nuts:NutRecipe[]};
const q=(value:unknown)=>quantity(value,true)??{n:0n,d:1n};
const hundred=q('100');
export function rounded(value:Fraction,places=6){const scale=10n**BigInt(places),n=(value.n*scale*2n/value.d+1n)/2n;return String(n/scale)+(places?'.'+String(n%scale).padStart(places,'0'):'')}
/** Loss Process Master default: the exact nut grade first, otherwise its All grades row, otherwise 0. */
export function defaultLevelLoss(defaults:Row[]|undefined,rawGradeID:unknown,processTypeID:number|null){
 if(!processTypeID)return '0';
 const rows=(defaults??[]).filter(r=>Number(r.ProcessTypeID)===processTypeID);
 const match=rows.find(r=>rawGradeID!=null&&Number(r.RawGradeID)===Number(rawGradeID))??rows.find(r=>r.RawGradeID==null);
 return match?String(match.LossPct):'0';
}
export function levelTotal(level:RecipeLevel){return rounded(level.Ingredients.reduce((sum,row)=>add(sum,q(row.RatioPct)),q(level.BaseRatioPct)))}
export function detailsFromFlat(lines:RecipeLine[]):RecipeDetails{
 const raw=lines.filter(r=>r.Kind==='Raw'),total=raw.reduce((sum,row)=>add(sum,q(row.RatioPct)),q(0));
 return {Version:1,Nuts:raw.map(row=>({GradePath:row.GradePath!,BlendRatioPct:rounded(total.n?multiply(divide(q(row.RatioPct),total),hundred):divide(hundred,q(raw.length))),Levels:[{...emptyLevel(),BaseRatioPct:rounded(total),Ingredients:lines.filter(r=>r.Kind==='Seasoning').map(r=>({IngredientID:r.IngredientID,RatioPct:r.RatioPct}))}]}))};
}
// Mirrors core/recipe_levels.flatten: a level's loss applies to everything entering it, so earlier-level
// material compounds through later yields. Line loss is derived; a manual BufferRatioPct stays user-owned.
export function flattenDetails(details:RecipeDetails,pricing:RecipeLine[]):RecipeLine[]{
 const exact=new Map<string,{ratio:Fraction;buffer:Fraction;line:RecipeLine}>();
 const base=(kind:'Raw'|'Seasoning',path:string|null,id:number|null):RecipeLine=>({Kind:kind,GradePath:path,IngredientID:id,RatioPct:'0',LossPct:'0',PriceID:null,PriceMode:'Auto'});
 const insert=(key:string,ratio:Fraction,factor:Fraction,line:RecipeLine)=>{const old=exact.get(key);exact.set(key,{line:old?.line??line,ratio:add(old?.ratio??q(0),ratio),buffer:add(old?.buffer??q(0),multiply(ratio,factor))})};
 for(const nut of details.Nuts){
  let carry=divide(q(nut.BlendRatioPct),hundred),factor=q(1);
  for(let index=nut.Levels.length-1;index>=0;index--){const level=nut.Levels[index],loss=q(level.LossPct??'0');
   factor=divide(factor,divide({n:100n*loss.d-loss.n,d:loss.d},hundred));
   level.Ingredients.forEach((row,i)=>insert(row.IngredientID?'I:'+row.IngredientID:'Missing:'+nut.GradePath+':'+index+':'+i,multiply(carry,q(row.RatioPct)),factor,base('Seasoning',null,row.IngredientID)));
   carry=multiply(carry,divide(q(level.BaseRatioPct),hundred));
  }
  insert('R:'+nut.GradePath,multiply(carry,hundred),factor,base('Raw',nut.GradePath,null));
 }
 const keys=[...exact.keys()].sort((a,b)=>{const x=exact.get(a)!.line,y=exact.get(b)!.line;if(x.Kind!==y.Kind)return x.Kind==='Raw'?-1:1;if(x.Kind==='Raw')return details.Nuts.findIndex(n=>n.GradePath===x.GradePath)-details.Nuts.findIndex(n=>n.GradePath===y.GradePath);return String(x.IngredientID??a).localeCompare(String(y.IngredientID??b),'en',{numeric:false})});
 const rows=keys.map(key=>{const value=exact.get(key)!;const old=pricing.find(r=>r.Kind===value.line.Kind&&(r.Kind==='Raw'?r.GradePath===value.line.GradePath:r.IngredientID===value.line.IngredientID));const loss=value.buffer.n?rounded(multiply(divide({n:value.buffer.n*value.ratio.d-value.ratio.n*value.buffer.d,d:value.buffer.n*value.ratio.d},q(1)),hundred)):'0.000000';return {...old,...value.line,...(old?{...old}:{}),RatioPct:rounded(value.ratio),LossPct:Number(loss)>=100?'99.999999':loss}});
 const total=[...exact.values()].reduce((sum,row)=>add(sum,row.ratio),q(0));
 if(total.n===100n*total.d&&rows.length){let largest=0;keys.forEach((key,index)=>{const a=exact.get(key)!.ratio,b=exact.get(keys[largest])!.ratio;if(a.n*b.d>b.n*a.d)largest=index});const units=rows.map(row=>BigInt(row.RatioPct.replace('.',''))),delta=100000000n-units.reduce((a,b)=>a+b,0n),n=units[largest]+delta;rows[largest].RatioPct=String(n/1000000n)+'.'+String(n%1000000n).padStart(6,'0')}
 return rows;
}
