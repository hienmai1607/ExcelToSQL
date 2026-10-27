export const warehouseFields=[['Unloading','Unloading'],['Palletize','Palletize'],['Inbound','Inbound'],['Outbound','Outbound'],['StorageCostPerMonth','Storage cost per month'],['StorageMonths','Storage month'],['OrderFeeAdminCost','Order fee/Admin cost'],['OthersCost','Others cost']] as const;
export function warehouseValues(raw:string){
 try{const value=JSON.parse(raw||'{}');return Object.fromEntries(warehouseFields.map(([key])=>[key,String(value?.[key]??'')]))}catch{return Object.fromEntries(warehouseFields.map(([key])=>[key,'']))}
}
export function warehouseTotal(values:Record<string,string>){
 const amounts:Record<string,bigint>={};
 for(const [key] of warehouseFields){const value=values[key]||'0';if(!/^\d{1,17}(\.\d{1,2})?$/.test(value))return null;const [whole,tail='']=value.split('.');amounts[key]=BigInt(whole)*100n+BigInt(tail.padEnd(2,'0'))}
 const fixed=warehouseFields.filter(([key])=>!['StorageCostPerMonth','StorageMonths'].includes(key)).reduce((sum,[key])=>sum+amounts[key],0n);
 const cents=fixed+(amounts.StorageCostPerMonth*amounts.StorageMonths+50n)/100n;
 return cents>9999999999999999999n?null:(cents/100n)+'.'+(cents%100n).toString().padStart(2,'0');
}
