"""Preferences and XLSX contracts; database-independent tests."""
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from zipfile import ZipFile
from xml.etree import ElementTree as ET
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core"))
from fastapi import HTTPException
from pydantic import ValidationError
from auth import AccessContext
import preferences_api as api

class Preferences(unittest.TestCase):
    def setUp(self):
        self.ctx=AccessContext(42,"Alice",frozenset({"Customer"}))
    def test_authenticated_id_not_client_identity(self):
        with patch.object(api,"get_raw_cursor") as factory:
            cur=factory.return_value.__enter__.return_value
            cur.fetchone.return_value=None
            result=api.save_preferences(api.PreferenceWrite(settings=api.Settings(dark=True),version=0),self.ctx)
            self.assertEqual(result["version"],1)
            self.assertEqual(cur.execute.call_args_list[1].args[1],42)
            self.assertEqual(cur.execute.call_args_list[2].args[1],42)
            self.assertEqual(cur.execute.call_args.args[0],"COMMIT TRANSACTION;")
        with self.assertRaises(ValidationError):
            api.PreferenceWrite(settings={},version=0,user_id=5)
    def test_conflict_never_overwrites(self):
        with patch.object(api,"get_raw_cursor") as factory:
            cur=factory.return_value.__enter__.return_value
            cur.fetchone.return_value=(3,)
            with self.assertRaises(HTTPException) as err:
                api.save_preferences(api.PreferenceWrite(settings=api.Settings(),version=2),self.ctx)
            self.assertEqual(err.exception.status_code,409)
            cur.connection.commit.assert_not_called()
            self.assertEqual(cur.execute.call_args.args[0],"IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;")
            self.assertEqual(cur.execute.call_count,3)
    def test_reads_isolated_by_actor(self):
        with patch.object(api,"get_raw_cursor") as factory:
            cur=factory.return_value.__enter__.return_value
            cur.fetchone.return_value=None
            self.assertEqual(api.read_preferences(self.ctx)["version"],0)
            self.assertEqual(cur.execute.call_args.args[1],42)
    def test_invalid_preferences(self):
        for values in ({"columns":[]},{"columns":["Password"]},{"page_size":501},{"filters":["secret"]},{"market_id":"-1"}):
            with self.assertRaises(ValidationError):api.Settings(**values)
    def test_xlsx_is_safe_and_only_requested_columns(self):
        body=api.ExportSnapshot(columns=["CustomerName","Status"],rows=[['=HYPERLINK("evil")',"Active"],["Café & <Co>",None]])
        blob=api.snapshot_xlsx(body)
        with ZipFile(io.BytesIO(blob)) as z:
            for name in z.namelist():ET.fromstring(z.read(name))
            root=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
            ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            self.assertEqual(root.findall(".//s:f",ns),[])
            text=[x.text for x in root.findall(".//s:t",ns)]
            self.assertEqual(text,["Customer","Status",'=HYPERLINK("evil")',"Active","Café & <Co>"])
            self.assertEqual(len(root.findall(".//s:row",ns)),3)
    def test_export_authorization_and_bounds(self):
        body=api.ExportSnapshot(columns=["CustomerName"],rows=[["Test"]])
        with self.assertRaises(HTTPException) as err:
            api.export_customers(body,AccessContext(9,"Other",frozenset({"Product"})))
        self.assertEqual(err.exception.status_code,403)
        self.assertEqual(api.export_customers(body,self.ctx).status_code,200)
        with self.assertRaises(ValidationError):
            api.ExportSnapshot(columns=["CustomerName"],rows=[["x"]]*501)
        with self.assertRaises(HTTPException):
            api.snapshot_xlsx(api.ExportSnapshot(columns=["CustomerName"],rows=[["x","y"]]))
if __name__=="__main__":unittest.main()
