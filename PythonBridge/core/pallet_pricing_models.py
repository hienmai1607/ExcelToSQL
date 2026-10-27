"""Shared bounded pallet input for calculator saves and atomic response copies."""
from decimal import Decimal
from pydantic import BaseModel, Field, ConfigDict


class Component(BaseModel):
    model_config=ConfigDict(extra="forbid")
    PriceID:int=Field(ge=1)
    RowVersion:str
    MaterialRowVersion:str
    Quantity:Decimal=Field(gt=0,le=100000,decimal_places=6,allow_inf_nan=False)
    AreaM2:Decimal|None=Field(None,gt=0,le=100000,decimal_places=9,allow_inf_nan=False)


class Selection(BaseModel):
    model_config=ConfigDict(extra="forbid")
    PalletSize:str=Field(max_length=100)
    components:list[Component]=Field(min_length=1,max_length=30)
    ItemRowVersion:str|None=None
    PalletMaterialID:int|None=Field(None,ge=1)
