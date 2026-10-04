"""Product grade versions share Product authorization and optimistic concurrency."""
from fastapi import APIRouter, Depends, Path
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv
from product_grades import GradeSave
from cache import invalidate

router = APIRouter(prefix="/api/workbench/products", tags=["Product grades"])


@router.get("/raw-grade-lookups")
def raw_grade_lookups(ctx: AccessContext = Depends(get_access_context)):
    require(ctx,"Product")
    from packaging_master_api import PRODUCT_AUTH
    grades,materials=execute(PRODUCT_AUTH+"""
      SELECT g.ID,g.GradeName,g.ParentGradeID
      FROM dbo.RawGrade g WHERE g.Status='Active'
      ORDER BY g.GradeName,g.ID;
      SELECT m.ID,m.GradeID,m.MaterialCode,m.MaterialName,m.Status
      FROM dbo.RawMaterial m WHERE m.GradeID IS NOT NULL
      ORDER BY m.MaterialCode,m.ID;
    """,[ctx.username])
    return {"rows":grades,"materials":materials}

@router.get("/{product_id}/grades")
def read(product_id: int = Path(ge=1), ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Product")
    sets = execute("EXEC dbo.usp_ProductGrade_Read ?,?", [product_id, ctx.username])
    return {"product": sets[0][0], "versions": sets[1], "items": sets[2]}


@router.post("/{product_id}/grades")
def save(body: GradeSave, product_id: int = Path(ge=1), ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Product")
    import json
    sets = execute("EXEC dbo.usp_ProductGrade_Save ?,?,?,?,?,?,?", [
        product_id, ctx.username, body.VersionID, rv(body.RowVersion, False),
        rv(body.ProductRowVersion), body.Status,
        json.dumps([item.model_dump(mode="json") for item in body.items]),
    ])
    invalidate("opportunity_master_lookups")
    return sets[0][0]


# Read-only POST: supports selected grades in unsaved Product drafts as well as saved versions.
from pydantic import BaseModel, ConfigDict, Field, PositiveInt
from decimal import Decimal

class RawPricingQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    grade_ids: list[PositiveInt] = Field(max_length=1000)

@router.post("/raw-pricing")
def raw_pricing(body: RawPricingQuery, ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Product")
    from packaging_master_api import PRODUCT_AUTH
    import json
    sets = execute(PRODUCT_AUTH + """
      DECLARE @Today DATE=CONVERT(DATE,SYSUTCDATETIME());
      SELECT @Today AS AsOf;
      SELECT requested.ID AS RawGradeID,g.GradeName,g.Status AS GradeStatus,
       m.ID AS MaterialID,m.MaterialCode,m.MaterialName,m.Status AS MaterialStatus,m.UnitOfMeasure AS MaterialBaseUoM,
       p.ID AS PriceID,v.VendorName,c.CurrencyCode,p.PriceBasis AS PriceUoM,
       p.QuantityFrom,p.QuantityTo,p.EffectiveFrom,p.EffectiveTo,
       p.UnitPrice,p.ExchangeRateToUSD,p.UnitUSDPrice,
       factor.Value AS ConversionFactor,
       CONVERT(DECIMAL(38,8),p.UnitUSDPrice/NULLIF(factor.Value,0)) AS BaseUnitUSDPrice,
       CASE WHEN g.ID IS NULL THEN 'Grade unavailable'
        WHEN g.Status<>'Active' THEN 'Grade blocked'
        WHEN m.Status<>'Active' THEN 'Material blocked'
        WHEN p.ID IS NULL THEN 'No current price'
        WHEN p.ExchangeRateToUSD IS NULL THEN 'Exchange rate required'
        WHEN factor.Value IS NULL THEN 'Conversion required'
        ELSE 'Current' END AS PricingStatus
      FROM (SELECT DISTINCT CONVERT(INT,value) AS ID FROM OPENJSON(?)) requested
      LEFT JOIN dbo.RawGrade g ON g.ID=requested.ID
      LEFT JOIN dbo.RawMaterial m ON m.GradeID=g.ID
      LEFT JOIN dbo.RawMaterialPrice p ON p.MaterialID=m.ID
       AND g.Status='Active' AND m.Status='Active' AND p.Status='Active'
       AND p.EffectiveFrom<=@Today AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=@Today)
       AND (p.VendorID IS NULL OR EXISTS(SELECT 1 FROM dbo.Vendor activeVendor
         WHERE activeVendor.ID=p.VendorID AND activeVendor.Status='Active'))
      LEFT JOIN dbo.Vendor v ON v.ID=p.VendorID
      LEFT JOIN dbo.Currency c ON c.ID=p.CurrencyID
      OUTER APPLY dbo.fn_UnitConversion(p.PriceBasis,m.UnitOfMeasure,NULL,m.ID,p.VendorID) conv
      OUTER APPLY (SELECT CASE WHEN p.PriceBasis=m.UnitOfMeasure
       THEN CONVERT(DECIMAL(24,9),1) ELSE conv.Factor END AS Value) factor
      WHERE m.ID IS NOT NULL
      ORDER BY requested.ID,v.VendorName,p.PriceBasis,p.QuantityFrom,p.EffectiveFrom,p.ID;
    """, [ctx.username,json.dumps(body.grade_ids)])
    return {"as_of":sets[0][0]["AsOf"],
            "rows":[{k:str(v) if isinstance(v,Decimal) else v for k,v in row.items()} for row in sets[1]]}
