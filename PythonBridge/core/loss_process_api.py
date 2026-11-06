from workspace_access import require_page_edit
"""Shared Loss Process Master: Admin maintenance, Opportunity read/assignment."""
from typing import Literal, Annotated
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv
from tcb_costs import Pct
from shared_master_views import listing, SharedExport, export_view

READ_AUTH = """IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity','Product'))
 THROW 52998,'Loss Process read access is required.',1; """
router = APIRouter(prefix="/api/loss-processes", tags=["Loss Process Master"])

class LossMasterSave(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ProcessType: str = Field(min_length=1,max_length=100)
    @field_validator('ProcessType')
    @classmethod
    def process_name(cls,value):
        value=value.strip()
        if not value: raise ValueError('Enter a Process Type.')
        return value
    ID: int | None = Field(None, ge=1)
    RowVersion: str | None = None
    Status: Literal["Active","Block"] = "Active"
    Shared: bool = False
    ComponentIDs:list[int]|None=Field(None,max_length=100)

def active_loss_masters(ctx):
    require(ctx,"Opportunity","Product")
    rows = execute(READ_AUTH + """SELECT ID MasterID,'Processing' ProcessType,ProcessType ProcessName,1 Sequence,CAST(0 AS DECIMAL(5,2)) LossPct,
      CONVERT(VARCHAR(18),CONVERT(VARBINARY(8),RowVersion),1) MasterVersion,Shared,
      (SELECT c.ID,c.ComponentName,c.SystemKey,c.Status FROM dbo.ProcessRecipeComponent pc JOIN dbo.RecipeComponent c ON c.ID=pc.ComponentID WHERE pc.ProcessID=LossProcessMaster.ID FOR JSON PATH) RecipeComponents
      FROM dbo.LossProcessMaster WHERE Status='Active' ORDER BY ProcessType,ID;""",
      [ctx.username])[0]
    return [{**row,"LossPct":str(row["LossPct"])} for row in rows]

@router.get("")
def read(page: int = Query(1,ge=1),page_size: int = Query(25,ge=1,le=500),
         search: str = Query("",max_length=200),status: Literal["","Active","Block"]="",
         sort: Annotated[str, Query(max_length=2000)] = '[{"column":"ProcessType","direction":"asc"}]',
         ctx: AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity","Product")
    return listing("loss-processes",ctx,execute,READ_AUTH,"dbo.LossProcessMaster p",
        "p.ID,p.ProcessType,p.Shared,p.Status,p.RowVersion,p.CreatedAt,p.UpdatedAt,(SELECT pc.ComponentID FROM dbo.ProcessRecipeComponent pc WHERE pc.ProcessID=p.ID FOR JSON PATH) ComponentIDs,(SELECT STRING_AGG(c.ComponentName,', ') WITHIN GROUP(ORDER BY c.ID) FROM dbo.ProcessRecipeComponent pc JOIN dbo.RecipeComponent c ON c.ID=pc.ComponentID WHERE pc.ProcessID=p.ID) ComponentNames",
        ["p.ProcessType"],search,status,page,page_size,sort)

@router.post("/export")
def export(body: SharedExport,ctx: AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    return export_view("loss-processes",body)

@router.post("")
def save(body: LossMasterSave,ctx: AccessContext=Depends(get_access_context)):
    require_page_edit(ctx,"loss-processes")
    from npd_api import transaction,one,query
    from packaging_fields import consume
    with transaction(ctx) as cur:
        cur.execute('EXEC dbo.usp_LossProcessMaster_Save ?,?,?,?,?,?,?,?',ctx.username,body.ID,rv(body.RowVersion,required=bool(body.ID)),body.ProcessType,1,0,body.Status,body.Shared)
        sets=consume(cur);identity=body.ID or sets[0][0].get('ID')
        if body.ComponentIDs is not None:
            if len(body.ComponentIDs)!=len(set(body.ComponentIDs)):raise ValueError('Choose each Recipe Component once.')
            for identity_component in body.ComponentIDs:one(cur,"SELECT ID FROM dbo.RecipeComponent WHERE ID=? AND (Status='Active' OR EXISTS(SELECT 1 FROM dbo.ProcessRecipeComponent pc WHERE pc.ComponentID=RecipeComponent.ID AND pc.ProcessID=?))",identity_component,identity)
            cur.execute('DELETE dbo.ProcessRecipeComponent WHERE ProcessID=?',identity)
            for identity_component in body.ComponentIDs:cur.execute('INSERT dbo.ProcessRecipeComponent(ProcessID,ComponentID) VALUES(?,?)',identity,identity_component)
        return {'rows':query(cur,'SELECT * FROM dbo.LossProcessMaster WHERE ID=?',identity)}
