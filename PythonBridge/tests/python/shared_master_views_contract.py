import sys,unittest,io
from pathlib import Path
from zipfile import ZipFile
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from pydantic import ValidationError
from auth import AccessContext
from shared_master_views import order_by,listing,SharedExport,export_view
from preferences_api import Settings
from decimal import Decimal

class SharedMasterViews(unittest.TestCase):
 def test_sort_is_allowlisted_and_stable(self):
  self.assertEqual(order_by("ports",'[{"column":"PortName","direction":"desc"}]'),"[PortName] DESC, ID ASC")
  for raw in ('[{"column":"ID; DROP TABLE x","direction":"asc"}]','[{"column":"PortName","direction":"bad"}]','[{"column":"PortName"},{"column":"PortName"}]'):
   with self.assertRaises(HTTPException):order_by("ports",raw)
 def test_filtered_count_and_page_use_same_parameters(self):
  execute=Mock(return_value=[[{"ID":1,"LossPct":Decimal("5.00")}],[{"TotalRows":26}]])
  result=listing("loss-processes",Mock(username="Sales"),execute,"AUTH ?;","dbo.LossProcessMaster p","p.ID,p.LossPct",["p.ProcessType"],"Sort","Active",2,25,'[{"column":"LossPct","direction":"desc"}]')
  self.assertEqual(result["total"],26);self.assertEqual(result["rows"][0]["LossPct"],"5.00")
  sql,params=execute.call_args.args
  self.assertIn("[LossPct] DESC, ID ASC",sql)
  self.assertEqual(params,["Sales","Sort","Sort%","Active","Active",25,25,"Sort","Sort%","Active","Active"])
 def test_layout_roundtrips_and_rejects_foreign_keys(self):
  layout={"columns":["PortName","Status"],"sort":[{"column":"PortName","direction":"asc"}],"filters":["search","status"],"values":{"search":"Sea","status":"Active"},"column_widths":{"PortName":240},"page_size":25}
  settings=Settings(shared_masters={"ports":layout})
  self.assertEqual(Settings.model_validate_json(settings.model_dump_json()).shared_masters["ports"].values,layout["values"])
  for changed in ({"columns":["PortCode"]},{"sort":[{"column":"CustomerID"}]},{"values":{"status":"deleted"}},{"column_widths":{"PortCode":200}}):
   with self.assertRaises(ValidationError):Settings(shared_masters={"ports":{**layout,**changed}})
 def test_excel_export_is_safe_and_follows_selected_columns(self):
  body=SharedExport(columns=["PortName"],rows=[["=1+1"]])
  response=export_view("ports",body)
  with ZipFile(io.BytesIO(response.body)) as workbook:
   sheet=workbook.read("xl/worksheets/sheet1.xml").decode()
  self.assertIn("Port name",sheet);self.assertIn("=1+1",sheet);self.assertNotIn("<f>",sheet)
  with self.assertRaises(HTTPException):export_view("ports",SharedExport(columns=["PortCode"],rows=[]))
if __name__=="__main__":unittest.main()
