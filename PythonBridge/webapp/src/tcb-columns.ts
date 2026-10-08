// Read-only saved TCB Analysis columns, in calculation order.
export const tcbColumnGroups:{title:string;subgroup:string;fields:Record<string,string>}[]=[
 {
  "title": "TCB Review",
  "subgroup": "FOB Costing",
  "fields": {
   "TCBProductPerUnit": "Product ($/unit)",
   "TCBSelfPackagingPerUnit": "Self Packaging ($/unit)",
   "TCBParentPackagingPerUnit": "Parent Packaging ($/unit)",
   "TCBPalletPerUnit": "Pallet ($/unit)",
   "TCBPackingPerUnit": "Packing ($/unit)",
   "TCBInitialDesignPerUnit": "Initial Design ($/unit)",
   "TCBFixedCostsPerUnit": "Fixed costs ($/unit)",
   "TCBFobbingPerUnit": "Fobbing fee ($/unit)",
   "TCBInterestPerUnit": "Interest ($/unit)",
   "TCBMarginPerUnit": "Margin ($/unit)",
   "TCBFOBPerUnit": "FOB ($/unit)",
   "TCBFOBCustomerPerUnit": "FOB (customer currency/unit)"
  }
 },
 {
  "title": "TCB Review",
  "subgroup": "Destination Logistics",
  "fields": {
   "TCBFreightPerUnit": "Freight ($/unit)",
   "TCBDutyPerUnit": "Duty ($/unit)",
   "TCBClearancePerUnit": "Dest. Clearance ($/unit)",
   "TCBHaulagePerUnit": "Dest. Haulage (Port-WH) ($/unit)",
   "TCBDestinationWHPerUnit": "WH Cost (dest.) ($/unit)",
   "TCBDamagePerUnit": "Overage, Shortage & Damage ($/unit)"
  }
 },
 {
  "title": "TCB Review",
  "subgroup": "Co-Man & Fees",
  "fields": {
   "TCBWHToCoManPerUnit": "WH - Co-Man WH ($/unit)",
   "TCBCoManOverheadPerUnit": "Co-Man Overhead ($/unit)",
   "TCBFreightToCustomerPerUnit": "Freight to Customer ($/unit)",
   "TCBSpoilagePerUnit": "Spoilage Allowance ($/unit)",
   "TCBPaymentTermPerUnit": "Payment Term ($/unit)",
   "TCBCoManFeePerUnit": "Co-Man fee ($/unit)",
   "TCBBrokerFeePerUnit": "Broker Fee ($/unit)"
  }
 },
 {
  "title": "TCB Review",
  "subgroup": "Selling Totals",
  "fields": {
   "TCBCFRPerUnit": "CFR ($/unit)",
   "TCBDDPPerUnit": "DDP ($/unit)",
   "TCBDDPCustomerPerUnit": "DDP (customer currency/unit)"
  }
 }
];
export const tcbColumnLabels:Record<string,string>=Object.assign({},...tcbColumnGroups.map(g=>g.fields));

export function tcbHeaders(columns:string[]){
 const result:{label:string;span:number}[]=[];
 for(const key of columns){
  const label=tcbColumnGroups.find(g=>key in g.fields)?.subgroup??'Product Info',previous=result.at(-1);
  if(previous?.label===label)previous.span++;else result.push({label,span:1});
 }
 return result;
}
