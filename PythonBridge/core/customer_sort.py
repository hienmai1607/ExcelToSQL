"""Shared allow-listed Customer sorting for queries and saved layouts."""
import json
from typing import Literal, Annotated
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
Column = Literal["CustomerName","MarketCode","CurrencyCode","Status","UpdatedAt","CreatedAt","CreatedByName","UpdatedByName"]
class SortRule(BaseModel):
    model_config=ConfigDict(extra="forbid")
    column: Column
    direction: Literal["asc","desc"]="asc"
def unique_sort(rules):
    if len({r.column for r in rules})!=len(rules):
        raise ValueError("Sort columns must be unique.")
    return rules
def parse_sort(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        rules=TypeAdapter(Annotated[list[SortRule],Field(max_length=8)]).validate_json(value)
        unique_sort(rules)
    except (ValidationError,ValueError) as exc:
        raise HTTPException(422,"Invalid sort. Use up to eight unique Customer columns with asc or desc direction.") from exc
    return json.dumps([r.model_dump() for r in rules])

