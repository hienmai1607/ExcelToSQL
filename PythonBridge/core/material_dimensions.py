"""Packaging Material owns physical dimensions; prices never define a second geometry."""
from decimal import Decimal
from fastapi import HTTPException
from pydantic import BaseModel,Field

FIELDS=('MaterialDimensionID','MaterialDimensionRowVersion','MaterialD1','MaterialD2','MaterialD3')
class MaterialDimensionFields(BaseModel):
    MaterialDimensionID:int|None=Field(None,ge=1)
    MaterialDimensionRowVersion:str|None=None
    MaterialD1:Decimal|None=Field(None,gt=0,max_digits=18,decimal_places=6,allow_inf_nan=False)
    MaterialD2:Decimal|None=Field(None,gt=0,max_digits=18,decimal_places=6,allow_inf_nan=False)
    MaterialD3:Decimal|None=Field(None,gt=0,max_digits=18,decimal_places=6,allow_inf_nan=False)

def save_dimensions(cur,row,identity):
    from packaging_api import rv
    supplied=bool(set(FIELDS)&row.model_fields_set)
    current=cur.execute("SELECT PackagingTypeID,MaterialDimensionID FROM dbo.PackagingMaterial WHERE ID=?",identity).fetchone()
    if not supplied:
        # A changed type cannot keep measurements belonging to the previous type.
        cur.execute("""UPDATE m SET MaterialDimensionID=NULL,MaterialDimensionRowVersion=NULL,
            MaterialD1=NULL,MaterialD2=NULL,MaterialD3=NULL,MaterialDimensionsNeedsReview=1
            FROM dbo.PackagingMaterial m JOIN dbo.PackagingDimension d ON d.ID=m.MaterialDimensionID
            WHERE m.ID=? AND (m.PackagingTypeID IS NULL OR d.PackagingTypeID<>m.PackagingTypeID)""",identity)
        return
    dimension=row.MaterialDimensionID
    values=[getattr(row,'Material'+k) for k in ('D1','D2','D3')]
    if dimension is None:
        if any(v is not None for v in values) or row.MaterialDimensionRowVersion:
            raise HTTPException(422,'Material measurements require a dimension definition.')
        version=None
    else:
        cur.execute("""SELECT d.PackagingTypeID,d.RowVersion,d.D1Name,d.D2Name,d.D3Name,
            u1.Status,u2.Status,u3.Status,d.Status,t.Status
            FROM dbo.PackagingDimension d WITH(HOLDLOCK)
            JOIN dbo.PackagingType t WITH(HOLDLOCK) ON t.ID=d.PackagingTypeID
            LEFT JOIN dbo.UoM u1 WITH(HOLDLOCK) ON u1.ID=d.D1UoMID
            LEFT JOIN dbo.UoM u2 WITH(HOLDLOCK) ON u2.ID=d.D2UoMID
            LEFT JOIN dbo.UoM u3 WITH(HOLDLOCK) ON u3.ID=d.D3UoMID WHERE d.ID=?""",dimension)
        definition=cur.fetchone()
        if not definition or definition[0]!=current[0] or definition[8]!='Active' or definition[9]!='Active':
            raise HTTPException(422,'Choose an active dimension definition belonging to this material type.')
        version=rv(row.MaterialDimensionRowVersion,True)
        if bytes(definition[1])!=version:raise HTTPException(409,'Material dimension definition changed. Refresh before saving.')
        for index,value in enumerate(values):
            name=definition[2+index]
            if name and (value is None or definition[5+index]!='Active'):
                raise HTTPException(422,'Enter every named material dimension using active units.')
            if not name and value is not None:raise HTTPException(422,'Only enter measurements named in the dimension definition.')
    cur.execute("""UPDATE dbo.PackagingMaterial SET MaterialDimensionID=?,MaterialDimensionRowVersion=?,
        MaterialD1=?,MaterialD2=?,MaterialD3=?,MaterialDimensionsNeedsReview=0 WHERE ID=?""",dimension,version,*values,identity)
