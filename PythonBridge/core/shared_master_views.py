"""Safe list/layout/export helpers for independently maintained shared masters."""
from decimal import Decimal
from typing import Literal
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from master_models import MasterSort

LABELS = {
 "grade-densities":{"Combination":"Nuts / grades / ratio","NutDensity":"Nut density (g/ml)","UpdatedAt":"Updated / Created","UpdatedByName":"User"},
 "categories": {"CategoryName":"Category name","Status":"Status"}, "loss-defaults":{"GradeName":"Grade","ProcessType":"Process Type","LossPct":"Loss (%)","Status":"Status"}, "loss-processes": {"ProcessType":"Process Type","Shared":"Shared","Status":"Status"},
 "ports": {"PortName":"Port name","CustomerName":"Customer","MarketCode":"Market code","MarketName":"Market","Status":"Status"}
}
def check_shared_layout(entity,layout):
 columns=LABELS[entity]
 if (not layout.columns or len(set(layout.columns))!=len(layout.columns)
     or any(c not in columns for c in layout.columns)
     or len({r.column for r in layout.sort})!=len(layout.sort)
     or any(r.column not in columns for r in layout.sort)
     or any(f not in ("search","status") for f in layout.filters)
     or any(k not in ("search","status") for k in layout.values)
     or len(layout.values.get("search",""))>200
     or layout.values.get("status","") not in ("","Active","Block")
     or any(c not in {*columns,"_Actions"} for c in layout.column_widths)):
  raise ValueError("Invalid shared master layout.")
def order_by(entity,raw):
 try:
  rules=TypeAdapter(list[MasterSort]).validate_json(raw or "[]")
  if len(rules)>8 or len({r.column for r in rules})!=len(rules) or any(r.column not in LABELS[entity] for r in rules):
   raise ValueError()
 except ValueError as exc:
  raise HTTPException(422,"Invalid master sort.") from exc
 return ", ".join("["+r.column+"] "+r.direction.upper() for r in rules)+(", " if rules else "")+"ID ASC"
def listing(entity,ctx,execute,auth,source,selection,search_columns,search,status,page,page_size,sort):
 # Sources, columns and selections are trusted application constants, never input.
 where="(?='' OR ("+" OR ".join(c+" LIKE ?" for c in search_columns)+")) AND (?='' OR p.Status=?)"
 params=[search,*([search+"%"]*len(search_columns)),status,status]
 sets=execute(auth+f"""WITH MasterRows AS (SELECT {selection} FROM {source} WHERE {where})
 SELECT * FROM MasterRows ORDER BY {order_by(entity,sort)} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
 SELECT COUNT(*) TotalRows FROM {source} WHERE {where};""",
 [ctx.username,*params,(page-1)*page_size,page_size,*params])
 return {"rows":[{k:str(v) if isinstance(v,Decimal) else v for k,v in row.items()} for row in sets[0]],
         "total":sets[1][0]["TotalRows"],"page":page}
class SharedExport(BaseModel):
 model_config=ConfigDict(extra="forbid")
 columns:list[str]=Field(min_length=1,max_length=8)
 rows:list[list[str|None]]=Field(max_length=500)
def export_view(entity,body):
 from preferences_api import snapshot_xlsx
 if len(body.columns)!=len(set(body.columns)) or any(c not in LABELS[entity] for c in body.columns):
  raise HTTPException(422,"Invalid export columns.")
 return Response(snapshot_xlsx(body,LABELS[entity],{"grade-densities":"Grade Density Master","loss-defaults":"Loss Process Master","loss-processes":"Process Types","ports":"Ports of Entry","categories":"Category Master"}[entity]),
  media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  headers={"Content-Disposition":f'attachment; filename="{entity}.xlsx"',"Cache-Control":"no-store"})
