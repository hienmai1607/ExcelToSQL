"""Temporary read-only fixture from the local test API."""
import sys
import tempfile
import urllib.request
import json
from pathlib import Path
body={"views":{"header":{"columns":["CustomerName","OpportunityNumber"],"sort":[]},"items":{"columns":["ProductCode","AnnualUnit"],"sort":[]}},"page":1,"page_size":2}
request=urllib.request.Request("http://127.0.0.1:8000/api/workbench/opportunity-excel/download",
 data=json.dumps(body).encode(),headers={"Content-Type":"application/json","X-User-Name":"Admin"})
with urllib.request.urlopen(request,timeout=30) as response:
 content=response.read()
target=Path(tempfile.mkdtemp(prefix="opportunity-excel-test-"))/"Opportunity_Local_Update.xlsm"
target.write_bytes(content)
print(target)
