"""Allow-listed packaging master layouts shared by profile and read endpoints."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
Entity=Literal["materials","prices","products"]
AUDIT={"CreatedAt":"Created at","CreatedByName":"Created by","UpdatedAt":"Updated at","UpdatedByName":"Updated by"}
COLUMNS={
 "products":{"ProductCode":"Product code","ProductName":"Product name","WeightGrams":"Weight (g)","WeightOz":"Weight (oz)","Status":"Status",**AUDIT},
 "materials":{"MaterialCode":"Material code","MaterialName":"Material name","Description":"Description","UnitOfMeasure":"Unit of measure","Status":"Status",**AUDIT},
 "prices":{"MaterialCode":"Material","MaterialName":"Material name","CurrencyCode":"Currency","PriceBasis":"Price basis","QuantityFrom":"Quantity from","QuantityTo":"Quantity to","UnitPrice":"Unit price","EffectiveFrom":"Effective from","EffectiveTo":"Effective to","Status":"Status",**AUDIT},
}
FILTERS={"products":{"search","status","created_by"},"materials":{"search","status","created_by"},"prices":{"search","status","material_id","currency_id","as_of","created_by"}}
class MasterSort(BaseModel):
 model_config=ConfigDict(extra="forbid")
 column:str=Field(max_length=40)
 direction:Literal["asc","desc"]="asc"
class MasterLayout(BaseModel):
 model_config=ConfigDict(extra="forbid")
 columns:list[str]=Field(min_length=1,max_length=14)
 filters:list[str]=Field(max_length=6)
 values:dict[str,str]=Field(default_factory=dict,max_length=6)
 sort:list[MasterSort]=Field(default_factory=list,max_length=8)
 page_size:int=Field(25,ge=1,le=500)
def check_layout(entity,layout):
 allowed=COLUMNS[entity]
 for keys in (layout.columns,[s.column for s in layout.sort]):
  if len(keys)!=len(set(keys)) or any(k not in allowed for k in keys):
   raise ValueError("Invalid or duplicate master column.")
 if len(layout.filters)!=len(set(layout.filters)) or any(k not in FILTERS[entity] for k in [*layout.filters,*layout.values]):
  raise ValueError("Invalid master filter.")
 if any(len(v)>200 for v in layout.values.values()):
  raise ValueError("Filter value is too long.")
 return layout
