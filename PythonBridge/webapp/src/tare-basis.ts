export function tareBasisLabel(basis:unknown,base:unknown){
 return (basis==='g'||basis==='kg'?basis+'/'+String(base||'Base UoM'):String(basis||'')).replace(/m2\b/g,'m²');
}
export function tareMassSelection(basis:string,base:string){
 if(basis==='g'||basis==='kg'||!basis)return basis;
 const [mass,unit]=basis.split('/');
 return unit?.toLowerCase()===base.toLowerCase()?mass:'legacy';
}
