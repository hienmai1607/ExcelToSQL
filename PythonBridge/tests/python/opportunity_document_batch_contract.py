from pathlib import Path
import asyncio
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "core"))

import main  # noqa: E402


calls: list[tuple[list[tuple], list[tuple]]] = []


def fake_batch(proc_name: str, header_tvp_rows: list[tuple], detail_tvp_rows: list[tuple], scalar_params: list):
    calls.append((header_tvp_rows, detail_tvp_rows))
    row_num = header_tvp_rows[0][0]
    key = header_tvp_rows[0][3]
    status = "ERROR" if key == "BAD" else "OK"
    header_result = [{"RowNum": row_num, "Status": status, "Message": "Invalid line" if status == "ERROR" else "Created"}]
    item_result = [{"RowNum": detail_tvp_rows[0][0], "Status": status, "Message": header_result[0]["Message"]}]
    return header_result, item_result


async def post(body: dict) -> tuple[int, dict]:
    sent: list[dict] = []
    request_body = json.dumps(body).encode()
    delivered = False

    async def receive() -> dict:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": request_body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": "http", "path": "/api/opportunity/batch",
        "raw_path": b"/api/opportunity/batch", "query_string": b"", "root_path": "",
        "headers": [(b"content-type", b"application/json"),
                    (b"content-length", str(len(request_body)).encode())],
        "client": ("127.0.0.1", 12345), "server": ("test", 80),
    }
    await main.app(scope, receive, send)
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    content = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return status, json.loads(content)


main.app.dependency_overrides[main.get_current_username] = lambda: "opportunity.user"
main.app.dependency_overrides[main.get_is_admin] = lambda: False
main.app.dependency_overrides[main.get_user_scopes] = lambda: frozenset({"Opportunity"})
main.run_header_detail_batch = fake_batch

headers = [
    {"RowNum": 2, "Command": "C", "OpportunityNumber": "GOOD", "CustomerID": 1,
     "OpportunityDesc": "Good", "BidOpen": "2026-01-01", "BidClose": "2026-01-31"},
    {"RowNum": 4, "Command": "C", "OpportunityNumber": "BAD", "CustomerID": 1,
     "OpportunityDesc": "Bad", "BidOpen": "2026-01-01", "BidClose": "2026-01-31"},
]
items = [
    {"RowNum": 3, "Command": "C", "OpportunityNumber": "GOOD", "ProductID": 1,
     "ItemDescription": "Good line", "AnnualUnit": 1},
    {"RowNum": 5, "Command": "C", "OpportunityNumber": "BAD", "ProductID": 1,
     "ItemDescription": "Bad line", "AnnualUnit": 1},
]
status, body = asyncio.run(post({"header_rows": headers, "item_rows": items}))
assert status == 200, body
assert len(calls) == 2, "Each document must have its own transaction call."
assert all(len(header_rows) == 1 and len(item_rows) == 1 for header_rows, item_rows in calls)
assert [row["Status"] for row in body["header_results"]] == ["OK", "ERROR"]

main.app.dependency_overrides.clear()
print("PASS: Opportunity document-level batch contract")
