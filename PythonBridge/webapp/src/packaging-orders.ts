import type {Row} from './api';
export const packagingOrders=['Primary','Secondary','Tertiary'] as const;
export type PackagingOrder=typeof packagingOrders[number];
export function typeOrders(row:Row):string[]{return row.ParentTypeID!=null?[]:Array.isArray(row.PackagingOrders)?row.PackagingOrders.map(String):[String(row.PackagingOrder??'')]}
export function typeLabel(row:Row,separator=' / '){const orders=typeOrders(row).filter(Boolean).join(', ');return (orders?orders+separator:'')+String(row.PackagingType)}
export function supportsOrder(row:Row,order:string){return typeOrders(row).includes(order)}
export function layerCount(value:unknown){const n=Number(value??2);return [1,2,3].includes(n)?n:2}
export function shippingRequired(order:string,layers:unknown){const count=layerCount(layers);return count>=2&&order===packagingOrders[count-1]}
export function isMixParent(row:Row|undefined){return !!row&&!row.ParentItemID&&!!(row.IsMixParent||row.MixVersionID||row.ProductMixSnapshot||row.MixStructure)}
export function selectableType(row:Row,order:string,layers:unknown,mixChild=false,mixParent=false){const orders=typeOrders(row);return (mixParent?orders.some(o=>o==='Secondary'||o==='Tertiary'):orders.includes(order))&&(mixChild||!shippingRequired(order,layers)||row.Shipping===true||row.Shipping===1)}
export const responseOrderFields=[
 {order:'Primary',type:'FirstPMType',moq:'FirstPMMOQ',price:'PrimaryPricePerUnit',currency:'PrimaryPriceCurrencyCode'},
 {order:'Secondary',type:'SecondPMType',moq:'SecondPMMOQ',price:'SecondaryPricePerUnit',currency:'SecondaryPriceCurrencyCode'},
 {order:'Tertiary',type:'ThirdPMType',moq:'ThirdPMMOQ',price:'TertiaryPricePerUnit',currency:'TertiaryPriceCurrencyCode'}
] as const;
