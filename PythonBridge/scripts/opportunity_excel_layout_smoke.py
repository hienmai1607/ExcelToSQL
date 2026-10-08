"""Disposable workbook + loopback read-only API fixture for the real Excel/VBA smoke check."""
import json
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "core"))
import opportunity_excel_api as excel

def main():
    parent = dict(OpportunityID=1,OpportunityNumber="OPP-EXCEL-FIXTURE",CustomerID=2,CustomerName="Customer",
        OpportunityDesc="Excel fixture",BidOpen="2026-09-01",BidClose="2026-10-01",
        CustomerCurrencyCode="USD",ExchangeRateVNDPerUSD="25000",ExchangeRateCustomerCurrencyPerUSD="1",
        HeaderStage="Draft",HeaderRowVersion="AAAAAAAAAAE=",ItemID=4,ProductID=5,ProductCode="P1",
        ProductName="Mix fixture",ItemDescription="Mix fixture",AnnualUnit=10,ItemStage="Draft",
        ItemRowVersion="AAAAAAAAAAI=",HasOpenPackagingRequest=True,WeightGrams=750,
        ContainerRequest="Dry",ConfigurationRequest="Both",PortOfEntryName="Seattle",
        ShipmentCostInfo=json.dumps({"Incoterm":"FOB","FreightUSDPerContainer":"100.00","DutyPct":"7.00","ContainerSizeFT":"20FT"}))
    child = {**parent,"ItemID":6,"ParentItemID":4,"ProductCode":"P2","ProductName":"Child fixture","MixChildNumber":1,"MixUnitQuantity":2,"WeightGrams":150}
    data = {"rows":[excel.workbook_row(parent),excel.workbook_row(child)],"total":1}
    class Fixture(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path != "/api/workbench/opportunity-excel/page":
                self.send_error(405);return
            excel.View(**body)
            content = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("X-Bridge-Contract","2")
            self.send_header("Content-Length",str(len(content)))
            self.end_headers();self.wfile.write(content)
        def log_message(self,*args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1",0),Fixture)
    thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    target = Path(tempfile.mkdtemp(prefix="opportunity-layout-smoke-")) / "Opportunity_Local_Update.xlsm"
    from shipment_columns import SHIPMENT_GROUPS
    selected = ["ProductCode","WeightGrams","AnnualUnit","ContainerRequest","ConfigurationRequest",*SHIPMENT_GROUPS[0][1],
                *[key for _,fields in SHIPMENT_GROUPS[1:] for key in fields],"UsedVolumeML"]
    view = excel.View(views={"header":{"columns":sorted(excel.HEADER_COLUMNS)},"items":{"columns":selected}})
    target.write_bytes(excel.build(view,data,"http://127.0.0.1:"+str(server.server_port)))
    print("Disposable workbook:",target,flush=True)
    try:
        result = subprocess.run(["powershell","-NoProfile","-File",str(ROOT/"scripts/test_opportunity_local_template.ps1"),"-WorkbookPath",str(target)],
                                creationflags=subprocess.CREATE_NO_WINDOW,timeout=120,capture_output=True,text=True)
        print(result.stdout+result.stderr,flush=True)
        return result.returncode
    finally:
        server.shutdown();server.server_close()
if __name__ == "__main__":
    raise SystemExit(main())
