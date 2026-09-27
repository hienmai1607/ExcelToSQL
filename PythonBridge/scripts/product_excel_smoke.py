"""Generate a temporary fixture for the desktop Excel smoke test; no database writes."""
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"core"))
from product_excel_api import View,build
body=View(layout=dict(columns=["ProductName","Category"],filters=[],values={},sort=[],page_size=200))
row=dict(ID=4,RowVersion="AAAAAAAAAAE=",ProductName="=literal",ProductCode="PRD-0000000004",Category="Nuts",WeightGrams="100")
target=Path(tempfile.mkdtemp(prefix="product-excel-test-"))/"Product_Local_Update.xlsm"
target.write_bytes(build(body,dict(rows=[row],total=1),"http://127.0.0.1:8000"))
print(target)
