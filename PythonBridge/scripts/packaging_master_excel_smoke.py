"""Download disposable Packaging master fixtures. No database writes."""
import json,sys,tempfile,urllib.request
from pathlib import Path
entity=sys.argv[1] if len(sys.argv)>1 else "materials"
if entity not in ("materials","prices"):raise SystemExit("Expected materials or prices")
body={"layout":{"columns":["Status"],"filters":[],"values":{},"sort":[],"page_size":2},"page":1}
request=urllib.request.Request("http://127.0.0.1:8000/api/workbench/master-excel/"+entity+"/download",
 data=json.dumps(body).encode(),headers={"Content-Type":"application/json","X-User-Name":"Admin"})
with urllib.request.urlopen(request,timeout=30) as response:content=response.read()
target=Path(tempfile.mkdtemp(prefix="packaging-master-test-"))/(entity+".xlsm")
target.write_bytes(content)
print(target)
