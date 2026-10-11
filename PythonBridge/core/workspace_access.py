"""Page permissions supplement, never replace, SQL workflow/ownership checks."""
from fastapi import HTTPException
LEVELS = {"none": 0, "display": 1, "edit": 2}
PAGES = {
 "opportunities":"Opportunities","customers":"Customers","products":"Products",
 "requests":"Packaging Requests","materials":"Packaging Material","prices":"Packaging Pricing",
 "packaging-types":"Packaging Types","packaging-dimensions":"Packaging Dimensions","pallets":"Pallet Master",
 "raw-materials":"Raw Material","raw-prices":"Raw Pricing","raw-grades":"Raw Grade Master",
 "categories":"Category Master","loss-processes":"Loss Master","ports":"Ports of Entry",
 "vendors":"Vendors","conversions":"Unit Conversions","uoms":"Units of Measure"}
ADMIN_EDIT_ONLY = set()
SCOPES = {"Admin","Customer","Product","Opportunity","Packaging","PackagingManager","RawMaterial"}
DEFAULTS = {
 "Customer":{"customers":"edit","ports":"display"},
 "Product":{"products":"edit","categories":"display","loss-processes":"display"},
 "Opportunity":{"opportunities":"edit","requests":"display","ports":"display","loss-processes":"display"},
 "Packaging":{k:"edit" for k in ("requests","materials","prices","packaging-types","packaging-dimensions","pallets","vendors","conversions")},
 "PackagingManager":{**{k:"display" for k in ("materials","prices","packaging-types","packaging-dimensions","pallets","vendors","conversions")},"requests":"edit"},
 "RawMaterial":{k:"edit" for k in ("raw-materials","raw-prices","raw-grades","conversions")}}
def merge_permissions(direct_scopes, role_permissions):
 result={key:"none" for key in PAGES}
 if "Admin" in direct_scopes:return {key:"edit" for key in PAGES}
 for permissions in [*(DEFAULTS.get(scope,{}) for scope in direct_scopes),*role_permissions]:
  for key,level in permissions.items():
   if key in result and LEVELS.get(level,-1)>LEVELS[result[key]]:result[key]=level
 return result
def permission_scopes(permissions):
 result=set()
 for page,level in permissions.items():
  if level=="none":continue
  if page=="opportunities":result.add("Opportunity")
  elif page in ("customers","ports"):result.add("Customer")
  elif page in ("products","categories"):result.add("Product")
  elif page=="loss-processes":result.add("Opportunity")
  elif page.startswith("raw-"):result.add("RawMaterial")
  else:result.add("Packaging" if level=="edit" else "PackagingManager")
  if page=="requests" and level=="edit":result.add("PackagingManager")
  if page=="conversions" and level=="edit":result.add("RawMaterial")
 return result
def can_edit(ctx,page):
 return ctx.is_admin or ctx.permissions is None or ctx.permissions.get(page)=="edit"

def route_pages(path):
 parts=path.strip("/").split("/")
 if len(parts)<2:return ()
 # Lookup data needed by another permitted editor is not independent page access.
 if path=="/api/customer/lookups":return ("customers","opportunities","products","ports")
 if path=="/api/opportunity/lookups":return ("opportunities",)
 if path.startswith("/api/workbench/masters/lookups"):return tuple(PAGES)
 if path=="/api/packaging/manual":return ("opportunities",)
 if "/attachments" in path:return ("opportunities","requests")
 if path.startswith("/api/packaging/lookups"):return ("requests","opportunities","materials","prices","packaging-types","packaging-dimensions","pallets")
 if "/raw-grade-lookups" in path or path.endswith("/raw-pricing"):return ("products","opportunities","raw-grades")
 if path.startswith("/api/workbench/master-excel/") or path.startswith("/api/workbench/masters/"):
  return (parts[3],) if len(parts)>3 and parts[3] in PAGES else ()
 if path.startswith("/api/workbench/opportunity-excel"):return ("opportunities",)
 if path.startswith("/api/workbench/packaging-excel"):return ("requests",)
 if path.startswith("/api/workbench/product-excel"):return ("products",)
 if path.startswith("/api/workbench/requests") or path.startswith("/api/workbench/pics"):return ("requests","opportunities")
 resource=parts[1]
 if resource=="raw-material" and len(parts)>2:return ({"material":"raw-materials","price":"raw-prices","grade":"raw-grades"}.get(parts[2],"raw-materials"),)
 simple={"customer":"customers","product":"products","opportunity":"opportunities","raw-material":"raw-materials",
 "raw-materials":"raw-materials","raw-prices":"raw-prices","raw-grades":"raw-grades","unit-conversions":"conversions",
 "pallets":"pallets","packaging-types":"packaging-types","packaging-dimensions":"packaging-dimensions",
 "categories":"categories","loss-processes":"loss-processes","ports":"ports"}
 if resource in simple:return (simple[resource],)
 if resource=="raw" and len(parts)>2:return ({"material":"raw-materials","price":"raw-prices","grade":"raw-grades"}.get(parts[2],""),)
 if resource=="packaging":
  if len(parts)>2 and parts[2] in ("material","price","vendor","uom"):
   return ({"material":"materials","price":"prices","vendor":"vendors","uom":"uoms"}[parts[2]],)
  return ("requests",)
 # Item-level TCB entries belong to the Opportunity editor, not the request editor.
 if resource in ("opportunity-items", "opportunity-item"):return ("opportunities",)
 return ()

def enforce_route(ctx,path,method):
 if ctx.is_admin:return
 if path.startswith(("/api/administrator","/api/user","/api/market","/api/currency")):
  raise HTTPException(403,"Administrator access is required.")
 if ctx.permissions is None:return # Older databases retain the existing SQL policy.
 if path=="/api/workbench/session" or path.startswith("/api/workbench/preferences"):return
 pages=route_pages(path)
 if not pages:raise HTTPException(403,"No page access is assigned for this API.")
 read=method in ("GET","HEAD","OPTIONS") or path.endswith(("/export","/page","/download","/preview","/preview-formula","/preview-volume","/readonly"))
 needed=1 if read else 2
 if not any(LEVELS.get(ctx.permissions.get(page,"none"),0)>=needed for page in pages):
  raise HTTPException(403,"Display-only or missing page access; editing is not permitted." if not read else "No access to this page.")

def require_page_edit(ctx,page):
 if not ctx.is_admin and (ctx.permissions is None or ctx.permissions.get(page)!="edit"):
  raise HTTPException(403,"Edit access is required for this page.")
