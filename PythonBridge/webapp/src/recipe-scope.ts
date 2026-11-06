type ScopeRow=Record<string,unknown>;
type ScopeConfig={components:{ID:number;SystemKey:string}[];mappings:{ProcessID:number;ComponentID:number}[]};
export function approvedRecipe(row?:ScopeRow){try{return row?.NPDRecipeSnapshot?JSON.parse(String(row.NPDRecipeSnapshot)):null}catch{return null}}
export function seasoningProcess(master:{MasterID?:number|null;ProcessName?:string|null;RecipeComponents?:unknown},config:ScopeConfig|null|undefined){
 if(!config)return false;
 const ids=new Set(config.components.filter(c=>c.SystemKey==='Seasoning').map(c=>c.ID));
 return config.mappings.some(m=>m.ProcessID===master.MasterID&&ids.has(m.ComponentID));
}
export function seasoningAllowed(row:ScopeRow|undefined,path:string){
 if(path==='0')return false;
 const approved=approvedRecipe(row);
 if(approved&&!approved.Inactive&&!approved.Stale){
  const paths=approved.ApplicableGradePaths??approved.CapturedGrades?.filter((g:{ParentID:unknown})=>String(g.ParentID)==='0').map((g:{ID:unknown})=>'0/'+g.ID);
  return paths==null||paths.includes(path.split('/').slice(0,2).join('/'));
 }
 return !row?.RequiresRecipeConfirmation;
}
