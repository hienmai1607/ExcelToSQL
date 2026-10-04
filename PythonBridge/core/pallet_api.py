"""Pallet writes. SQL owns conversion validation, permissions and concurrency."""
import json
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import Field, model_validator, field_validator
from pallet_fields import PALLET_CAPACITY_LABELS
from auth import AccessContext, get_access_context
from packaging_api import Input, MasterRow, execute, require, rv

router = APIRouter(prefix="/api/packaging/pallet", tags=["Pallet Master"])


class PalletRow(MasterRow):
    UnitOfMeasure: str | None = Field(None, max_length=40)
    Width: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=4)
    Length: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=4)
    PalletsPer20DC: int | None = Field(None, ge=0, le=2147483647)
    PalletsPer40DC: int | None = Field(None, ge=0, le=2147483647)
    PalletsPer40HC: int | None = Field(None, ge=0, le=2147483647)
    PalletsPer20RC: int | None = Field(None, ge=0, le=2147483647)
    PalletsPer40RHC: int | None = Field(None, ge=0, le=2147483647)
    Status: Literal["Active", "Block"] | None = None

    @field_validator(*PALLET_CAPACITY_LABELS, mode="before")
    @classmethod
    def whole_counts(cls, value):
        if isinstance(value, bool):
            raise ValueError("Pallet/container counts must be whole numbers, not True/False.")
        return value

    @model_validator(mode="after")
    def identity(self):
        if self.Command == "C" and (self.ID is not None or self.RowVersion is not None):
            raise ValueError("Create cannot have an ID or RowVersion.")
        if self.Command != "C" and self.ID is None:
            raise ValueError("Update/block requires ID.")
        if self.Command != "D" and (not (self.UnitOfMeasure or "").strip() or self.Width is None or self.Length is None):
            raise ValueError("UoM, Width and Length are required.")
        rv(self.RowVersion, self.Command != "C")
        return self


class PalletBatch(Input):
    rows: list[PalletRow] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique(self):
        ids = [r.ID for r in self.rows if r.ID is not None]
        if len(set(ids)) != len(ids) or len({r.RowNum for r in self.rows}) != len(self.rows):
            raise ValueError("Duplicate RowNum or record ID.")
        return self


@router.post("/batch")
def pallet_save(payload: PalletBatch, ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Packaging")
    documents = []
    for row in payload.rows:
        data = row.model_dump(mode="json")
        # Omitted values from older clients preserve counts; explicit null clears them.
        for key in PALLET_CAPACITY_LABELS:
            if key not in row.model_fields_set:
                data.pop(key, None)
        version = rv(data.pop("RowVersion"), row.Command != "C")
        data["RowVersionHex"] = "0x" + version.hex() if version else None
        documents.append(data)
    return {"results": execute("EXEC dbo.usp_Pallet_Batch ?,?;", [json.dumps(documents), ctx.username])[0]}
