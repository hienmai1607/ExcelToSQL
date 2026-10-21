"""Grade-scoped loss formulas. Ratios are percentages; formulas return decimal loss."""
from decimal import Decimal
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field

class GradeProcessLoss(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Path: str = Field(pattern=r"^0(?:/[1-9][0-9]{0,3}){1,12}$")
    Ratios: list[Annotated[Decimal, Field(ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)]] = Field(default_factory=list,max_length=100)
    Formula: str | None = Field(None,max_length=200)

def process_loss_results(rows,code_count,weight=None):
    from dimension_formula import _calculate
    results=[]
    for row in rows or []:
        if len(row.Ratios)!=code_count:
            raise ValueError("Each Process grade needs one ratio for every loss code.")
        values={"L"+str(i+1):ratio/100 for i,ratio in enumerate(row.Ratios)}
        if weight is not None and Decimal(str(weight))>0:
            values["NW"]=Decimal(str(weight))
        if row.Formula and row.Formula.strip():
            loss=_calculate(row.Formula,values,"Process loss",True,values,True)
        else:
            surviving=Decimal(1)
            for ratio in row.Ratios:surviving*=1-ratio/100
            loss=(1-surviving)*100
        if not 0<=loss<100:
            raise ValueError("Process loss must be below 100% to leave a positive yield.")
        results.append({**row.model_dump(mode="json"),"LossPct":str(loss),"WeightGrams":str(weight) if weight is not None else None})
    return results
