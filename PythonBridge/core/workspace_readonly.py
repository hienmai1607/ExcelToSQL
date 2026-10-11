"""A plain, protected XLSX snapshot with no macros, credentials or save controls."""
import io,re
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
from fastapi.responses import Response
def column(index):
 result=""
 while index:
  index,rem=divmod(index-1,26);result=chr(65+rem)+result
 return result
def readonly_workbook(columns,rows,labels=None,filename="workspace-readonly.xlsx"):
 labels=labels or {}
 xml=[]
 for n,values in enumerate([[labels.get(key,key) for key in columns],*[[row.get(key) for key in columns] for row in rows]],1):
  cells=[]
  for i,value in enumerate(values,1):
   value=re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]","",str(value) if value is not None else "")
   cells.append(f'<c r="{column(i)}{n}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>')
  xml.append(f'<row r="{n}">{"".join(cells)}</row>')
 out=io.BytesIO()
 with ZipFile(out,"w",ZIP_DEFLATED) as z:
  z.writestr("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  z.writestr("_rels/.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  z.writestr("xl/workbook.xml",'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Read only" sheetId="1" r:id="rId1"/></sheets></workbook>')
  z.writestr("xl/_rels/workbook.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  z.writestr("xl/worksheets/sheet1.xml",'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'+''.join(xml)+'</sheetData><sheetProtection sheet="1" objects="1" scenarios="1"/><autoFilter ref="A1:'+column(len(columns))+str(len(rows)+1)+'"/></worksheet>')
 return Response(out.getvalue(),media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",headers={"Content-Disposition":f'attachment; filename="{filename}"',"Cache-Control":"no-store"})
