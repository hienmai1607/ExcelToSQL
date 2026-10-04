import type {Row} from './api';
export const supplierLabels:Record<string,string>={SupplierDimensionID:'Supplier dimension ID',SupplierD1:'Supplier D1',SupplierD2:'Supplier D2',SupplierD3:'Supplier D3',SupplierAreaPerPriceUnit:'Supplier conversion / Price UoM'};
export function supplierChoices(materialID:string,materials:Row[],definitions:Row[]){
 const type=materials.find(m=>String(m.ID)===materialID)?.PackagingTypeID;
 return definitions.filter(d=>Number(d.PackagingTypeID)===Number(type)&&d.Status==='Active'&&!!d.ConvertFromSupplierFormula);
}
