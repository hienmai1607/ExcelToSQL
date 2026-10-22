// These costs belong to each child; every other shipment cost stays on the Mix parent.
export const childOtherKeys=new Set(['PackingUSDPerLb','InitialDesignUSD','InitialDesignCustomer','OtherFixedCostsUSD','InterestPct','InterestDays','InterestMonths','MarginPct','MarginMode','MarginUSDPerLb']);
export type ShipmentScope='all'|'mix-parent'|'child-others';
export function scopedShipment(values:Record<string,string>,scope:ShipmentScope='all'){
 return Object.fromEntries(Object.entries(values).filter(([key])=>scope==='all'||(scope==='child-others'?childOtherKeys.has(key)||key==='InitialDesignMode':!childOtherKeys.has(key)&&key!=='InitialDesignMode')));
}
