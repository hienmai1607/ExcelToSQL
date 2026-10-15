export type SavedLoadPlan={ID:number;ContainerID?:number;Code?:string;Inputs:{carton_kg?:number|null;pallet_kg?:number|null;mode:string;max_pallet_height:number;carton:{length:number;width:number;height:number};pallet:{length:number;width:number;height:number}|null};Result:{gross_kg?:number|null;pallet_layers:number;cartons_per_pallet:number;floor_positions:number;loaded_units:number;loaded_unit_height:number;cartons:number;cartons_per_layer:number}};
export function savedLoadPlan(value:unknown):SavedLoadPlan|null{try{const p=typeof value==='string'?JSON.parse(value):value;return p?.ID&&p?.Inputs&&p?.Result?p:null}catch{return null}}

export function containerPlans(value:unknown):Record<string,SavedLoadPlan>{
 try{const p=typeof value==='string'?JSON.parse(value||'[]'):value;if(Array.isArray(p))return Object.fromEntries(p.filter(x=>x.Code&&x.ID).map(x=>[x.Code,x]));return p&&typeof p==='object'?p:{}}catch{return {}}
}
