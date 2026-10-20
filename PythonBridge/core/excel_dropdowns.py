"""Shared dropdowns for local-update workbooks; lookup values remain text, never formulas."""
import io
import re
import zipfile
from xml.etree import ElementTree as ET

NS="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL="http://schemas.openxmlformats.org/package/2006/relationships"
DOCREL="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT="http://schemas.openxmlformats.org/package/2006/content-types"
def col(number):
    value=""
    while number:
        number,rem=divmod(number-1,26)
        value=chr(65+rem)+value
    return value

def serialize_part(root,original=b""):
    # ElementTree drops namespace declarations used only by mc:Ignorable values.
    # Keep those aliases without changing its process-global namespace registry.
    result=ET.tostring(root,encoding="utf-8",xml_declaration=True)
    opening=re.search(rb"<[^?][^>]*>",result)
    aliases=[]
    original_opening=re.search(rb"<[^?][^>]*>",original)
    for declaration in re.findall(rb'xmlns(?::[A-Za-z0-9_.-]+)?="[^"]*"',original_opening.group() if original_opening else b""):
        name=declaration.split(b"=",1)[0]
        if name+b"=" not in opening.group():
            aliases.append(declaration)
    if aliases:
        result=result[:opening.end()-1]+b" "+b" ".join(aliases)+result[opening.end()-1:]
    return result

def with_dropdowns(blob,choices):
    with zipfile.ZipFile(io.BytesIO(blob)) as source:
        parts={name:source.read(name) for name in source.namelist()}
    data=ET.fromstring(parts["xl/worksheets/sheet1.xml"])
    keys={cell.findtext("./{"+NS+"}is/{"+NS+"}t"):re.sub(r"\d+$","",cell.attrib["r"])
          for cell in data.findall("./{"+NS+"}sheetData/{"+NS+"}row[@r='2']/{"+NS+"}c")}
    first_data=3
    config=ET.fromstring(parts["xl/worksheets/sheet3.xml"])
    config_keys={cell.findtext("./{"+NS+"}is/{"+NS+"}t"):re.sub(r"\d+$","",cell.attrib["r"])
          for cell in config.findall("./{"+NS+"}sheetData/{"+NS+"}row[@r='10']/{"+NS+"}c")}
    if "HeaderCommand" in config_keys:
        keys=config_keys
        first_data=5
    existing=data.find("{"+NS+"}dataValidations")
    if existing is not None:data.remove(existing)
    validations=ET.Element("{"+NS+"}dataValidations")
    workbook=ET.fromstring(parts["xl/workbook.xml"])
    names=workbook.find("{"+NS+"}definedNames")
    if names is None:
        names=ET.Element("{"+NS+"}definedNames")
        before=next((i for i,node in enumerate(workbook) if node.tag.split("}")[-1] in ("calcPr","oleSize","customWorkbookViews","pivotCaches","extLst")),len(workbook))
        workbook.insert(before,names)
    for old in list(names):
        if old.get("name","").startswith("PB_DD_"):names.remove(old)
    lists=ET.Element("{"+NS+"}worksheet")
    rows=ET.SubElement(lists,"{"+NS+"}sheetData")
    selected=[]
    for key,values in choices.items():
        if key not in keys:continue
        values=list(dict.fromkeys(str(v) for v in values if v is not None and str(v)!=""))
        if not values:continue
        if len(values)>100000 or any(len(v)>32767 for v in values):raise ValueError("Dropdown list exceeds Excel limits.")
        selected.append((key,values))
    for n,(key,values) in enumerate(selected,1):
        column=col(n)
        for ri,value in enumerate([key,*values],1):
            while len(rows)<ri:ET.SubElement(rows,"{"+NS+"}row",r=str(len(rows)+1))
            cell=ET.SubElement(rows[ri-1],"{"+NS+"}c",r=column+str(ri),t="inlineStr")
            ET.SubElement(ET.SubElement(cell,"{"+NS+"}is"),"{"+NS+"}t").text=value
        name="PB_DD_"+key
        ET.SubElement(names,"{"+NS+"}definedName",name=name).text="'_Lists'!$"+column+"$2:$"+column+"$"+str(len(values)+1)
        validation=ET.SubElement(validations,"{"+NS+"}dataValidation",type="list",allowBlank="1",showErrorMessage="1",showInputMessage="1",showDropDown="0",errorStyle="stop",errorTitle="Choose a listed value",error="Refresh the workbook to obtain current choices.",sqref=keys[key]+str(first_data)+":"+keys[key]+"1048576")
        if key=="ParentType":
            validation.set("showErrorMessage","0")
            validation.set("promptTitle","Multiple Parent Types")
            validation.set("prompt","Choose one parent, or type parent names separated by semicolons. Save validates every link.")
        ET.SubElement(validation,"{"+NS+"}formula1").text=name
    validations.set("count",str(len(selected)))
    # Schema order: after autoFilter and before print/page controls.
    insert=next((i for i,node in enumerate(data) if node.tag.split("}")[-1] in ("pageMargins","pageSetup","headerFooter","drawing","legacyDrawing","extLst")),len(data))
    data.insert(insert,validations)
    sheets=workbook.find("{"+NS+"}sheets")
    rels=ET.fromstring(parts["xl/_rels/workbook.xml.rels"])
    previous=next((s for s in sheets if s.get("name")=="_Lists"),None)
    if previous is None:
        sid=max(int(s.get("sheetId")) for s in sheets)+1
        rid="rId"+str(max([int(r.get("Id")[3:]) for r in rels if re.fullmatch(r"rId\d+",r.get("Id",""))]+[0])+1)
        ET.SubElement(sheets,"{"+NS+"}sheet",name="_Lists",sheetId=str(sid),state="veryHidden",attrib={"{"+DOCREL+"}id":rid})
        ET.SubElement(rels,"{"+REL+"}Relationship",Id=rid,Type=DOCREL+"/worksheet",Target="worksheets/pbDropdownLists.xml")
    types=ET.fromstring(parts["[Content_Types].xml"])
    if not any(n.get("PartName")=="/xl/worksheets/pbDropdownLists.xml" for n in types):
        ET.SubElement(types,"{"+CT+"}Override",PartName="/xl/worksheets/pbDropdownLists.xml",ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")
    for name,root in {"xl/worksheets/sheet1.xml":data,"xl/worksheets/pbDropdownLists.xml":lists,"xl/workbook.xml":workbook,"xl/_rels/workbook.xml.rels":rels,"[Content_Types].xml":types}.items():
        parts[name]=serialize_part(root,parts.get(name,b""))
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as target:
        for name,content in parts.items():target.writestr(name,content)
    return output.getvalue()

def master_choices(entity,ctx):
    from packaging_master_api import lookups
    from packaging_orders import TYPE_FLAGS
    data=lookups(ctx,entity)
    def values(group,column):
        return [r[column] for r in data.get(group,[]) if r.get("Status","Active")=="Active" and r.get(column) is not None]
    choices={"Command":["C","U"],"Status":["Active","Block"]}
    if entity=="products":
        choices.update(CustomerName=values("customers","CustomerName"),Category=values("categories","CategoryName"))
    if entity=="packaging-types":
        choices.update({key:["True","False"] for key in [*TYPE_FLAGS,"Shipping","FinalComponent"]})
        choices["ParentType"]=[r["PackagingOrder"]+" / "+r["PackagingType"] for r in data.get("packagingTypes",[]) if r.get("Status")=="Active" and not r.get("FinalComponent")]
    if entity in ("materials","raw-materials","pallets","prices","raw-prices"):
        choices.update(UnitOfMeasure=values("uoms","UoMCode"),BaseUoM=values("uoms","UoMCode"))
    if entity in ("prices","raw-prices"):
        choices.update(VendorName=values("vendors","VendorName"),MaterialCode=values("materials","MaterialCode"),CurrencyCode=values("currencies","CurrencyCode"))
    if entity=="uoms":
        from uom_categories import CATEGORIES
        choices["Category"]=list(CATEGORIES)
    if entity=="vendors":choices["CurrencyCode"]=values("currencies","CurrencyCode")
    if entity=="materials":
        choices["PackagingType"]=[r["PackagingOrder"]+" / "+r["PackagingType"] for r in data.get("packagingTypes",[]) if r.get("Status")=="Active" and r.get("FinalComponent") and not r.get("HasChildren")]
        choices["MaterialDimensionID"]=[r["ID"] for r in data.get("materialDimensions",[]) if r.get("Status")=="Active"]
        choices["TareWeightBasis"]=["kg/EA","kg/m2"]
    if entity=="raw-materials":
        choices["GradeName"]=[r["GradeName"] for r in data.get("rawGrades",[]) if r.get("Status")=="Active" and not r.get("HasChildren")]
    return choices

def transaction_choices(ctx,editable,packaging=False):
    from typing import get_args,get_origin,Literal
    from packaging_fields import ItemFields,ResponseFields
    from shipment_fields import ShipmentCostInfo
    from packaging_api import lookups,execute
    from container_loading import CONTAINER_TYPES
    def literals(annotation):
        if annotation is bool:return ["True","False"]
        if get_origin(annotation) is Literal:return [str(v) for v in get_args(annotation)]
        return [v for child in get_args(annotation) for v in literals(child)]
    choices={}
    for model in (ItemFields,ResponseFields,ShipmentCostInfo):
        for key,field in model.model_fields.items():
            values=literals(field.annotation)
            if key in editable and values:choices[key]=values
    fixed={"PackagingLayerCount":["1","2","3"],"ResponseLayerCount":["1","2","3"],"ContainerRequest":list(CONTAINER_TYPES),"ContainerType":list(CONTAINER_TYPES),"ConfigurationRequest":["Pallet load","Floor load","Both"],"PalletStacking":["Single","Double"],"ResponsePalletStacking":["Single","Double"],"Transparency":["Transparent","Opaque","NA"]}
    choices.update({k:v for k,v in fixed.items() if k in editable})
    if packaging:
        if not ctx.is_admin and not ({"Packaging","PackagingManager"} & set(ctx.scopes)):return {}
        data=lookups(ctx)
    else:
        from packaging_orders import decode_orders
        data={"packagingTypes":decode_orders(execute("EXEC dbo.usp_OpportunityPackagingTypeLookup_Read ?",[ctx.username])[0]),
              "pallets":execute("EXEC dbo.usp_OpportunityPalletLookup_Read ?",[ctx.username])[0]}
    types=data.get("packagingTypes",[])
    from packaging_orders import ORDERS
    for order,idkey,namekey in zip(ORDERS,("PrimaryTypeID","SecondaryTypeID","TertiaryTypeID"),("FirstPMType","SecondPMType","ThirdPMType")):
        eligible=[r for r in types if r.get("Status","Active")=="Active" and r.get("ParentTypeID") is None and any(o in r.get("PackagingOrders",[]) for o in (order,order+" Mix"))]
        if idkey in editable:choices[idkey]=[str(r["ID"]) for r in eligible]
        if namekey in editable:choices[namekey]=[r["PackagingType"] for r in eligible]
    if "PalletSize" in editable:choices["PalletSize"]=[r["PalletSize"] for r in data.get("pallets",[]) if r.get("Status","Active")=="Active" and r.get("PalletSize")]
    if "ResponsePalletSize" in editable:choices["ResponsePalletSize"]=[r["PalletSize"] for r in data.get("pallets",[]) if r.get("Status","Active")=="Active" and r.get("PalletSize")]
    if not packaging:
        for key,proc,column in (("CustomerName","usp_OpportunityCustomerLookup_Read","CustomerName"),("ProductCode","usp_OpportunityProductLookup_Read","ProductCode")):
            if key in editable:
                choices[key]=[r[column] for r in execute("EXEC dbo."+proc+" ?",[ctx.username])[0]]
    choices.update({"ItemCommand":["U"]} if packaging else {"HeaderCommand":["C","U"],"ItemCommand":["C","U"]})
    return choices

def normalize_booleans(values,model):
    from typing import get_args
    def boolean(annotation):
        return annotation is bool or any(boolean(arg) for arg in get_args(annotation))
    result=dict(values)
    for key,value in values.items():
        field=model.model_fields.get(key)
        if field and boolean(field.annotation) and isinstance(value,str) and value.strip().lower() in ("true","false"):
            result[key]=value.strip().lower()=="true"
    return result
