"""Opportunity-owned grade copies; no Product Master writes."""
from fastapi import APIRouter, Depends, Path, HTTPException
from auth import AccessContext, get_access_context
from packaging_api import execute, require
from opportunity_excel_api import AUTH

router=APIRouter(prefix="/api/opportunity",tags=["Opportunity grade snapshots"])

@router.get("/grade-lookups")
def lookups(ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    sets=execute(AUTH+"""
      SELECT ID,GradeName,ParentGradeID,FinalGrade FROM dbo.RawGrade WHERE Status='Active' ORDER BY GradeName,ID;
      SELECT ID,GradeID,MaterialCode,MaterialName,Status FROM dbo.RawMaterial WHERE GradeID IS NOT NULL ORDER BY MaterialCode,ID;
    """,[ctx.username])
    return {"rows":sets[0],"materials":sets[1]}

@router.get("/products/{product_id}/grade-snapshot")
def product_snapshot(product_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    sets=execute(AUTH+"""
      SELECT p.ID FROM dbo.Product p WHERE p.ID=? AND p.Status='Active';
      SELECT g.ParentID,g.ID,g.RawGradeID,g.RawMaterialID,g.Grade,g.RatioPct,g.Process,m.MaterialCode RawMaterialCode,m.MaterialName RawMaterialName
      FROM dbo.ProductGradeItem g JOIN dbo.ProductGradeVersion v ON v.ID=g.VersionID
      LEFT JOIN dbo.RawMaterial m ON m.ID=g.RawMaterialID
      WHERE v.ProductID=? AND v.Status='Active' ORDER BY g.ParentID,g.ID;
    """,[ctx.username,product_id,product_id])
    if not sets[0]:raise HTTPException(404,"Active product not found.")
    return {"items":[{**r,"RatioPct":str(r["RatioPct"])} for r in sets[1]]}

def validate_snapshot(cursor,snapshot):
    """Validate changed copies under document transaction; names come from Master."""
    items=snapshot["items"]
    for item in items:
        grade=cursor.execute("SELECT GradeName,ParentGradeID,FinalGrade FROM dbo.RawGrade WITH(UPDLOCK,HOLDLOCK) WHERE ID=? AND Status='Active'",item.get("RawGradeID")).fetchone()
        if not grade:raise ValueError("Choose an active Raw Grade for every snapshot item.")
        item["Grade"]=grade[0]
        if item["ParentID"]!="0":
            parent=next((p for p in items if p["ParentID"]+"/"+str(p["ID"])==item["ParentID"]),None)
            if not parent or parent.get("RawGradeID")!=grade[1]:
                raise ValueError("Each child grade must belong to its selected parent.")
        if grade[2] and any(p["ParentID"]==item["ParentID"]+"/"+str(item["ID"]) for p in items):
            raise ValueError("A final grade cannot have child grades.")
        if item.get("RawMaterialID"):
            material=cursor.execute(
                "SELECT MaterialCode,MaterialName FROM dbo.RawMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=? AND GradeID=? AND Status='Active'",
                item["RawMaterialID"],item["RawGradeID"]).fetchone()
            if not grade[2] or not material:
                raise ValueError("Choose an active Raw Material assigned to the final grade.")
            item["RawMaterialCode"],item["RawMaterialName"]=material
        else:
            item.pop("RawMaterialCode",None);item.pop("RawMaterialName",None)
