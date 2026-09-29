"""Versioned Product grade trees with exact per-parent percentage validation."""
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class GradeItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    ParentID: str = Field(pattern=r"^0(?:/[1-9][0-9]{0,3}){0,11}$", max_length=60)
    ID: int = Field(ge=1, le=9999)
    RawGradeID: int | None = Field(None, ge=1)
    Grade: str = Field(min_length=1, max_length=100)
    RatioPct: Decimal = Field(gt=0, le=100, max_digits=5, decimal_places=2, allow_inf_nan=False)

    @property
    def path(self):
        return f"{self.ParentID}/{self.ID}"


class GradeTree(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[GradeItem] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def valid_tree(self):
        paths = {i.path for i in self.items}
        if len(paths) != len(self.items):
            raise ValueError("Duplicate grade ID under the same parent.")
        totals = {}
        for item in self.items:
            if item.ParentID != "0" and item.ParentID not in paths:
                raise ValueError(f"Parent {item.ParentID} does not exist.")
            totals[item.ParentID] = totals.get(item.ParentID, Decimal(0)) + item.RatioPct
        for parent, total in totals.items():
            if total != Decimal(100):
                raise ValueError(f"Ratios under parent {parent} must total 100% (currently {total}%).")
        return self


class GradeSave(GradeTree):
    VersionID: int | None = Field(None, ge=1)
    RowVersion: str | None = None
    ProductRowVersion: str
    Status: Literal["Draft", "Active"] = "Draft"

    @model_validator(mode="after")
    def version_token(self):
        if bool(self.VersionID) != bool(self.RowVersion):
            raise ValueError("Version ID and RowVersion must be supplied together.")
        return self


class InitialGrade(GradeTree):
    Status: Literal["Draft", "Active"] = "Draft"
