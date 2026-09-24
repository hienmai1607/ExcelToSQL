import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch, MagicMock
from contextlib import contextmanager
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import product_excel_api as m
from auth import AccessContext

class Contracts(unittest.TestCase):
 def setUp(self):
  self.ctx=AccessContext(1,"Admin",frozenset({"Admin"}))
  self.view=m.View(layout=dict(columns=["Grade","ProductName"],filters=["search"],values={},sort=[],page_size=200),page=1)
 def test_workbook_preserves_macros_and_hidden_keys(self):
  row=dict(ID=4,RowVersion="AAAAAAAAAAE=",ProductName="=CMD()",Grade="A",WeightGrams="100",Category="Nuts")
  blob=m.build(self.view,dict(rows=[row],total=1),"http://127.0.0.1:8000")
  with zipfile.ZipFile(io.BytesIO(blob)) as z,zipfile.ZipFile(m.TEMPLATE) as original:
   self.assertEqual(z.read("xl/vbaProject.bin"),original.read("xl/vbaProject.bin"))
   sheet=z.read("xl/worksheets/sheet1.xml").decode()
   self.assertIn("=CMD()",sheet);self.assertNotIn("<f>",sheet)
   self.assertLess(sheet.index("Grade"),sheet.index("Product name"))
   self.assertIn('_RowVersion',sheet);self.assertIn('hidden="1"',sheet)
   self.assertIn('http://127.0.0.1:8000',z.read("xl/worksheets/sheet3.xml").decode())
 def test_headers_classify_fields_and_keep_required_marker(self):
  from xml.etree import ElementTree as E
  with zipfile.ZipFile(io.BytesIO(m.build(self.view,dict(rows=[],total=0),"http://localhost:8000"))) as z:
   ns={"s":m.NS}
   data=E.fromstring(z.read("xl/worksheets/sheet1.xml"))
   styles=E.fromstring(z.read("xl/styles.xml"))
   headers=data.find("s:sheetData/s:row",ns)
   fills=styles.find("s:fills",ns);formats=styles.find("s:cellXfs",ns)
   def color(cell):
    fmt=formats[int(cell.attrib["s"])]
    return fills[int(fmt.attrib["fillId"])].find("s:patternFill/s:fgColor",ns).attrib["rgb"]
   self.assertEqual(color(headers[1]),"FFDDEBF7") # Grade
   self.assertEqual(color(headers[2]),"FFFFF2CC") # Product name
   self.assertTrue(headers[2].find("s:is/s:t",ns).text.endswith(" *"))
   self.assertEqual(color(headers[-1]),"FFE7E6E6") # metadata
 def test_required_columns_cannot_be_hidden_in_download(self):
  from xml.etree import ElementTree as E
  self.assertEqual(self.view.layout.columns,["Grade","ProductName","ProductCode","Category","WeightGrams"])
  with zipfile.ZipFile(io.BytesIO(m.build(self.view,dict(rows=[],total=0),"http://localhost:8000"))) as z:
   ns={"s":m.NS}
   data=E.fromstring(z.read("xl/worksheets/sheet1.xml"))
   keys=data.findall("s:sheetData/s:row",ns)[1]
   columns=data.findall("s:cols/s:col",ns)
   for index,cell in enumerate(keys,1):
    if cell.find("s:is/s:t",ns).text in m.REQUIRED:
     matching=[c for c in columns if int(c.attrib["min"])<=index<=int(c.attrib["max"])]
     self.assertTrue(all(c.attrib.get("hidden","0")!="1" for c in matching))
 def test_invalid_layout_patch_and_duplicate_rejected(self):
  from pydantic import ValidationError
  with self.assertRaises(ValidationError):
   m.View(layout=dict(columns=["RowVersion"],filters=[],sort=[]))
  with self.assertRaises(ValidationError):
   m.Edit(row=3,command="U",id=1,version="AAAAAAAAAAE=",changes={"CreatedByName":"fake"})
  with self.assertRaises(ValidationError):
   m.Batch(rows=[dict(row=3,command="C"),dict(row=3,command="C")])
 def test_partial_update_sends_only_changed_fields(self):
  cursor=MagicMock()
  @contextmanager
  def db():yield cursor
  with patch.object(m,"get_raw_cursor",db),patch.object(m,"consume",return_value=[[{"RowVersion":b"12345678"}]]):
   m.save(m.Batch(rows=[dict(row=3,command="U",id=4,version="AAAAAAAAAAE=",changes={"Grade":None})]),self.ctx)
   call=cursor.execute.call_args_list[1].args
   self.assertEqual(json.loads(call[-1]),{"Grade":None})
   self.assertEqual(call[1],"Admin")
   self.assertEqual(call[2],4)
 def test_scope_is_required(self):
  from fastapi import HTTPException
  with self.assertRaises(HTTPException) as caught:
   m.save(m.Batch(rows=[dict(row=3,command="C")]),AccessContext(2,"Sales",frozenset({"Opportunity"})))
  self.assertEqual(caught.exception.status_code,403)

if __name__=="__main__":unittest.main()
