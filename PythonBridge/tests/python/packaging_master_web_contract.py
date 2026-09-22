import sys,io,json,unittest
from pathlib import Path
from decimal import Decimal
from unittest.mock import patch
from zipfile import ZipFile
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from auth import AccessContext
from fastapi import HTTPException
from pydantic import ValidationError
import packaging_master_api as api
from preferences_api import Settings
class MasterContracts(unittest.TestCase):
 def test_product_read_and_role_isolation(self):
  ctx=AccessContext(1,"Product user",frozenset({"Product"}))
  with patch.object(api,"execute",return_value=[[{"WeightGrams":Decimal("100.00")}],[{"Total":1}]]) as sql:
   result=api.read("products",1,25,"P","Active",None,None,None,1,'[{"column":"WeightGrams","direction":"desc"}]',ctx)
   self.assertEqual(result["rows"][0]["WeightGrams"],"100.00")
   self.assertIn("N'Admin',N'Product'",sql.call_args.args[0])
   self.assertIn("[WeightGrams] DESC",sql.call_args.args[0])
  with patch.object(api,"execute") as sql:
   with self.assertRaises(HTTPException):
    api.read("products",1,25,"",None,None,None,None,None,"[]",AccessContext(2,"Packaging",frozenset({"Packaging"})))
   with self.assertRaises(HTTPException):api.lookups(ctx,"materials")
   sql.assert_not_called()
 def test_product_layout_and_export(self):
  settings=Settings(masters={"products":{"columns":["ProductName","WeightGrams"],"filters":["search","created_by"],"sort":[{"column":"WeightGrams"}]}})
  self.assertEqual(settings.masters["products"].columns[0],"ProductName")
  response=api.export("products",api.Export(columns=["ProductName","WeightGrams"],rows=[["=unsafe","100.00"]]),AccessContext(1,"Product",frozenset({"Product"})))
  with ZipFile(io.BytesIO(response.body)) as z:
   self.assertIn('name="Products"',z.read("xl/workbook.xml").decode())
   self.assertNotIn("<f>",z.read("xl/worksheets/sheet1.xml").decode())
 def test_read_is_authorized_and_parameterized(self):
  with patch.object(api,"execute",return_value=[[{"UnitPrice":Decimal("12345678901234.1234")}],[{"Total":1}]]) as sql:
   result=api.read("prices",2,25,"x'; DROP TABLE x;--","Active",3,4,None,5,'[{"column":"UnitPrice","direction":"desc"}]',AccessContext(1,"Admin",frozenset({"Admin"})))
   self.assertEqual(result["rows"][0]["UnitPrice"],"12345678901234.1234")
   self.assertNotIn("DROP TABLE",sql.call_args.args[0])
   self.assertIn("[UnitPrice] DESC, ID ASC",sql.call_args.args[0])
   self.assertIn("MasterRead",sql.call_args.args[0])
   self.assertIn(25,sql.call_args.args[1])
 def test_access_and_sort_rejection(self):
  with patch.object(api,"execute") as sql:
   with self.assertRaises(HTTPException):
    api.read("materials",1,25,"",None,None,None,None,None,"[]",AccessContext(1,"Sales",frozenset({"Opportunity"})))
   sql.assert_not_called()
  for sort in ('[{"column":"Password"}]','[{"column":"UnitPrice","direction":"drop"}]','[{"column":"Status"},{"column":"Status"}]'):
   with self.assertRaises(HTTPException):api.order_by("prices",sort)
 def test_saved_layout_schema(self):
  s=Settings(masters={"materials":{"columns":["MaterialName","CreatedByName"],"filters":["search"],"values":{"search":"ABC"},"sort":[{"column":"MaterialName","direction":"asc"}]}})
  self.assertEqual(s.masters["materials"].columns[1],"CreatedByName")
  with self.assertRaises(ValidationError):
   Settings(masters={"materials":{"columns":["UnitPrice"],"filters":[]}})
 def test_packaging_export(self):
  body=api.Export(columns=["MaterialCode","UnitPrice"],rows=[["=HYPERLINK(1)","0.0001"]])
  response=api.export("prices",body,AccessContext(1,"Manager",frozenset({"PackagingManager"})))
  with ZipFile(io.BytesIO(response.body)) as z:
   sheet=z.read("xl/worksheets/sheet1.xml").decode()
   self.assertIn("0.0001",sheet);self.assertNotIn("<f>",sheet)
   self.assertIn('name="Packaging"',z.read("xl/workbook.xml").decode())
  with self.assertRaises(HTTPException):
   api.export("materials",body,AccessContext(1,"Admin",frozenset({"Admin"})))
if __name__=="__main__":unittest.main()
