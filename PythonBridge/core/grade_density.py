"""Exact frozen nut/grade proportions identify reusable density defaults."""
import hashlib,json
from decimal import Decimal,localcontext
from fastapi import HTTPException
from product_grades import OpportunityGradeTree

def grade_combination(snapshot):
 try:
  data=json.loads(snapshot) if isinstance(snapshot,str) else snapshot
  if not data:return None
  tree=OpportunityGradeTree.model_validate({"items":data["items"]})
 except (ValueError,TypeError,KeyError):return None
 items={i.path:i for i in tree.items}
 parents={i.ParentID for i in tree.items}
 combined={}
 with localcontext() as precision:
  precision.prec=100
  for path,item in items.items():
   if path in parents:continue
   proportion=Decimal(1);lineage=[];current=item
   while True:
    proportion*=current.RatioPct/100
    lineage.append((current.Grade.casefold(),current.RawGradeID))
    if current.ParentID=="0":break
    current=items[current.ParentID]
   key=tuple(reversed(lineage))
   combined[key]=combined.get(key,Decimal(0))+proportion
  normalized=[dict(NutsGrade=list(key),Ratio=format(value.normalize(),"f")) for key,value in sorted(combined.items(),key=lambda entry:json.dumps(entry[0]))]
 document=json.dumps(normalized,ensure_ascii=True,separators=(",",":"),sort_keys=True)
 return hashlib.sha256(document.encode()).hexdigest(),document

def attach_density_defaults(rows,username):
 from packaging_api import execute
 combinations={r["ItemID"]:grade_combination(r.get("ProductGradeSnapshot")) for r in rows if r.get("NutDensityDefaultsVisible",r.get("PackingWayVisible")) and not r.get("IsMixParent")}
 hashes=sorted({c[0] for c in combinations.values() if c})
 if not hashes:return
 defaults=execute("""DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Read',@Actor OUTPUT;
 SELECT CombinationHash,NutDensity,RowVersion FROM dbo.NutGradeDensity
 WHERE CombinationHash IN(SELECT value FROM OPENJSON(?))""",[username,json.dumps(hashes)])[0]
 by_hash={d["CombinationHash"]:d for d in defaults}
 for row in rows:
  combination=combinations.get(row["ItemID"])
  if not combination:continue
  default=by_hash.get(combination[0])
  row["NutDensityDefault"]=default["NutDensity"] if default else None
  row["NutDensityDefaultRowVersion"]=default["RowVersion"] if default else None
  row["NutDensityCombinationAvailable"]=True

def save_density_defaults(cursor,ctx,rows):
 from packaging_api import rv
 from packaging_fields import consume
 changes=[]
 for row in rows:
  if not row.NutDensityDefaultUpdate and ("NutDensity" not in row.model_fields_set or row.NutDensity is None):continue
  cursor.execute("""SELECT ProductGradeSnapshot,NutDensity,
  CASE WHEN EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=i.OpportunityItemID) THEN 1 ELSE 0 END
  FROM dbo.PackagingConfigurationRequestItem i WHERE ID=?""",row.ID)
  snapshot,density,mix=cursor.fetchone()
  combination=None if mix else grade_combination(snapshot)
  if not combination or density is None:
   if row.NutDensityDefaultUpdate:raise HTTPException(422,"A complete Nuts grade combination and positive density are required to update the default.")
   continue
  changes.append((combination[0],row.ID,combination[1],density,row))
 for signature,item,document,density,row in sorted(changes,key=lambda change:(change[0],change[1])):
  cursor.execute("SELECT ID,NutDensity,RowVersion FROM dbo.NutGradeDensity WITH(UPDLOCK,HOLDLOCK) WHERE CombinationHash=?",signature)
  original=cursor.fetchone()
  if original is None:
   if row.NutDensityDefaultUpdate:raise HTTPException(409,"The density default changed. Refresh this response.")
   cursor.execute("""INSERT dbo.NutGradeDensity(CombinationHash,CombinationJSON,NutDensity,SourceResponseItemID,CreatedBy)
   VALUES(?,?,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY()) AS DensityID""",signature,document,density,item,ctx.user_id)
   id=consume(cursor)[0][0]["DensityID"]
   old=None
  elif row.NutDensityDefaultUpdate:
   id,old,version=original
   if rv(row.NutDensityDefaultRowVersion,True)!=bytes(version):raise HTTPException(409,"The grade density default changed. Refresh before overwriting.")
   if old==density:continue
   cursor.execute("UPDATE dbo.NutGradeDensity SET NutDensity=?,SourceResponseItemID=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?",density,item,ctx.user_id,id)
  else:continue  # Never overwrite a shared default on an ordinary response edit.
  cursor.execute("INSERT dbo.NutGradeDensityHistory(DensityID,OldDensity,NewDensity,ResponseItemID,ChangedBy) VALUES(?,?,?,?,?)",id,old,density,item,ctx.user_id)
