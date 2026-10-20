"""Permission-checked item/request presence counts. Never expose responses or PIC data."""
import json
from datetime import datetime,timezone
from fastapi import HTTPException
from db import get_raw_cursor
import local_ai_api as ai

def item_result(plan,ctx,selected_ids=None):
 if not ai.source_allowed(ctx,"opportunities"):raise HTTPException(403,"No access to Opportunities.")
 if plan.selection=="listed":
  if selected_ids is None:raise HTTPException(422,"Choose or list the opportunities first.")
  if len(selected_ids)>10 or any(type(i) is not int or i<=0 for i in selected_ids):
   raise HTTPException(422,"Invalid server-side opportunity selection.")
  selection=json.dumps(selected_ids)
  mine,stage,search=False,None,""
 else:selection=None;mine,stage,search=plan.mine,plan.stage,plan.search
 pattern=search.replace("~","~~").replace("%","~%").replace("_","~_").replace("[","~[")+"%"
 with get_raw_cursor() as cur:
  cur.execute("""IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
    WHERE u.ID=? AND u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
    THROW 51042,'Opportunity access is required.',1;
   DECLARE @Selection NVARCHAR(MAX)=?;
   ;WITH Headers AS (
    SELECT o.ID,o.OpportunityNumber FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID
    WHERE (?=0 OR o.CreatedBy=?) AND (? IS NULL OR o.Stage=?)
     AND (o.OpportunityNumber LIKE ? ESCAPE '~' OR c.CustomerName LIKE ? ESCAPE '~' OR o.OpportunityDesc LIKE ? ESCAPE '~')
     AND (@Selection IS NULL OR o.ID IN(SELECT TRY_CONVERT(INT,value) FROM OPENJSON(@Selection)))
   ), Facts AS (
    SELECT i.OpportunityID,
     CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID) THEN CONVERT(BIGINT,1) ELSE CONVERT(BIGINT,0) END Linked,
     CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID AND r.IsOpen=1) THEN CONVERT(BIGINT,1) ELSE CONVERT(BIGINT,0) END OpenRequest
    FROM dbo.OpportunityItem i JOIN Headers h ON h.ID=i.OpportunityID
    WHERE i.ParentItemID IS NULL
   ), Counts AS (
    SELECT OpportunityID,COUNT_BIG(*) TotalItems,SUM(Linked) LinkedItems,SUM(OpenRequest) OpenRequestItems
    FROM Facts GROUP BY OpportunityID
   )
   SELECT TOP(10) h.ID,h.OpportunityNumber,
    COALESCE(c.TotalItems,0) TotalItems,COALESCE(c.LinkedItems,0) LinkedItems,
    COALESCE(c.OpenRequestItems,0) OpenRequestItems,
    COALESCE(c.TotalItems,0)-COALESCE(c.LinkedItems,0) UnrequestedItems,
    COUNT_BIG(*) OVER() ScopeCount,
    SUM(COALESCE(c.TotalItems,0)) OVER() AllItems,
    SUM(COALESCE(c.LinkedItems,0)) OVER() AllLinked,
    SUM(COALESCE(c.OpenRequestItems,0)) OVER() AllOpen
   FROM Headers h LEFT JOIN Counts c ON c.OpportunityID=h.ID ORDER BY h.ID DESC;""",
   ctx.user_id,ctx.username,selection,int(mine),ctx.user_id,stage,stage,pattern,pattern,pattern)
  names=[d[0] for d in cur.description]
  rows=[dict(zip(names,r)) for r in cur.fetchall()]
 first=rows[0] if rows else {}
 totals={"opportunities":int(first.get("ScopeCount",0)),"items":int(first.get("AllItems",0)),
         "linked":int(first.get("AllLinked",0)),"open":int(first.get("AllOpen",0))}
 totals["unrequested"]=totals["items"]-totals["linked"]
 for row in rows:
  for key in ("ScopeCount","AllItems","AllLinked","AllOpen"):row.pop(key,None)
 scope="previously listed" if plan.selection=="listed" else "matching"
 answer=(f"Across {totals['opportunities']} {scope} opportunities: {totals['items']} top-level items; "
         f"{totals['linked']} linked to at least one Packaging Request, {totals['open']} currently in an open request, "
         f"and {totals['unrequested']} never linked to a request. "
         "Each item is counted once; Mix children are excluded. Linked includes completed and canceled requests; open means IsOpen=1.")
 if totals["opportunities"]>len(rows):answer+=f" Counts cover all matches; showing {len(rows)} opportunity detail rows."
 if plan.selection=="listed":answer+=" This covers only the opportunities previously displayed, not any undisplayed matches."
 else:
  criteria=["created by you" if mine else "all creators","header stage '"+stage+"'" if stage else "all header stages"]
  if search:criteria.append("name/code prefix '"+search+"'")
  answer+=" Filters: "+", ".join(criteria)+"."
 return {"model":ai.MODEL,"read_only":True,"answer":answer,"evidence":rows,"citations":[int(r["ID"]) for r in rows],
         "truncated":totals["opportunities"]>len(rows),"total":totals["opportunities"],"item_counts":totals,
         "opportunity_ids":[int(r["ID"]) for r in rows],"as_of":datetime.now(timezone.utc).isoformat(),"extracted":None}
