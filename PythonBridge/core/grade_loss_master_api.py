"""Grade and Process Type defaults. TCB snapshots values; defaults never rewrite saved TCB."""
from typing import Literal,Annotated
from fastapi import APIRouter,Depends,Query
from pydantic import BaseModel,ConfigDict,Field
from auth import AccessContext,get_access_context
from packaging_api import execute,require,rv
from workspace_access import require_page_edit
from shared_master_views import listing,SharedExport,export_view
from loss_process_api import READ_AUTH
from tcb_costs import Pct

router=APIRouter(prefix="/api/loss-defaults",tags=["Loss Process Master"])
SOURCE="dbo.GradeProcessLossMaster p JOIN dbo.LossProcessMaster t ON t.ID=p.ProcessTypeID LEFT JOIN dbo.RawGrade g ON g.ID=p.RawGradeID"
SELECT="p.ID,p.RawGradeID,p.ProcessTypeID,COALESCE(g.GradeName,N'All grades') GradeName,t.ProcessType,p.LossPct,p.Status,p.RowVersion"

class LossDefaultSave(BaseModel):
 model_config=ConfigDict(extra="forbid")
 ID:int|None=Field(None,ge=1)
 RowVersion:str|None=None
 RawGradeID:int|None=Field(None,ge=1)
 ProcessTypeID:int=Field(ge=1)
 LossPct:Annotated[Pct,Field(lt=100)]
 Status:Literal["Active","Block"]="Active"

def active_loss_defaults(ctx):
 require(ctx,"Opportunity","Product")
 return execute(READ_AUTH+"""SELECT p.ID,p.RawGradeID,p.ProcessTypeID,p.LossPct,
 CONVERT(VARCHAR(18),CONVERT(VARBINARY(8),p.RowVersion),1) DefaultVersion
 FROM dbo.GradeProcessLossMaster p JOIN dbo.LossProcessMaster t ON t.ID=p.ProcessTypeID
 LEFT JOIN dbo.RawGrade g ON g.ID=p.RawGradeID
 WHERE p.Status='Active' AND t.Status='Active' AND (p.RawGradeID IS NULL OR g.Status='Active')""",[ctx.username])[0]

@router.get("/lookups")
def lookups(ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Opportunity","Product")
 sets=execute(READ_AUTH+"""SELECT ID,GradeName,ParentGradeID FROM dbo.RawGrade WHERE Status='Active' ORDER BY GradeName,ID;
 SELECT ID,ProcessType FROM dbo.LossProcessMaster WHERE Status='Active' ORDER BY ProcessType,ID;""",[ctx.username])
 return dict(grades=sets[0],types=sets[1])

@router.get("")
def read(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=500),search:str=Query("",max_length=200),status:Literal["","Active","Block"]="",
 sort:Annotated[str,Query(max_length=2000)]='[{"column":"GradeName","direction":"asc"}]',ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Opportunity","Product")
 return listing("loss-defaults",ctx,execute,READ_AUTH,SOURCE,SELECT,["COALESCE(g.GradeName,N'All grades')","t.ProcessType"],search,status,page,page_size,sort)

@router.post("")
def save(body:LossDefaultSave,ctx:AccessContext=Depends(get_access_context)):
 require_page_edit(ctx,"loss-defaults")
 return {"rows":execute("EXEC dbo.usp_GradeProcessLoss_Save ?,?,?,?,?,?,?",[ctx.username,body.ID,rv(body.RowVersion,required=bool(body.ID)),body.RawGradeID,body.ProcessTypeID,body.LossPct,body.Status])[0]}

@router.post("/export")
def export(body:SharedExport,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Opportunity","Product")
 return export_view("loss-defaults",body)
