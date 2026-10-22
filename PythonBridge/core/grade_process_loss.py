"""Grade-scoped loss formulas. Ratios are percentages; formulas return decimal loss."""
from decimal import Decimal
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, model_validator

class ProcessLossCode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    MasterID: int | None = Field(None,ge=1)
    MasterVersion: str | None = Field(None,pattern=r"^0x[0-9A-Fa-f]{16}$")
    ProcessName: str = Field(min_length=1,max_length=100)
    Shared: bool = False
    DefaultID: int | None = Field(None,ge=1)
    DefaultVersion: str | None = Field(None,pattern=r"^0x[0-9A-Fa-f]{16}$")

class GradeProcessLoss(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Path: str = Field(pattern=r"^0(?:/[1-9][0-9]{0,3}){0,12}$")
    Codes: list[ProcessLossCode] | None = Field(None,max_length=100)
    Ratios: list[Annotated[Decimal, Field(ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)]] = Field(default_factory=list,max_length=100)
    Formula: str | None = Field(None,max_length=200)

    @model_validator(mode="after")
    def unique_codes(self):
        if self.Codes is not None:
            if len(self.Codes)!=len(self.Ratios):
                raise ValueError("Each process stage needs one ratio per selected process type.")
            identities=[code.MasterID or code.ProcessName.strip().casefold() for code in self.Codes]
            if len(identities)!=len(set(identities)):
                raise ValueError("A process type cannot be duplicated within the same stage.")
        return self

def process_loss_results(rows,code_count,weight=None,*,targets=None,formulas=None,aligned=False):
    from dimension_formula import _calculate
    results=[]
    source=rows or []
    for row in source:
        if row.Codes is None and len(row.Ratios)!=code_count:
            raise ValueError("Each Process grade needs one ratio for every loss code.")
    if targets is not None:
        # Source stages own editable percentages; each target evaluates its complete path once.
        offsets={}
        for stage in sorted((r for r in source if r.Path!="0"),key=lambda r:len(r.Path.split("/")),reverse=True):
            offsets[stage.Path]=max((offsets[r.Path]+len(r.Ratios) for r in source if r.Path.startswith(stage.Path+"/")),default=0)
        offsets["0"]=max((offsets[r.Path]+len(r.Ratios) for r in source if r.Path!="0"),default=0)
        width=offsets["0"]+sum(len(r.Ratios) for r in source if r.Path=="0")
        projected=[]
        for path in sorted(set(targets),key=lambda p:tuple(map(int,p.split("/")))):
            chain=sorted((row for row in source if row.Path!="0" and (path==row.Path or path.startswith(row.Path+"/"))),key=lambda r:len(r.Path.split("/")),reverse=True)
            chain.extend(row for row in source if row.Path=="0")
            ratios=[value for row in chain for value in row.Ratios]
            codes=[code.model_dump(mode="json") for row in chain for code in row.Codes or []]
            if aligned:
                ratios=[Decimal(0)]*width;codes=[None]*width
                for stage in chain:
                    for i,value in enumerate(stage.Ratios):
                        slot=offsets[stage.Path]+i;ratios[slot]=value
                        if stage.Codes is not None:codes[slot]=stage.Codes[i].model_dump(mode="json")
            projected.append(dict(Path=path,Codes=codes,Ratios=[str(r) for r in ratios],Formula=(formulas or {}).get(path),_ratios=ratios))
        source=projected
    for row in source:
        if isinstance(row,dict):
            capture={k:v for k,v in row.items() if k!="_ratios"}
            ratios=row["_ratios"];formula=row["Formula"]
        else:
            capture=row.model_dump(mode="json");ratios=row.Ratios;formula=row.Formula
        values={"L"+str(i+1):ratio/100 for i,ratio in enumerate(ratios)}
        if weight is not None and Decimal(str(weight))>0:
            values["NW"]=Decimal(str(weight))
        if formula and formula.strip():
            loss=_calculate(formula,values,"Process loss",True,values,True)
        else:
            surviving=Decimal(1)
            for ratio in ratios:surviving*=1-ratio/100
            loss=(1-surviving)*100
        if not 0<=loss<100:
            raise ValueError("Process loss must be below 100% to leave a positive yield.")
        results.append({**capture,"LossPct":str(loss),"WeightGrams":str(weight) if weight is not None else None})
    return results
