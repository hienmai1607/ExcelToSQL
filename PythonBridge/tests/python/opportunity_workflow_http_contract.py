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
    return [{
        "Status": "OK",
        "Message": "Stage updated",
        "ID": params[0],
        "Stage": params[1],
        "NewRowVersion": b"12345678",
    }]


main.app.dependency_overrides[main.get_current_username] = lambda: "workflow.user"
main.app.dependency_overrides[main.get_is_admin] = lambda: False
main.app.dependency_overrides[main.get_user_scopes] = lambda: frozenset({"Opportunity"})
main.run_read_query = fake_read

payload = {
    "TargetStage": "In progress",
    "ExpectedRowVersion": "MTIzNDU2Nzg=",
    "Reason": "Submitted from PowerApps",
    "RequestID": "11111111-1111-1111-1111-111111111111",
}

async def post(path: str, body: dict) -> tuple[int, dict[str, str], dict]:
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
        "method": "POST", "scheme": "http", "path": path,
        "raw_path": path.encode(), "query_string": b"", "root_path": "",
        "headers": [(b"content-type", b"application/json"),
                    (b"content-length", str(len(request_body)).encode())],
        "client": ("127.0.0.1", 12345), "server": ("test", 80),
    }
    await main.app(scope, receive, send)
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    raw_headers = next(message["headers"] for message in sent if message["type"] == "http.response.start")
    headers = {key.decode().lower(): value.decode() for key, value in raw_headers}
    content = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return status, headers, json.loads(content)


status, headers, body = asyncio.run(post("/api/opportunity/42/stage-transition", payload))
assert status == 200, body
assert headers["x-bridge-contract"] == "2"
assert body["result"]["NewRowVersion"] == "MTIzNDU2Nzg="
assert calls[-1][0] == "dbo.usp_Opportunity_HeaderStage_Transition"
assert calls[-1][1] == [
    42,
    "In progress",
    b"12345678",
    "Submitted from PowerApps",
    "11111111-1111-1111-1111-111111111111",
    "workflow.user",
]

status, _, body = asyncio.run(post("/api/opportunity/item/84/stage-transition", {**payload, "TargetStage": "Proposed"}))
assert status == 200, body
assert calls[-1][0] == "dbo.usp_Opportunity_ItemStage_Transition"
assert calls[-1][1][0:2] == [84, "Proposed"]

main.app.dependency_overrides.clear()
print("PASS: Opportunity workflow HTTP contract")
