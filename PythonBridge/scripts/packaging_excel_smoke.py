"""Download a disposable combined workbook from the local API. No writes."""
import json
import tempfile
import urllib.request
from pathlib import Path
body={"views":{"header":{"columns":["RequestNumber"],"sort":[]},"items":{"columns":["ProductCode","PMCost","PMCostCurrencyCode"],"sort":[]}},"page":1,"page_size":2}
request=urllib.request.Request("http://127.0.0.1:8000/api/workbench/packaging-excel/download",
 data=json.dumps(body).encode(),headers={"Content-Type":"application/json","X-User-Name":"Admin"})
with urllib.request.urlopen(request,timeout=30) as response:content=response.read()
target=Path(tempfile.mkdtemp(prefix="packaging-excel-test-"))/"Packaging_Request_Local_Update.xlsm"
target.write_bytes(content)
print(target)
