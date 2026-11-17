"""Excel Local Update for Ingredients Master and Ingredient Pricing.

Reuses the shared master workbook (modPackagingMasterLocal). Writes go through the
NPD API save functions so locking, audit, mass-unit and overlap rules stay in one place.
"""
import json
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from fastapi import HTTPException
from pydantic import ValidationError
from db import get_raw_cursor, bytes_to_b64
from shared_master_views import LABELS, check_shared_layout, order_by
import npd_api
from npd_api import Ingredient, Price

AUDIT={"CreatedAt":"Created at","CreatedByName":"Created by","UpdatedAt":"Updated at","UpdatedByName":"Updated by"}
COLUMNS={
 "ingredients":{**LABELS["ingredients"],**AUDIT},
 "ingredient-prices":{"IngredientCode":"Ingredient code","Description":"Ingredient description","BaseUoM":"Ingredient base UoM",
  "VendorName":"Vendor","UnitPrice":"Price","CurrencyCode":"Currency","PriceUnit":"Price unit",
  "QuantityFrom":"Quantity from (base UoM)","QuantityTo":"Quantity to (exclusive)","EffectiveFrom":"Effective from","EffectiveTo":"Effective to",
  "ExchangeRateToUSD":"Currency units per USD (other currencies)","Status":"Status",**AUDIT},
}
REQUIRED={"ingredients":("Description","BaseUoM"),
 "ingredient-prices":("IngredientCode","VendorName","UnitPrice","CurrencyCode","PriceUnit","QuantityFrom","EffectiveFrom")}
CONFIG={
 "ingredients":dict(title="Ingredients Master",filename="Ingredients_Master_Local_Update.xlsm",
  editable={"Description","GradeNature","Origin","BaseUoM","Status"}),
 "ingredient-prices":dict(title="Ingredient Pricing",filename="Ingredient_Pricing_Local_Update.xlsm",
  editable={"IngredientCode","VendorName","UnitPrice","CurrencyCode","PriceUnit","QuantityFrom","QuantityTo","EffectiveFrom","EffectiveTo","ExchangeRateToUSD","Status"}),
}
NUMERIC={"UnitPrice","QuantityFrom","QuantityTo","ExchangeRateToUSD"}
# Trusted constants only; user input reaches SQL as parameters.
SOURCE={
 "ingredients":"""SELECT i.ID,i.RowVersion,i.IngredientCode,i.Description,i.GradeNature,i.Origin,u.UoMCode BaseUoM,i.Status,
   i.CreatedAt,cb.UserName CreatedByName,i.UpdatedAt,ub.UserName UpdatedByName
  FROM dbo.NPDIngredient i JOIN dbo.UoM u ON u.ID=i.BaseUoMID
  LEFT JOIN dbo.Users cb ON cb.ID=i.CreatedBy LEFT JOIN dbo.Users ub ON ub.ID=i.UpdatedBy""",
 "ingredient-prices":"""SELECT p.ID,p.RowVersion,i.IngredientCode,i.Description,b.UoMCode BaseUoM,v.VendorName,p.UnitPrice,c.CurrencyCode,
   u.UoMCode PriceUnit,p.QuantityFrom,p.QuantityTo,p.EffectiveFrom,p.EffectiveTo,p.ExchangeRateToUSD,p.Status,
   p.CreatedAt,cb.UserName CreatedByName,p.UpdatedAt,ub.UserName UpdatedByName
  FROM dbo.NPDIngredientPrice p JOIN dbo.NPDIngredient i ON i.ID=p.IngredientID
  JOIN dbo.UoM b ON b.ID=i.BaseUoMID JOIN dbo.UoM u ON u.ID=p.PriceUoMID
  JOIN dbo.Vendor v ON v.ID=p.VendorID JOIN dbo.Currency c ON c.ID=p.CurrencyID
  LEFT JOIN dbo.Users cb ON cb.ID=p.CreatedBy LEFT JOIN dbo.Users ub ON ub.ID=p.UpdatedBy""",
}
FILTER={
 "ingredients":"""(i.Description LIKE ? OR i.IngredientCode LIKE ? OR i.Origin LIKE ?) AND (?='' OR i.Status=?) AND (?='' OR cb.UserName=?)""",
 "ingredient-prices":"""(i.Description LIKE ? OR i.IngredientCode LIKE ? OR v.VendorName LIKE ?) AND (?='' OR p.Status=?) AND (?='' OR cb.UserName=?)
  AND (?='' OR i.IngredientCode=?) AND (?='' OR c.CurrencyCode=?) AND (? IS NULL OR (p.EffectiveFrom<=? AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=?)))""",
}

def require_read(ctx,entity):npd_api.access(ctx,entity)

def rows(cur,sql,*params):
 cur.execute(sql,*params)
 names=[c[0] for c in cur.description]
 return [dict(zip(names,r)) for r in cur.fetchall()]

def text(value):
 if isinstance(value,(bytes,bytearray)):return bytes_to_b64(value)
 if isinstance(value,datetime):
  if value.tzinfo is None:value=value.replace(tzinfo=timezone.utc)
  return value.astimezone(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %I:%M %p")
 if isinstance(value,date):return value.isoformat()
 # Exact, without SQL scale padding; Excel cells and _Original stay comparable.
 if isinstance(value,Decimal):return format(value.normalize(),"f")
 return value

def normalize_row(entity,row):
 result={k:text(v) for k,v in row.items()}
 result.update(Command="",_ID=row["ID"],_RowVersion=result["RowVersion"])
 result["_Original"]=json.dumps({k:result.get(k) for k in COLUMNS[entity]},ensure_ascii=False)
 return result

def dropdowns(cur,entity):
 values=lambda sql:[r[0] for r in cur.execute(sql).fetchall()]
 mass=values("SELECT UoMCode FROM dbo.UoM WHERE Status='Active' AND Category='Weight/Mass' AND BaseFactor>0 ORDER BY UoMCode")
 choices={"Command":["C","U"],"Status":["Active","Block"]}
 if entity=="ingredients":choices["BaseUoM"]=mass
 else:choices.update(PriceUnit=mass,
  IngredientCode=values("SELECT IngredientCode FROM dbo.NPDIngredient WHERE Status='Active' ORDER BY IngredientCode"),
  VendorName=values("SELECT VendorName FROM dbo.Vendor WHERE Status='Active' ORDER BY VendorName"),
  CurrencyCode=values("SELECT CurrencyCode FROM dbo.Currency ORDER BY CurrencyCode"))
 return choices

def page_data(entity,body,ctx,override=False):
 require_read(ctx,entity)
 try:check_shared_layout(entity,body.layout)
 except ValueError as exc:raise HTTPException(422,str(exc)) from exc
 values=body.layout.values
 search=(body.search if override else values.get("search","")) or ""
 status=(body.status if override else values.get("status","")) or ""
 creator=body.creator if override else ""
 params=[search+"%"]*3+[status,status,creator,creator]
 if entity=="ingredient-prices":
  ingredient,currency,as_of=(body.material,body.currency,body.as_of) if override else ("","",None)
  params+=[ingredient,ingredient,currency,currency,as_of,as_of,as_of]
 size=body.layout.page_size
 with get_raw_cursor() as cur:
  npd_api.ready(cur)
  found=rows(cur,"WITH MasterRows AS ("+SOURCE[entity]+" WHERE "+FILTER[entity]+") SELECT * FROM MasterRows ORDER BY "
   +order_by(entity,json.dumps([r.model_dump() for r in body.layout.sort]))+" OFFSET ? ROWS FETCH NEXT ? ROWS ONLY",*params,(body.page-1)*size,size)
  total=cur.execute("SELECT COUNT(*) FROM ("+SOURCE[entity]+" WHERE "+FILTER[entity]+") x",*params).fetchval()
  choices=dropdowns(cur,entity)
 return {"rows":[normalize_row(entity,r) for r in found],"total":total,"page":body.page,"dropdowns":choices}

def build(entity,body,data,base):
 from packaging_master_excel_api import render
 check_shared_layout(entity,body.layout)
 spec=CONFIG[entity];required=REQUIRED[entity];labels=COLUMNS[entity]
 selected=[c for c in body.layout.columns if c in labels]
 if entity=="ingredients" and "IngredientCode" not in selected:selected.insert(0,"IngredientCode")
 selected+=[c for c in required if c not in selected]
 keys=["Command",*selected,*[k for k in labels if k not in selected],"_Result","_Message","_ID","_RowVersion","_Original"]
 friendly={"Command":"Action (C/U)","_Result":"Result","_Message":"Message",**labels}
 headers=[friendly.get(k,k)+(" *" if k in required else " [display]" if k in labels and k not in spec["editable"] else "") for k in keys]
 hidden=[n+1 for n,k in enumerate(keys) if k in ("_ID","_RowVersion","_Original") or k in labels and k not in selected]
 values=body.layout.values
 inputs={"A1":spec["title"]+" Excel Local Update","B3":values.get("search",""),"B4":values.get("status",""),"B5":"",
  "B6":body.page,"B7":body.layout.page_size,"B8":data["total"],"B9":"","B10":"","B11":"",
  "A9":"Ingredient code (Pricing only)","A10":"Currency code (Pricing only)","A11":"Effective on (Pricing only)",
  "A14":"Action: C create, U update; blank unchanged. Use the Status column to block records. Ingredient codes are generated on save. Description, base UoM and audit fields in Pricing are display only."}
 records=[[r.get(k) for k in keys] for r in data["rows"]]
 return render(entity,spec,required,keys,[headers,keys]+records,hidden,body,base,inputs,data["dropdowns"])

def lookup(cur,sql,value,label):
 found=cur.execute(sql,value).fetchall()
 if len(found)!=1:raise ValueError(label+" '"+str(value)+"' was not found or is ambiguous.")
 return found[0][0]

def blank(value):return value is None or str(value).strip()==""

def prepare(entity,edit,source,cur):
 """Merge edited cells onto the refreshed record and resolve codes to IDs."""
 spec=CONFIG[entity]
 if set(edit.changes)-spec["editable"]:raise ValueError("Read-only or unknown field.")
 if edit.command=="U":
  if not source:raise ValueError("Row not found. Refresh.")
  if source["RowVersion"]!=edit.version:raise ValueError("RowVersion conflict. Refresh before saving.")
 values={**source,**edit.changes}
 for key in REQUIRED[entity]:
  if blank(values.get(key)):raise ValueError(COLUMNS[entity][key]+" is required.")
 status=values.get("Status") if not blank(values.get("Status")) else source.get("Status") or "Active"
 identity=dict(ID=edit.id,RowVersion=edit.version,Status=str(status).strip())
 unit="SELECT ID FROM dbo.UoM WHERE UoMCode=?"
 if entity=="ingredients":
  return Ingredient(**identity,Description=str(values["Description"]),Origin=str(values.get("Origin") or ""),
   GradeNature=str(values.get("GradeNature") or ""),BaseUoMID=lookup(cur,unit,str(values["BaseUoM"]).strip(),"Base UoM"))
 dates={}
 for key in ("EffectiveFrom","EffectiveTo"):
  # Reject bare Excel serials; the workbook converts real date cells to ISO text.
  try:dates[key]=None if blank(values.get(key)) else date.fromisoformat(str(values[key]).strip()[:10])
  except ValueError:raise ValueError(COLUMNS[entity][key]+" must be a date (YYYY-MM-DD).") from None
 numbers={}
 for key in NUMERIC:
  try:numbers[key]=None if blank(values.get(key)) else Decimal(str(values[key]).strip())
  except ArithmeticError:raise ValueError(COLUMNS[entity][key]+" must be numeric.") from None
 return Price(**identity,**dates,**numbers,
  IngredientID=lookup(cur,"SELECT ID FROM dbo.NPDIngredient WHERE IngredientCode=? AND Status='Active'",str(values["IngredientCode"]).strip(),"Active ingredient code"),
  VendorID=lookup(cur,"SELECT ID FROM dbo.Vendor WHERE VendorName=? AND Status='Active'",str(values["VendorName"]).strip(),"Active vendor"),
  CurrencyID=lookup(cur,"SELECT ID FROM dbo.Currency WHERE CurrencyCode=?",str(values["CurrencyCode"]).strip(),"Currency"),
  PriceUoMID=lookup(cur,unit,str(values["PriceUnit"]).strip(),"Price unit"))

def message(exc):
 if isinstance(exc,ValidationError):
  return "; ".join(((str(e["loc"][-1])+": ") if e["loc"] else "")+e["msg"].removeprefix("Value error, ") for e in exc.errors())
 return exc.detail if isinstance(exc,HTTPException) else str(exc)

def save(entity,body,ctx):
 npd_api.access(ctx,entity,True)
 ids=[r.id for r in body.rows if r.id]
 results=[]
 with get_raw_cursor() as cur:
  npd_api.ready(cur)
  sources={}
  if ids:
   alias="i" if entity=="ingredients" else "p"
   sources={r["ID"]:normalize_row(entity,r) for r in rows(cur,SOURCE[entity]+f" WHERE {alias}.ID IN (SELECT CAST(value AS INT) FROM OPENJSON(?))",json.dumps(ids))}
  prepared=[]
  for edit in body.rows:
   try:prepared.append((edit,prepare(entity,edit,sources.get(edit.id,{}),cur)))
   except (ValueError,HTTPException) as exc:prepared.append((edit,exc))
 writer=npd_api.ingredient_save if entity=="ingredients" else npd_api.price_save
 for edit,payload in prepared:
  try:
   if isinstance(payload,Exception):raise payload
   row=writer(payload,ctx)["row"]
   results.append(dict(RowNum=edit.row,Status="OK",Message="Created" if edit.command=="C" else "Updated",
    NewID=row["ID"],NewRowVersion=row["RowVersion"],NewIngredientCode=row.get("IngredientCode")))
  except (ValueError,HTTPException) as exc:
   if isinstance(exc,HTTPException) and exc.status_code>=500:raise
   results.append(dict(RowNum=edit.row,Status="ERROR",Message=message(exc)))
 return {"results":results}
