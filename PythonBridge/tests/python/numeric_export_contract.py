"""Excel export stores numbers without UI currency labels."""
import sys,io,unittest,zipfile
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from preferences_api import snapshot_xlsx

class NumericExport(unittest.TestCase):
 def test_numeric_and_safe_text_cells(self):
  body=SimpleNamespace(columns=["UnitPrice","ExchangeRateToUSD","VendorName"],rows=[["25000.1234","25000","=not a formula"],[None,"1","USD vendor"]])
  result=snapshot_xlsx(body,dict(UnitPrice="Price",ExchangeRateToUSD="Rate",VendorName="Vendor"))
  with zipfile.ZipFile(io.BytesIO(result)) as z:root=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
  ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
  cells={c.attrib["r"]:c for c in root.findall(".//s:c",ns)}
  self.assertEqual(cells["A2"].attrib["t"],"n")
  self.assertEqual(cells["A2"].find("s:v",ns).text,"25000.1234")
  self.assertEqual(cells["B2"].find("s:v",ns).text,"25000")
  self.assertEqual(cells["C2"].attrib["t"],"inlineStr")
  self.assertNotIn("A3",cells)
  self.assertEqual(root.findall(".//s:f",ns),[])
if __name__=="__main__":unittest.main()
