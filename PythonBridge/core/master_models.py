"""Allow-listed packaging master layouts shared by profile and read endpoints."""
from typing import Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, model_validator
Entity=Literal["materials","prices","products","vendors","uoms"]
AUDIT={"CreatedAt":"Created at","CreatedByName":"Created by","UpdatedAt":"Updated at","UpdatedByName":"Updated by"}
COLUMNS={
 "uoms":{"UoMCode":"UoM code","UoMName":"UoM name","Status":"Status",**AUDIT},
 "vendors":{"VendorName":"Vendor name","Address":"Address","CurrencyCode":"Currency","Status":"Status",**AUDIT},
 "products":{"IsMix":"Product Mix","CustomerName":"Customer","Category":"Category","ProductCode":"Product code","ProductName":"Product name","WeightGrams":"Weight (g)","WeightOz":"Weight (oz)","Status":"Status",**AUDIT},
 "materials":{"MaterialCode":"Material code","MaterialName":"Material name","Description":"Description","UnitOfMeasure":"Base UoM","Status":"Status",**AUDIT},
 "prices":{"VendorName":"Vendor","MaterialCode":"Material","MaterialName":"Material name","CurrencyCode":"Vendor currency","ExchangeRateToUSD":"Exchange rate (Vendor currency per USD)","UnitUSDPrice":"Unit USD price","BaseUoM":"Price UoM","QuantityFrom":"Quantity from","QuantityTo":"Quantity to","UnitPrice":"Unit price (Vendor currency)","EffectiveFrom":"Effective from","EffectiveTo":"Effective to","Status":"Status",**AUDIT},
}
FILTERS={"uoms":{"search","status","created_by"},"vendors":{"search","status","created_by"},"products":{"search","status","created_by"},"materials":{"search","status","created_by"},"prices":{"search","status","material_id","currency_id","as_of","created_by"}}
PRODUCT_REQUIRED_COLUMNS=("CustomerName","ProductName","Category","WeightGrams")
MASTER_REQUIRED_COLUMNS={"uoms":("UoMCode",),"vendors":("VendorName",),
 "products":PRODUCT_REQUIRED_COLUMNS,
 "materials":("MaterialName","UnitOfMeasure"),
 "prices":("MaterialCode","CurrencyCode","BaseUoM","QuantityFrom","UnitPrice","EffectiveFrom")}
class MasterSort(BaseModel):
 model_config=ConfigDict(extra="forbid")
 column:str=Field(max_length=40)
 direction:Literal["asc","desc"]="asc"
ColumnWidth = Annotated[int, Field(ge=80, le=800, strict=True)]
class MasterLayout(BaseModel):
 column_widths: dict[str, ColumnWidth] = Field(default_factory=dict,max_length=64)
 model_config=ConfigDict(extra="forbid")
 columns:list[str]=Field(min_length=1,max_length=20)
 filters:list[str]=Field(max_length=6)
 values:dict[str,str]=Field(default_factory=dict,max_length=6)
 sort:list[MasterSort]=Field(default_factory=list,max_length=8)
 page_size:int=Field(25,ge=1,le=500)
def check_layout(entity,layout):
 # Upgrade saved profiles and existing download layouts when fields are retired.
 if entity=="products":
  layout.columns=[c for c in layout.columns if c not in ("Grade","MixRatioPct")]
  layout.sort=[s for s in layout.sort if s.column not in ("Grade","MixRatioPct")]
 if entity=="prices":
  layout.columns=list(dict.fromkeys("BaseUoM" if c=="PriceBasis" else c for c in layout.columns))
  for rule in layout.sort:
   if rule.column=="PriceBasis":rule.column="BaseUoM"
 allowed=COLUMNS[entity]
 if any(k not in allowed and k!="_Actions" for k in layout.column_widths):raise ValueError("Invalid column width key.")
 for keys in (layout.columns,[s.column for s in layout.sort]):
  if len(keys)!=len(set(keys)) or any(k not in allowed for k in keys):
   raise ValueError("Invalid or duplicate master column.")
 if len(layout.filters)!=len(set(layout.filters)) or any(k not in FILTERS[entity] for k in [*layout.filters,*layout.values]):
  raise ValueError("Invalid master filter.")
 if any(len(v)>200 for v in layout.values.values()):
  raise ValueError("Filter value is too long.")
 layout.columns=[*layout.columns,*[c for c in MASTER_REQUIRED_COLUMNS[entity] if c not in layout.columns]]
 return layout
