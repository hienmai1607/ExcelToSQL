"""Product-owned Product loss process assignments; Opportunity snapshots remain independent."""
import json
from fastapi import APIRouter,Depends,Path,HTTPException
from pydantic import BaseModel,ConfigDict,Field,model_validator
from auth import AccessContext,get_access_context
from packaging_api import execute,require,rv
from loss_process_api import active_loss_masters
from tcb_costs import LossProcess
from cache import invalidate
router=APIRouter(prefix="/api/workbench/products",tags=["Product loss processes"])
AUTH="""IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Product'))
 THROW 52998,'Product access is required.',1; """
class ProductLossSave(BaseModel):
 model_config=ConfigDict(extra="forbid")
 RowVersion:str
 processes:list[LossProcess]=Field(max_length=100)
 @model_validator(mode="after")
 def unique(self):
  if len({p.Sequence for p in self.processes})!=len(self.processes):raise ValueError("Use unique Product process sequences.")
  if any(p.ProcessType!="Processing" for p in self.processes):raise ValueError("Product Master only maintains Product loss.")
  return self
@router.get("/{product_id}/loss-processes")
def read(product_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Product")
 rows=execute(AUTH+"SELECT ID,ProductCode,ProductName,IsMix,RowVersion,LossProcesses FROM dbo.Product WHERE ID=?",[ctx.username,product_id])[0]
 if not rows:raise HTTPException(404,"Product not found.")
 return {"product":rows[0],"processes":json.loads(rows[0]["LossProcesses"] or "[]"),"masters":active_loss_masters(ctx)}
@router.post("/{product_id}/loss-processes")
def save(body:ProductLossSave,product_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Product")
 data=read(product_id,ctx)
 if data["product"]["IsMix"] and body.processes:raise HTTPException(422,"Product loss applies to regular products and Mix children, not Mix parents.")
 masters={m["MasterID"]:m for m in data["masters"]}
 resolved=[]
 for step in body.processes:
  master=masters.get(step.MasterID)
  if not master or master["MasterVersion"].lower()!=str(step.MasterVersion).lower():
   raise HTTPException(409,"Loss Process changed or is blocked. Refresh and reselect.")
  resolved.append({**master,"Sequence":step.Sequence,"LossPct":str(step.LossPct)})
 result=execute("EXEC dbo.usp_ProductLossProcesses_Save ?,?,?,?",[ctx.username,product_id,rv(body.RowVersion),json.dumps(resolved)])[0][0]
 invalidate("opportunity_master_lookups")
 return {"processes":resolved,**result}
