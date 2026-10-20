"""Raw-material writes reuse validated master payloads, with separate SQL/permissions."""
from fastapi import APIRouter, Depends, HTTPException
from auth import AccessContext, get_access_context
from packaging_api import MaterialRow, PriceBatch, MATERIAL, PRICE, batch, require, MasterRow, Input
from pydantic import Field, computed_field
from typing import Literal

router = APIRouter(prefix="/api/raw-material", tags=["Raw Material"])

class RawMaterialRow(MaterialRow):
    Origin:str|None=Field(None,max_length=200)
    @computed_field
    @property
    def OriginSet(self)->bool:
        return "Origin" in self.model_fields_set
    @computed_field
    @property
    def DescriptionSet(self)->bool:
        return "Description" in self.model_fields_set
    GradeID:int|None=Field(None,ge=1)
    @computed_field
    @property
    def GradeSet(self)->bool:
        return "GradeID" in self.model_fields_set

class RawMaterialBatch(Input):
    rows:list[RawMaterialRow]=Field(min_length=1,max_length=500)

@router.post("/material/batch")
def material_save(payload: RawMaterialBatch, ctx: AccessContext = Depends(get_access_context)):
    return batch(payload,ctx,"RawMaterialBatchTypeV3","usp_RawMaterial_BatchV3",MATERIAL+[("GradeID","INT"),("GradeSet","BIT"),("Origin","NVARCHAR(200)"),("OriginSet","BIT"),("DescriptionSet","BIT")],scope="RawMaterial")

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

class RawGradeRow(MasterRow):
    FinalGrade:bool|None=None
    ParentGradeID:int|None=Field(None,ge=1)
    @computed_field
    @property
    def ParentGradeSet(self)->bool:
        return "ParentGradeID" in self.model_fields_set
    GradeName:str|None=Field(None,max_length=100)
    Status:Literal["Active","Block"]|None=None

class RawGradeBatch(Input):
    rows:list[RawGradeRow]=Field(min_length=1,max_length=500)

@router.post("/grade/batch")
def grade_save(payload:RawGradeBatch,ctx:AccessContext=Depends(get_access_context)):
    fields=[("RowNum","INT"),("Command","CHAR(1)"),("ID","INT"),
            ("GradeName","NVARCHAR(100)"),("Status","VARCHAR(10)"),("RowVersionB64","VARCHAR(18)")]
    return batch(payload,ctx,"RawGradeBatchTypeV5","usp_RawGrade_BatchV5",fields+[("ParentGradeID","INT"),("ParentGradeSet","BIT"),("FinalGrade","BIT")],scope="RawMaterial")
