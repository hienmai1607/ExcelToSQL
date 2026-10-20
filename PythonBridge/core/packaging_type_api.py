"""Packaging Type Master batch writes; SQL owns roles and concurrency."""
import json
from typing import Literal, Annotated
from fastapi import APIRouter, Depends
from pydantic import Field, field_validator, model_validator
from auth import AccessContext, get_access_context
from packaging_api import Input, MasterRow, execute, require, rv

router = APIRouter(prefix="/api/packaging/type", tags=["Packaging Type Master"])


class PackagingTypeRow(MasterRow):
    ParentTypeID: int | None = Field(None, ge=1, le=2147483647)
    ParentTypeIDs: list[Annotated[int, Field(strict=True, ge=1, le=2147483647)]] | None = Field(None, max_length=100)
    Shipping: bool = Field(False, strict=True)
    FinalComponent: bool = Field(False, strict=True)
    CopyDim: bool = Field(False, strict=True)
    PackagingOrder: Literal["Primary", "Secondary", "Tertiary", "Pallet"] | None = None
    PackagingOrders: list[Literal["Primary", "Secondary", "Tertiary", "Primary Mix", "Secondary Mix", "Tertiary Mix", "Pallet"]] | None = Field(None,max_length=7)
    PackagingType: str | None = Field(None, max_length=100)
    PriceBasis: Literal["Count", "Square meter", "Volume"] | None = None
    Status: Literal["Active", "Block"] | None = None

    @field_validator("PackagingType")
    @classmethod
    def trimmed_name(cls, value):
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def identity(self):
        if "ParentTypeIDs" in self.model_fields_set:
            if self.ParentTypeIDs is None or len(set(self.ParentTypeIDs)) != len(self.ParentTypeIDs):
                raise ValueError("Choose distinct Parent Types, or an empty list for a root type.")
            if self.ID in self.ParentTypeIDs:
                raise ValueError("A Packaging Type cannot be its own parent.")
            if "ParentTypeID" in self.model_fields_set and self.ParentTypeID != (self.ParentTypeIDs[0] if self.ParentTypeIDs else None):
                raise ValueError("Use ParentTypeIDs without a conflicting legacy ParentTypeID.")
            self.ParentTypeID = self.ParentTypeIDs[0] if self.ParentTypeIDs else None
            self.model_fields_set.add("ParentTypeID")
        if self.Command == "C" and (self.ID is not None or self.RowVersion is not None):
            raise ValueError("Create cannot have an ID or RowVersion.")
        if self.Command != "C" and self.ID is None:
            raise ValueError("Update/block requires ID.")
        if self.PackagingOrders and len(set(self.PackagingOrders))!=len(self.PackagingOrders):
            raise ValueError("Select each packaging order only once.")
        if self.ParentTypeID is not None and self.Shipping:
            raise ValueError("Shipping applies only to root Packaging Types.")
        if self.Command == "C" or "FinalComponent" in self.model_fields_set and "ParentTypeID" in self.model_fields_set:
            self.CopyDim = self.FinalComponent and self.ParentTypeID is None
            self.model_fields_set.add("CopyDim")
        known_root = self.ParentTypeID is None and (self.Command == "C" or "ParentTypeID" in self.model_fields_set)
        if known_root and "PackagingOrders" in self.model_fields_set and not self.PackagingOrders and self.Command!="D":
            raise ValueError("Select at least one packaging order.")
        if known_root and self.PackagingOrders and self.PackagingOrder and self.PackagingOrder not in [order.replace(" Mix","") for order in self.PackagingOrders]:
            raise ValueError("Legacy Order must belong to the selected packaging orders.")
        if self.Command != "D" and ((known_root and not (self.PackagingOrder or self.PackagingOrders)) or not self.PackagingType):
            raise ValueError("Packaging layer selection and Packaging Type are required.")
        if self.PackagingOrder == "Pallet" or "Pallet" in (self.PackagingOrders or []):
            if self.ParentTypeID or not self.FinalComponent or (self.PackagingType=='Pallet' and not self.CopyDim) or self.Shipping or any(o != "Pallet" for o in self.PackagingOrders or []):
                raise ValueError("Palletization requires root Single types without Shipping or other orders; Type Pallet also requires Copy Dim.")
        rv(self.RowVersion, self.Command != "C")
        return self


class PackagingTypeBatch(Input):
    rows: list[PackagingTypeRow] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique(self):
        ids = [r.ID for r in self.rows if r.ID is not None]
        if len(set(ids)) != len(ids) or len({r.RowNum for r in self.rows}) != len(self.rows):
            raise ValueError("Duplicate RowNum or record ID.")
        return self


@router.post("/batch")
def packaging_type_save(payload: PackagingTypeBatch, ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Packaging")
    documents = []
    for row in payload.rows:
        data = row.model_dump(mode="json", exclude_unset=True)
        version = rv(data.pop("RowVersion", None), row.Command != "C")
        data["RowVersionHex"] = "0x" + version.hex() if version else None
        documents.append(data)
    return {"results": execute("EXEC dbo.usp_PackagingType_Batch ?,?;", [json.dumps(documents), ctx.username])[0]}
