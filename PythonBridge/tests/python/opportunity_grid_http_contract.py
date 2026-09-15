from pathlib import Path
import asyncio
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "core"))

import main  # noqa: E402


calls: list[tuple[str, list]] = []


def fake_read(proc_name: str, params: list) -> list[dict]:
    calls.append((proc_name, params))
    return [{"OpportunityID": 10, "OpportunityNumber": "OPP-10", "TotalMatchingRows": 9510}]


async def get(path: str, query: str) -> tuple[int, dict]:
    sent: list[dict] = []
    delivered = False

    async def receive() -> dict:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "GET", "scheme": "http", "path": path,
        "raw_path": path.encode(), "query_string": query.encode(), "root_path": "",
        "headers": [], "client": ("127.0.0.1", 12345), "server": ("test", 80),
    }
    await main.app(scope, receive, send)
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    content = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return status, json.loads(content)


main.app.dependency_overrides[main.get_current_username] = lambda: "opportunity.user"
main.app.dependency_overrides[main.get_is_admin] = lambda: False
main.app.dependency_overrides[main.get_user_scopes] = lambda: frozenset({"Opportunity"})
main.run_read_query = fake_read

status, body = asyncio.run(get(
    "/api/opportunity/grid",
    "page=2&page_size=200&opportunity_number=OPP-2&customer_name=ACME&stage=Draft&bid_open_from=2026-01-01&bid_open_to=2026-12-31",
))
assert status == 200, body
assert body["page"] == 2 and body["page_size"] == 200 and body["total"] == 9510
assert calls[-1] == (
    "dbo.usp_Opportunity_Grid_Read",
    ["opportunity.user", 0, 2, 200, "OPP-2", "ACME", "Draft", "2026-01-01", "2026-12-31"],
)

main.app.dependency_overrides.clear()
print("PASS: Opportunity grid HTTP contract")
