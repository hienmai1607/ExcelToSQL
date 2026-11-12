import {quantity,add,multiply,divide,type Fraction} from './packaging-summary-model';
import type {RecipeLine} from './npd-model';
export type LevelIngredient={IngredientID:number|null;RatioPct:string};
export type RecipeLevel={ProcessName:string;OutputName:string;BaseRatioPct:string;Ingredients:LevelIngredient[]};
export type NutRecipe={GradePath:string;BlendRatioPct:string;Levels:RecipeLevel[]};
export type RecipeDetails={Version:1;Nuts:NutRecipe[]};
const q=(value:unknown)=>quantity(value,true)??{n:0n,d:1n};
const hundred=q('100');
export function rounded(value:Fraction,places=6){const scale=10n**BigInt(places),n=(value.n*scale*2n/value.d+1n)/2n;return String(n/scale)+(places?'.'+String(n%scale).padStart(places,'0'):'')}
export function levelTotal(level:RecipeLevel){return rounded(level.Ingredients.reduce((sum,row)=>add(sum,q(row.RatioPct)),q(level.BaseRatioPct)))}
export function detailsFromFlat(lines:RecipeLine[]):RecipeDetails{
 const raw=lines.filter(r=>r.Kind==='Raw'),total=raw.reduce((sum,row)=>add(sum,q(row.RatioPct)),q(0));
 return {Version:1,Nuts:raw.map(row=>({GradePath:row.GradePath!,BlendRatioPct:rounded(total.n?multiply(divide(q(row.RatioPct),total),hundred):divide(hundred,q(raw.length))),Levels:[{ProcessName:'',OutputName:'',BaseRatioPct:rounded(total),Ingredients:lines.filter(r=>r.Kind==='Seasoning').map(r=>({IngredientID:r.IngredientID,RatioPct:r.RatioPct}))}]}))};
}
export function flattenDetails(details:RecipeDetails,pricing:RecipeLine[]):RecipeLine[]{
 const exact=new Map<string,{ratio:Fraction;line:RecipeLine}>();
 const base=(kind:'Raw'|'Seasoning',path:string|null,id:number|null):RecipeLine=>({Kind:kind,GradePath:path,IngredientID:id,RatioPct:'0',LossPct:'0',PriceID:null,PriceMode:'Auto'});
 const insert=(key:string,ratio:Fraction,line:RecipeLine)=>{const old=exact.get(key);exact.set(key,{line:old?.line??line,ratio:add(old?.ratio??q(0),ratio)})};
 for(const nut of details.Nuts){
  let carry=divide(q(nut.BlendRatioPct),hundred);
  for(let index=nut.Levels.length-1;index>=0;index--){const level=nut.Levels[index];
   level.Ingredients.forEach((row,i)=>insert(row.IngredientID?'I:'+row.IngredientID:'Missing:'+nut.GradePath+':'+index+':'+i,multiply(carry,q(row.RatioPct)),base('Seasoning',null,row.IngredientID)));
   carry=multiply(carry,divide(q(level.BaseRatioPct),hundred));
  }
  insert('R:'+nut.GradePath,multiply(carry,hundred),base('Raw',nut.GradePath,null));
 }
 const keys=[...exact.keys()].sort((a,b)=>{const x=exact.get(a)!.line,y=exact.get(b)!.line;if(x.Kind!==y.Kind)return x.Kind==='Raw'?-1:1;if(x.Kind==='Raw')return details.Nuts.findIndex(n=>n.GradePath===x.GradePath)-details.Nuts.findIndex(n=>n.GradePath===y.GradePath);return String(x.IngredientID??a).localeCompare(String(y.IngredientID??b),'en',{numeric:false})});
 const rows=keys.map(key=>{const value=exact.get(key)!;const old=pricing.find(r=>r.Kind===value.line.Kind&&(r.Kind==='Raw'?r.GradePath===value.line.GradePath:r.IngredientID===value.line.IngredientID));return {...old,...value.line,...(old?{...old}:{}),RatioPct:rounded(value.ratio)}});
 const total=[...exact.values()].reduce((sum,row)=>add(sum,row.ratio),q(0));
 if(total.n===100n*total.d&&rows.length){let largest=0;keys.forEach((key,index)=>{const a=exact.get(key)!.ratio,b=exact.get(keys[largest])!.ratio;if(a.n*b.d>b.n*a.d)largest=index});const units=rows.map(row=>BigInt(row.RatioPct.replace('.',''))),delta=100000000n-units.reduce((a,b)=>a+b,0n),n=units[largest]+delta;rows[largest].RatioPct=String(n/1000000n)+'.'+String(n%1000000n).padStart(6,'0')}
 return rows;
}
