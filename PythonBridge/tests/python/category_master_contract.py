"""Category API, lookup, layout and validation contracts."""
import sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from pydantic import ValidationError
from auth import AccessContext
import category_api as api
import packaging_master_api as masters
from preferences_api import Settings
from shared_master_views import order_by, SharedExport, export_view
from packaging_fields import sql_error

ADMIN=AccessContext(1,"Admin",frozenset({"Admin"}))
PRODUCT=AccessContext(2,"Product",frozenset({"Product"}))
class CategoryContract(unittest.TestCase):
 def test_input_and_row_version(self):
  self.assertEqual(api.CategorySave(CategoryName="  Nuts  ").CategoryName,"Nuts")
  for payload in (dict(CategoryName=" "),dict(CategoryName="Nuts",ID=1),dict(CategoryName="x"*101),dict(CategoryName="Nuts",Status="Delete")):
   with self.assertRaises(ValidationError):api.CategorySave(**payload)
 def test_admin_only_save(self):
  with self.assertRaises(HTTPException) as error:api.save(api.CategorySave(CategoryName="Nuts"),PRODUCT)
  self.assertEqual(error.exception.status_code,403)
  with patch.object(api,"execute",return_value=[[{"ID":1}]]) as execute:
   self.assertEqual(api.save(api.CategorySave(CategoryName="Nuts"),ADMIN)["rows"][0]["ID"],1)
   self.assertEqual(execute.call_args.args[1],["Admin",None,None,"Nuts","Active"])
 def test_concurrency_and_duplicate_errors(self):
  for message,status in (("Category changed. Refresh and retry. (52997)",409),("Duplicate (2627)",422),("This Category is used by Products. (52964)",422)):
   with patch.object(api,"execute",side_effect=RuntimeError(message)):
    with self.assertRaises(HTTPException) as error:api.save(api.CategorySave(CategoryName="Nuts"),ADMIN)
    self.assertEqual(error.exception.status_code,status)
 def test_product_lookups_include_categories(self):
  categories=[{"ID":1,"CategoryName":"Nuts","Status":"Block"}]
  with patch.object(masters,"execute",return_value=[[],[],categories]) as execute:
   self.assertEqual(masters.lookups(PRODUCT,"products")["categories"],categories)
   self.assertIn("dbo.ProductCategory",execute.call_args.args[0])
 def test_layout_sort_export(self):
  self.assertEqual(order_by("categories",'[{"column":"CategoryName","direction":"desc"}]'),"[CategoryName] DESC, ID ASC")
  layout=dict(columns=["CategoryName","Status"],sort=[],filters=["search"],values={},page_size=25)
  self.assertIn("categories",Settings(shared_masters={"categories":layout}).shared_masters)
  self.assertEqual(export_view("categories",SharedExport(columns=["CategoryName"],rows=[["Nuts"]])).status_code,200)
  with self.assertRaises(HTTPException):order_by("categories",'[{"column":"ProductName"}]')
 def test_product_errors_are_actionable(self):
  self.assertEqual(sql_error(Exception("[SQL Server]Choose an active Category from Category Master. (52964)")),"Choose an active Category from Category Master.")
if __name__=="__main__":unittest.main()
