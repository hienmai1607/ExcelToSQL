"""Raw-material writes reuse validated master payloads, with separate SQL/permissions."""
from fastapi import APIRouter, Depends, HTTPException
from auth import AccessContext, get_access_context
from packaging_api import MaterialBatch, PriceBatch, MATERIAL, PRICE, batch, require

router = APIRouter(prefix="/api/raw-material", tags=["Raw Material"])

@router.post("/material/batch")
def material_save(payload: MaterialBatch, ctx: AccessContext = Depends(get_access_context)):
    return batch(payload,ctx,"PackagingMaterialBatchType","usp_RawMaterial_Batch",MATERIAL,scope="RawMaterial")

@router.post("/price/batch")
def price_save(payload: PriceBatch, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,"RawMaterial")
    for row in payload.rows:
        if "BaseUoM" in row.model_fields_set:
            if row.PriceBasis is not None and row.PriceBasis != row.BaseUoM:
                raise HTTPException(422,"Conflicting Price UoM values.")
            row.PriceBasis = row.BaseUoM
    return batch(payload,ctx,"PackagingPriceBatchTypeV3","usp_RawMaterialPrice_BatchV3",
                 PRICE+[("VendorID","INT"),("ExchangeRateToUSD","DECIMAL(18,10)")],scope="RawMaterial")

from packaging_api import MasterRow, Input
from pydantic import Field, computed_field
from typing import Literal

class RawGradeRow(MasterRow):
    MaterialAssign:bool|None=None
    ParentGradeID:int|None=Field(None,ge=1)
    @computed_field
    @property
    def ParentGradeSet(self)->bool:
        return "ParentGradeID" in self.model_fields_set
    MaterialID:int|None=Field(None,ge=1)
    GradeName:str|None=Field(None,max_length=100)
    Status:Literal["Active","Block"]|None=None

class RawGradeBatch(Input):
    rows:list[RawGradeRow]=Field(min_length=1,max_length=500)

@router.post("/grade/batch")
def grade_save(payload:RawGradeBatch,ctx:AccessContext=Depends(get_access_context)):
    fields=[("RowNum","INT"),("Command","CHAR(1)"),("ID","INT"),("MaterialID","INT"),
            ("GradeName","NVARCHAR(100)"),("Status","VARCHAR(10)"),("RowVersionB64","VARCHAR(18)")]
    return batch(payload,ctx,"RawGradeBatchTypeV3","usp_RawGrade_BatchV3",fields+[("ParentGradeID","INT"),("ParentGradeSet","BIT"),("MaterialAssign","BIT")],scope="RawMaterial")
