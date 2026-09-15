import os
from pathlib import Path
import sys

from fastapi import HTTPException
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "core"))

# pyodbc 5 on this deployment does not expose a writable Cursor.timeout.
# Timeouts belong on the connection and must not make every API request fail.
db_source = (ROOT / "core" / "db.py").read_text(encoding="utf-8")
assert "cursor.timeout =" not in db_source

from auth import _presented_username  # noqa: E402
from main import BRIDGE_CONTRACT_VERSION, _paged_response  # noqa: E402
from schemas import ProductBatchRequest  # noqa: E402


os.environ["AUTH_MODE"] = "development_header"
assert _presented_username("alice", None, None) == "alice"

os.environ["AUTH_MODE"] = "trusted_proxy"
os.environ["AUTH_PROXY_SECRET"] = "expected-secret"
try:
    _presented_username("Admin", "DOMAIN\\alice", "wrong-secret")
    raise AssertionError("trusted_proxy accepted an invalid proxy secret")
except HTTPException as exc:
    assert exc.status_code == 401
assert _presented_username(None, "DOMAIN\\alice", "expected-secret") == "alice"

row = {
    "RowNum": 1,
    "Command": "C",
    "ProductCode": "TEST",
    "ProductName": "Test",
    "WeightValue": 1,
    "WeightUnit": "g",
}
try:
    ProductBatchRequest(rows=[row] * 501)
    raise AssertionError("Product batch accepted more than 500 rows")
except ValidationError:
    pass

response = _paged_response(
    [{"ID": 1, "RowVersion": b"12345678", "TotalMatchingRows": 430}],
    page=2,
    page_size=200,
)
assert response["page"] == 2
assert response["page_size"] == 200
assert response["total"] == 430
assert response["rows"][0]["RowVersion"] == "MTIzNDU2Nzg="
assert BRIDGE_CONTRACT_VERSION == "2"

print("PASS: User Master Python runtime contract")
