from pathlib import Path


source = (Path(__file__).parents[2] / "modHttpJson.bas").read_text(encoding="utf-8-sig")
header_line = 'http.SetRequestHeader "X-User-Name", windowsUser'

assert header_line in source, "Excel requests do not provide the Windows username."
prefix = source[: source.index(header_line)]
last_if = prefix.rsplit("If ", 1)[-1] if "If " in prefix else ""
assert "PYTHON_BRIDGE_AUTH_MODE" not in last_if, (
    "Excel incorrectly depends on a client-side authentication-mode variable; "
    "the API server owns authentication mode."
)

print("PASS: Excel supplies its Windows username without duplicating server configuration")
