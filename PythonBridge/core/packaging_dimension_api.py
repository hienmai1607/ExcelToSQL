"""Web-only dimension definitions and a non-persisting formula test calculator."""
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import Field, field_validator, model_validator
from auth import AccessContext, get_access_context
from dimension_formula import area_formula, volume_formula, conversion_formula, formula_variables
from packaging_api import Input, execute, require, rv

router = APIRouter(prefix="/api/packaging/dimensions", tags=["Packaging Dimension Master"])
AUTH = "DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'MasterRead',@Actor OUTPUT; "
DIMENSIONS = ("D1", "D2", "D3")
FORMULA_ROLES = ("OccupiedM2Formula", "OccupiedM3Formula", "ConvertFromParentFormula", "ConvertFromSupplierFormula")


class DimensionInput(Input):
    PackagingTypeID: int = Field(ge=1)
    ParentDimensionID: int | None = Field(None, ge=1)
    ParentDimensionRowVersion: str | None = None
    ConversionOutputUoMID: int | None = Field(None, ge=1, le=2147483647)
    D1: str = Field(min_length=1, max_length=100)
    D2: str | None = Field(None, max_length=100)
    D3: str | None = Field(None, max_length=100)
    D1UoMID: int = Field(ge=1)
    D2UoMID: int | None = Field(None, ge=1)
    D3UoMID: int | None = Field(None, ge=1)
    SquareMeterFormula: str | None = Field(None, min_length=1, max_length=200)
    VolumeFormula: str | None = Field(None, min_length=1, max_length=200)
    OccupiedM2Formula: str | None = Field(None, min_length=1, max_length=200)
    OccupiedM3Formula: str | None = Field(None, min_length=1, max_length=200)
    ConvertFromParentFormula: str | None = Field(None, min_length=1, max_length=200)
    ConvertFromSupplierFormula: str | None = Field(None, min_length=1, max_length=200)

    @field_validator("D1", "D2", "D3", "SquareMeterFormula", "VolumeFormula", *FORMULA_ROLES, mode="before")
    @classmethod
    def trim(cls, value):
        return (value.strip() or None) if isinstance(value, str) else value

    @model_validator(mode="after")
    def definition(self):
        for name in DIMENSIONS:
            if bool(getattr(self, name)) != (getattr(self, name + "UoMID") is not None):
                raise ValueError(name + " needs both a dimension name and a unit, or both must be blank.")
        for formula in (self.SquareMeterFormula,self.VolumeFormula):
            missing = (formula_variables(formula) if formula else frozenset()).difference(name for name in DIMENSIONS if getattr(self, name))
            if missing:
                raise ValueError("Define a name and unit for " + ", ".join(sorted(missing)) + " used in the formula.")
        for role in FORMULA_ROLES:
            formula = getattr(self, role)
            variables = formula_variables(formula, allow_constant=role.startswith("Convert")) if formula else frozenset()
            if role == "ConvertFromParentFormula" and self.ParentDimensionID is not None:
                continue  # Parent variables are checked against the linked parent by SQL.
            missing = variables.difference(
                name for name in DIMENSIONS if getattr(self, name))
            if missing:
                raise ValueError("Define a name and unit for " + ", ".join(sorted(missing)) + " used in " + role + ".")
        return self


class DimensionSave(DimensionInput):
    ID: int | None = Field(None, ge=1)
    RowVersion: str | None = None
    Status: Literal["Active", "Block"] = "Active"
    FormulaReviewed: bool = False

    @model_validator(mode="after")
    def identity(self):
        if "ConversionOutputUoMID" in self.model_fields_set and self.ConversionOutputUoMID is None and (self.ConvertFromParentFormula or self.ConvertFromSupplierFormula) and self.Status=="Active":
            raise ValueError("Choose the shared formula output UoM for both conversion formulas.")
        if self.ID is None and self.RowVersion is not None:
            raise ValueError("Create cannot have a RowVersion.")
        rv(self.RowVersion, self.ID is not None)
        return self


class DimensionMeasurements(DimensionInput):
    TestD1: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6)
    TestD2: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6)
    TestD3: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6)

    @model_validator(mode="after")
    def test_values(self):
        for formula in (self.SquareMeterFormula,self.VolumeFormula):
            for name in formula_variables(formula) if formula else ():
                if getattr(self, "Test" + name) is None:
                    raise ValueError("Enter a positive test value for " + name + ".")
        return self


class DimensionTest(DimensionMeasurements):
    SquareMeterFormula: str = Field(min_length=1, max_length=200)


class VolumeTest(DimensionMeasurements):
    VolumeFormula: str = Field(min_length=1, max_length=200)


class FormulaRoleTest(DimensionInput):
    FormulaRole: Literal["OccupiedM2Formula", "OccupiedM3Formula", "ConvertFromParentFormula", "ConvertFromSupplierFormula"]
    TestD1: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    TestD2: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    TestD3: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)

    @model_validator(mode="after")
    def role_values(self):
        formula = getattr(self, self.FormulaRole)
        if not formula:
            raise ValueError("Enter the selected formula before testing.")
        for name in formula_variables(formula, allow_constant=self.FormulaRole.startswith("Convert")):
            if getattr(self, "Test" + name) is None:
                raise ValueError("Enter a positive test value for " + name + ".")
        return self


def read_access(ctx):
    require(ctx, "Packaging", "PackagingManager")


@router.get("/lookups")
def lookups(ctx: AccessContext = Depends(get_access_context)):
    read_access(ctx)
    sets = execute(AUTH + """SELECT ID,UoMCode,UoMName,Status FROM dbo.UoM ORDER BY UoMCode;
    SELECT p.ID,p.PackagingOrder,p.PackagingType,p.ParentTypeID,p.RootTypeID,p.PriceBasis,p.RootShipping AS Shipping,p.Status FROM dbo.v_PackagingTypeDimensionContext p
    WHERE p.Status='Active'
     OR EXISTS(SELECT 1 FROM dbo.PackagingDimension d WHERE d.PackagingTypeID=p.ID)
    ORDER BY p.PackagingOrder,p.PackagingType,p.ID;
    SELECT d.ID,d.PackagingTypeID,d.D1Name AS D1,d.D2Name AS D2,d.D3Name AS D3,
     d.D1UoMID,d.D2UoMID,d.D3UoMID,d.SquareMeterFormula,d.VolumeFormula,
     d.OccupiedM2Formula,d.OccupiedM3Formula,d.ConvertFromParentFormula,d.ConvertFromSupplierFormula,d.ConversionOutputUoMID,(SELECT UoMCode FROM dbo.UoM WHERE ID=d.ConversionOutputUoMID) AS ConversionOutputUnit,
     d.OccupiedFormulaNeedsReview,d.FormulaNeedsReview,d.RowVersion,d.Status,p.PackagingType
    FROM dbo.PackagingDimension d JOIN dbo.PackagingType p ON p.ID=d.PackagingTypeID
    WHERE p.ParentTypeID IS NULL ORDER BY d.ID;""", [ctx.username])
    return {"uoms": sets[0], "packagingTypes": sets[1], "parentDimensions": sets[2]}


@router.get("")
def read(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
         search: str = Query("", max_length=200), status: Literal["Active", "Block"] | None = None,
         ctx: AccessContext = Depends(get_access_context)):
    read_access(ctx)
    sql = AUTH + """
    SELECT COUNT(*) AS Total FROM dbo.v_PackagingDimensionWeb d
    JOIN dbo.v_PackagingTypeDimensionContext p ON p.ID=d.PackagingTypeID
    WHERE (? IS NULL OR d.Status=?) AND (p.PackagingType LIKE ? OR CONCAT(d.OccupiedM2Formula,N' ',d.OccupiedM3Formula) LIKE ? OR CONCAT(d.ConvertFromParentFormula,N' ',d.ConvertFromSupplierFormula) LIKE ?);
    SELECT d.ID,d.PackagingTypeID,d.D1Name AS D1,d.D2Name AS D2,d.D3Name AS D3,
     d.D1UoMID,d.D2UoMID,d.D3UoMID,d.SquareMeterFormula,d.VolumeFormula,d.FormulaNeedsReview,
     d.OccupiedM2Formula,d.OccupiedM3Formula,d.ConvertFromParentFormula,d.ConvertFromSupplierFormula,d.ConversionOutputUoMID,(SELECT UoMCode FROM dbo.UoM WHERE ID=d.ConversionOutputUoMID) AS ConversionOutputUnit,d.OccupiedFormulaNeedsReview,
     d.ParentDimensionID,d.ParentDimensionRowVersion,d.ParentTypeID,d.EffectiveSquareMeterFormula,d.EffectiveVolumeFormula,
     d.Status,d.RowVersion,d.CreatedAt,d.UpdatedAt,p.PackagingOrder,p.PackagingType,p.PriceBasis,p.RootShipping AS Shipping,
     u1.UoMCode AS D1Unit,u2.UoMCode AS D2Unit,u3.UoMCode AS D3Unit,
     creator.UserName AS CreatedByName,editor.UserName AS UpdatedByName
    FROM dbo.v_PackagingDimensionWeb d JOIN dbo.v_PackagingTypeDimensionContext p ON p.ID=d.PackagingTypeID
    JOIN dbo.UoM u1 ON u1.ID=d.D1UoMID LEFT JOIN dbo.UoM u2 ON u2.ID=d.D2UoMID LEFT JOIN dbo.UoM u3 ON u3.ID=d.D3UoMID
    JOIN dbo.Users creator ON creator.ID=d.CreatedBy LEFT JOIN dbo.Users editor ON editor.ID=d.UpdatedBy
    WHERE (? IS NULL OR d.Status=?) AND (p.PackagingType LIKE ? OR CONCAT(d.OccupiedM2Formula,N' ',d.OccupiedM3Formula) LIKE ? OR CONCAT(d.ConvertFromParentFormula,N' ',d.ConvertFromSupplierFormula) LIKE ?)
    ORDER BY p.PackagingOrder,p.PackagingType,d.ID OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
    """
    pattern = "%" + search + "%"
    sets = execute(sql, [ctx.username, status, status, pattern, pattern, pattern, status, status, pattern, pattern, pattern, (page - 1) * page_size, page_size])
    return {"rows": sets[1], "total": sets[0][0]["Total"], "page": page}


@router.post("/preview")
def preview(payload: DimensionTest, ctx: AccessContext = Depends(get_access_context)):
    read_access(ctx)
    sets = execute(AUTH + """SELECT ID,Status FROM dbo.UoM WHERE ID IN(?,?,?);
                    SELECT PriceBasis,ParentTypeID,RootShipping AS Shipping,Status FROM dbo.v_PackagingTypeDimensionContext WHERE ID=?;""",
                    [ctx.username, payload.D1UoMID, payload.D2UoMID, payload.D3UoMID, payload.PackagingTypeID])
    if not sets[1] or sets[1][0]["Status"] != "Active":
        return {"SquareMeters": None, "CalculationStatus": "Test Calculation requires an active Packaging Type."}
    units = sets[0]
    active = {u["ID"] for u in units if u["Status"] == "Active"}
    if any(getattr(payload, name) and getattr(payload, name + "UoMID") not in active for name in DIMENSIONS):
        return {"SquareMeters": None, "CalculationStatus": "Choose active units before testing the formula."}
    try:
        values = {name: getattr(payload, "Test" + name) for name in formula_variables(payload.SquareMeterFormula)}
        return {"SquareMeters": str(area_formula(payload.SquareMeterFormula, values)), "CalculationStatus": "Ready"}
    except ValueError as exc:
        return {"SquareMeters": None, "CalculationStatus": str(exc)}


@router.post("")
def save(payload: DimensionSave, ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Packaging")
    if payload.SquareMeterFormula is not None or payload.VolumeFormula is not None:
        raise HTTPException(422, "Refresh the dimension editor and use the four formula roles instead of Square meter / Volume formula.")
    # Test values are forbidden here and never persisted. SQL owns role/references/RV.
    parameters = [
        ctx.username, payload.ID, rv(payload.RowVersion, payload.ID is not None),
        payload.PackagingTypeID, payload.D1, payload.D2, payload.D3,
        payload.D1UoMID, payload.D2UoMID, payload.D3UoMID,
        payload.Status, payload.FormulaReviewed,
        payload.ParentDimensionID, rv(payload.ParentDimensionRowVersion, payload.ParentDimensionID is not None),
        *[getattr(payload, role) for role in FORMULA_ROLES],payload.ConversionOutputUoMID,int('ConversionOutputUoMID' in payload.model_fields_set)]
    return {"row": execute("EXEC dbo.usp_PackagingDimension_SaveV2 " + ",".join("?" for _ in parameters) + ";", parameters)[0][0]}


@router.post("/preview-formula")
def preview_formula(payload: FormulaRoleTest, ctx: AccessContext = Depends(get_access_context)):
    read_access(ctx)
    sets = execute(AUTH + """SELECT ID,UoMCode,Status FROM dbo.UoM WHERE ID IN(?,?,?,?);
      SELECT ParentTypeID,RootTypeID,RootShipping AS Shipping,PriceBasis,Status FROM dbo.v_PackagingTypeDimensionContext WHERE ID=?;""",
      [ctx.username,payload.D1UoMID,payload.D2UoMID,payload.D3UoMID,payload.ConversionOutputUoMID,payload.PackagingTypeID])
    if not sets[1] or sets[1][0]["Status"] != "Active":
        raise HTTPException(422, "Choose an active Packaging Type.")
    kind = sets[1][0]
    occupied = payload.FormulaRole.startswith("Occupied")
    output_unit=next((u for u in sets[0] if u["ID"]==payload.ConversionOutputUoMID),None)
    if not occupied and payload.ConversionOutputUoMID is not None and (not output_unit or output_unit["Status"]!="Active"):
        raise HTTPException(422,"Choose an active shared formula output UoM.")
    if occupied and (kind["ParentTypeID"] is not None or not kind["Shipping"]):
        raise HTTPException(422, "Occupied formulas apply only to Shipping parents.")
    if not occupied and kind["ParentTypeID"] is None:
        raise HTTPException(422, "Conversion formulas apply only to child types.")
    formula = getattr(payload, payload.FormulaRole)
    variables = formula_variables(formula, allow_constant=not occupied)
    if payload.FormulaRole == "ConvertFromParentFormula":
        definitions = execute(AUTH + """SELECT p.*,u1.Status AS D1UnitStatus,u2.Status AS D2UnitStatus,u3.Status AS D3UnitStatus
          FROM dbo.PackagingDimension p JOIN dbo.UoM u1 ON u1.ID=p.D1UoMID
          LEFT JOIN dbo.UoM u2 ON u2.ID=p.D2UoMID LEFT JOIN dbo.UoM u3 ON u3.ID=p.D3UoMID
          WHERE p.ID=? AND p.PackagingTypeID=? AND p.ParentDimensionID IS NULL AND p.Status='Active';""",
          [ctx.username,payload.ParentDimensionID,kind["RootTypeID"]])[0]
        if not definitions:
            raise HTTPException(422, "Choose an active parent dimension definition for Convert from parent.")
        parent = definitions[0]
        if parent["RowVersion"] != payload.ParentDimensionRowVersion:
            raise HTTPException(409, "Parent dimensions changed. Refresh before testing.")
        if any(not parent.get(name+"Name") or parent.get(name+"UnitStatus") != "Active" for name in variables):
            raise HTTPException(422, "Convert from parent requires defined parent dimensions with active units.")
    else:
        active = {u["ID"] for u in sets[0] if u["Status"] == "Active"}
        if any(getattr(payload, name) and getattr(payload, name+"UoMID") not in active for name in DIMENSIONS):
            raise HTTPException(422, "Choose active dimension units.")
    values = {name: getattr(payload, "Test"+name) for name in variables}
    unit = "m³" if payload.FormulaRole == "OccupiedM3Formula" else "m²" if occupied or kind["PriceBasis"] == "Square meter" else "base units"
    try:
        evaluate = (volume_formula if payload.FormulaRole == "OccupiedM3Formula" else area_formula) if occupied else conversion_formula
        if not occupied and output_unit:unit=output_unit["UoMCode"]
        return {"FormulaRole": payload.FormulaRole, "Value": str(evaluate(formula, values)), "OutputUnit": unit, "CalculationStatus": "Ready"}
    except ValueError as exc:
        return {"FormulaRole": payload.FormulaRole, "Value": None, "OutputUnit": unit, "CalculationStatus": str(exc)}


@router.post("/preview-volume")
def preview_volume(payload: VolumeTest, ctx: AccessContext = Depends(get_access_context)):
    read_access(ctx)
    sets = execute(AUTH + """SELECT ID,Status FROM dbo.UoM WHERE ID IN(?,?,?);
                    SELECT RootShipping AS Shipping,Status FROM dbo.v_PackagingTypeDimensionContext WHERE ID=?;""",
                    [ctx.username,payload.D1UoMID,payload.D2UoMID,payload.D3UoMID,payload.PackagingTypeID])
    if not sets[1] or not sets[1][0]['Shipping'] or sets[1][0]['Status']!='Active':
        return {'CubicMeters':None,'CalculationStatus':'Volume formula requires an active Shipping Packaging Type.'}
    active={u['ID'] for u in sets[0] if u['Status']=='Active'}
    if any(not getattr(payload,name) or getattr(payload,name+'UoMID') not in active for name in DIMENSIONS):
        return {'CubicMeters':None,'CalculationStatus':'Shipping types require D1, D2 and D3 names and active units.'}
    try:
        values={name:getattr(payload,'Test'+name) for name in formula_variables(payload.VolumeFormula)}
        return {'CubicMeters':str(volume_formula(payload.VolumeFormula,values)),'CalculationStatus':'Ready'}
    except ValueError as exc:
        return {'CubicMeters':None,'CalculationStatus':str(exc)}
