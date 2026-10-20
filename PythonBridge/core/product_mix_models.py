"""Shared contracts for an initial mix and later version edits."""
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class MixItem(BaseModel):
    model_config=ConfigDict(extra="forbid")
    ProductID:int=Field(ge=1)
    UnitQuantity:Decimal=Field(gt=0,max_digits=12,decimal_places=4,allow_inf_nan=False)
    RowVersion:str

class InitialMix(BaseModel):
    model_config=ConfigDict(extra="forbid")
    Status:Literal["Draft","Active"]="Active"
    items:list[MixItem]=Field(min_length=1,max_length=500)

    @model_validator(mode="after")
    def distinct_children(self):
        if len({item.ProductID for item in self.items})!=len(self.items):
            raise ValueError("Duplicate child Product.")
        return self
