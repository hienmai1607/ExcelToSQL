"""Opportunity-only worksheet layout; Product/PCR workbook contracts are unchanged."""
import re
import json
from xml.etree import ElementTree as ET
from product_excel_api import sheet, col, NS
from shipment_columns import SHIPMENT_GROUPS
from tcb_analysis_columns import TCB_GROUPS, TCB_COLUMNS
from web_item_fields import PRODUCT_FIELDS, REQUEST_FIELDS, RESPONSE_FIELDS, CALCULATED_FIELDS

def format_styles(xml, header_ids, category_ids, keys, header_columns):
    """Colored group/subgroup headers, bordered cells, and unfilled nonwrapping data."""
    def append(tag, children):
        nonlocal xml
        match = re.search(r"<"+tag+r"\b([^>]*)>(.*?)</"+tag+">", xml, re.S)
        start = len(ET.fromstring("<"+tag+">"+match.group(2)+"</"+tag+">"))
        attrs = re.sub(r'count="\d+"', 'count="'+str(start+len(children))+'"', match.group(1))
        xml = xml[:match.start()]+"<"+tag+attrs+">"+match.group(2)+"".join(children)+"</"+tag+">"+xml[match.end():]
        return start
    border = append("borders", ['<border>'+''.join('<'+side+' style="thin"><color rgb="FFB7BDC2"/></'+side+'>' for side in ("left","right","top","bottom"))+'<diagonal/></border>'])
    font = append("fonts", ['<font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>'])
    existing = ET.fromstring("<cellXfs>"+re.search(r"<cellXfs\b[^>]*>(.*?)</cellXfs>",xml,re.S).group(1)+"</cellXfs>")
    def copy(style, fill=None):
        xf = ET.fromstring(ET.tostring(existing[style]))
        if fill is not None:xf.set("fillId",str(fill))
        xf.set("borderId",str(border));xf.set("applyBorder","1");xf.set("applyFill","1")
        return append("cellXfs", [ET.tostring(xf,encoding="unicode")])
    group_colors = {"Opportunity":"FFDCEAF7","Product Info":"FFE2EFDA","Packaging requirements":"FFE8DDF4",
                    "Packaging responses":"FFD9EFEE","Shipment":"FFFFE8CC","Logistics":"FFDCEAF7",
                    "Co-Man":"FFFFE0E5","Others":"FFE8E8E8","Results":"FFE8E8E8","TCB Review":"FFD9E9F4"}
    sub_colors = {"Primary packaging":"FFDCEAF7","Secondary packaging":"FFE2EFDA",
                  "Tertiary packaging":"FFFFE8CC","Palletization":"FFE8DDF4","Packing Way":"FFD9EFEE",
                  "Efficiency":"FFFFE0E5","Pallet load":"FFE4EDCF","Floor load":"FFE0E7F4","FOB Costing":"FFDCEAF7","Destination Logistics":"FFE2EFDA","Co-Man & Fees":"FFFFE8CC","Selling Totals":"FFE8DDF4"}
    groups = list(dict.fromkeys(section(key,header_columns) for key in keys))
    subgroups = list(dict.fromkeys((section(key,header_columns),subgroup(key,section(key,header_columns))) for key in keys))
    def fill(color):
        return append("fills", ['<fill><patternFill patternType="solid"><fgColor rgb="'+color+'"/><bgColor indexed="64"/></patternFill></fill>'])
    group_fills = {group:fill(group_colors.get(group,"FFE8E8E8")) for group in groups}
    sub_fills = {(group,sub):fill(sub_colors.get(sub,group_colors.get(group,"FFE8E8E8"))) for group,sub in subgroups}
    headers = {
        1:[copy(style,group_fills[section(key,header_columns)]) for key,style in zip(keys,header_ids)],
        2:[copy(style,sub_fills[(section(key,header_columns),subgroup(key,section(key,header_columns)))]) for key,style in zip(keys,header_ids)],
        3:[copy(style,sub_fills[(section(key,header_columns),subgroup(key,section(key,header_columns)))]) for key,style in zip(keys,header_ids)],
    }
    categories = {kind:copy(style) for kind,style in category_ids.items()}
    body = append("cellXfs", ['<xf numFmtId="0" fontId="'+str(font)+'" fillId="0" borderId="'+str(border)+'" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="0"/></xf>'])
    locked_font = append("fonts", ['<font><i/><sz val="11"/><color rgb="FF68747D"/><name val="Calibri"/></font>'])
    locked = append("cellXfs", ['<xf numFmtId="0" fontId="'+str(locked_font)+'" fillId="0" borderId="'+str(border)+'" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="0"/></xf>'])
    return xml.encode(), headers, categories, {"normal":body,"locked":locked}

def subgroup(key, group):
    if key in TCB_COLUMNS:
        return next(title for title,fields in TCB_GROUPS if key in fields)
    if key in {"PrimaryNetWeightGrams","SecondaryNetWeightGrams","TertiaryNetWeightGrams"}:
        return "Packing Way"
    if key in {"PalletSize","PalletStacking","MaxPalletHeightM","MaxPalletHeightMM","ResponsePalletSize","ResponsePalletStacking","ResponseMaxPalletHeightMM","CartonsPerLayer","LayersPerPallet","UnitsPerPallet","PacksPerPallet","NetWeightPerPalletKG","PalletType"}:
        return "Palletization"
    if key in {"PalletHeightMM","CartonEfficiencyKGM3","RelativeCartonEfficiencyPct","PalletUtilizationPct","PalletHeightEfficiencyPct"}:
        return "Efficiency"
    if key in {"CartonsPerContainerFloor","NetWeightPerContainerFloorKG"}:
        return "Floor load"
    if key in {"SelectedContainerType","LayersPerContainer","PalletsPerContainer","CalculatedCartonsPerContainer","NetWeightPerContainerKG","CartonsPerContainer"}:
        return "Container Load"
    if key.startswith(("Secondary","SecondPM")):
        return "Secondary packaging"
    if key.startswith(("Tertiary","ThirdPM")):
        return "Tertiary packaging"
    if key.startswith(("Primary","FirstPM")) or key in {"Transparency","PackagingType","RecyclableRequirement","RecycledContent","MetalizedAluminum","SpecialComments"}:
        return "Primary packaging"
    if key in {"RequestedLayerCount","ResponseLayerCount","NumberOfPrimary","NumberOfSecondary","NoOfPrimaryUnit","NoOfSecondaryUnit","NoOfTertiaryUnit","HeightMM","UnitsPerCarton","UnitsPerTertiary"}:
        return "Packing Way"
    return "Overview"

def section(key, header_columns):
    if key in TCB_COLUMNS: return 'TCB Review'
    if key in header_columns or key == "HeaderCommand":
        return "Opportunity"
    if key in ("ContainerRequest", "ConfigurationRequest"):
        return "Shipment"
    for title, fields in SHIPMENT_GROUPS:
        if key in fields:
            return title
    if key in PRODUCT_FIELDS or key in {"ItemNumber","MixUnitQuantity","ItemCommand","ItemDescription","EstPctAwarded","ShelfPrice","Category","Grade","MixRatioPct"}:
        return "Product Info"
    if key in REQUEST_FIELDS or key in {"PackagingType","MaxPalletHeightM"}:
        return "Packaging requirements"
    if key in RESPONSE_FIELDS or key in {"PackagingRequestNumber","PackagingResponseStage"}:
        return "Packaging responses"
    return "Results" if key.startswith("_") else "Packaging responses"

CHILD_PRODUCT_FIELDS = {"ProductCode","ItemDescription","AnnualUnit","EstPctAwarded","ShelfPrice"}

def lock_reason(key, record, records, header_columns, editable, shipment_columns, parent_fields):
    if key not in editable:
        return ""
    original = json.loads(record.get("_Original") or "{}")
    if original.get("HeaderStage") not in (None,"","Draft"):
        return "Locked: Opportunity is not Draft."
    if key in header_columns:
        return ""
    if original.get("ItemStage") not in (None,"","Draft"):
        return "Locked: item is not Draft."
    parent = original.get("ParentItemID")
    if parent and key in shipment_columns | parent_fields | CHILD_PRODUCT_FIELDS:
        owner = next(((i+5,r) for i,r in enumerate(records) if str(r.get("_ItemID")) == str(parent)), None)
        where = ("row "+str(owner[0])+" (item "+str(owner[1].get("ItemNumber") or parent)+")") if owner else ("item ID "+str(parent))
        return "Inherited from Mix parent. Edit "+where+" instead."
    if original.get("HasOpenPackagingRequest") and key not in shipment_columns:
        return "Locked while a Packaging Request is processing. Only shipment/cost inputs can be edited."
    return ""

def workbook_sheet(keys, labels, records, hidden, header_ids, category_ids, header_columns, editable, required, shipment_columns, parent_fields, body_id):
    kinds = ["calculated" if k in CALCULATED_FIELDS | TCB_COLUMNS else "editable" if k in editable or k in ("HeaderCommand","ItemCommand","OpportunityNumber") else "display" for k in keys]
    categories = [{"editable":"Editable","calculated":"Auto calculate","display":"Display only"}[kind]+(" *" if key in required else "") for key,kind in zip(keys,kinds)]
    groups = [section(key, header_columns) for key in keys]
    subgroups = [subgroup(key,group) for key,group in zip(keys,groups)]
    locks = {(ri+5,ci):lock_reason(key,record,records,header_columns,editable,shipment_columns,parent_fields) for ri,record in enumerate(records) for ci,key in enumerate(keys)}
    rows = [groups,subgroups,labels,categories]+[[row.get(key) for key in keys] for row in records]
    root = ET.fromstring(sheet(rows, hidden, True, False))
    q = lambda name: "{"+NS+"}"+name
    pane = root.find(".//"+q("pane"));pane.set("ySplit","4");pane.set("topLeftCell","A5")
    root.insert(1,ET.Element(q("sheetFormatPr"),defaultRowHeight="18",customHeight="1"))
    data = root.find(q("sheetData"))
    data[1].attrib.pop("hidden",None)
    for ri,row in enumerate(data,1):
        if ri in (1,2,3,4):
            row.set("ht","18" if ri != 3 else "42");row.set("customHeight","1")
        elif ri >= 5:
            row.set("ht","18");row.set("customHeight","1")
        for ci,cell in enumerate(row):
            kind = kinds[ci]
            if ri in (1,2,3):
                cell.set("s",str(header_ids[ri][ci]))
            elif ri == 4:
                cell.set("s",str(category_ids[kind]))
            elif ri >= 5:
                cell.set("s",str(body_id["locked" if locks.get((ri,ci)) else "normal"]))
    ET.SubElement(root,q("autoFilter"),ref="A4:"+col(len(keys))+str(max(5,len(rows))))
    merges = ET.SubElement(root,q("mergeCells"))
    # Merge adjacent selected columns only; never merge across hidden fields.
    for row_number, titles in ((1,groups),(2,[(group,sub) for group,sub in zip(groups,subgroups)])):
        start = None
        for i in range(len(keys)+1):
            visible = i < len(keys) and i+1 not in hidden
            if start is not None and (not visible or titles[i] != titles[start]):
                if i-start > 1:
                    ET.SubElement(merges,q("mergeCell"),ref=col(start+1)+str(row_number)+":"+col(i)+str(row_number))
                    for cell in list(data[row_number-1])[start+1:i]:
                        cell.find(q("is")+"/"+q("t")).text = ""
                start = None
            if visible and start is None:
                start = i
    merges.set("count",str(len(merges)))
    if not len(merges):
        root.remove(merges)
    choices = {"HeaderCommand":"N,C,U,D","ItemCommand":"N,C,U,D","ContainerRequest":"20DC,20RC,40DC,40HC,40RHC",
               "ConfigurationRequest":"Pallet load,Floor load,Both","Incoterm":"CFA,DDP,EXW,FOB","ContainerSizeFT":"20FT,40FT"}
    validations = ET.SubElement(root,q("dataValidations"))
    for key,options in choices.items():
        position = col(keys.index(key)+1)
        ranges = " ".join(position+str(ri) for ri in range(5,max(6,len(rows)+1)) if not locks.get((ri,keys.index(key))))
        ranges += (" " if ranges else "")+position+str(max(6,len(rows)+1))+":"+position+"1048576"
        validation = ET.SubElement(validations,q("dataValidation"),type="list",allowBlank="1",showErrorMessage="1",
            errorTitle="Choose a listed value",error="Select a value from the dropdown.",sqref=ranges)
        ET.SubElement(validation,q("formula1")).text = '"'+options+'"'
    for (ri,ci),reason in locks.items():
        if reason:
            validation = ET.SubElement(validations,q("dataValidation"),type="custom",allowBlank="1",showInputMessage="1",
                promptTitle="Locked field",prompt=reason,sqref=col(ci+1)+str(ri))
            ET.SubElement(validation,q("formula1")).text = "TRUE"
    validations.set("count",str(len(validations)))
    return ET.tostring(root,encoding="utf-8",xml_declaration=True)
