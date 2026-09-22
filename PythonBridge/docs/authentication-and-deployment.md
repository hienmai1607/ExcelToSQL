# Bridge authentication and deployment

The bridge has two supported deployment shapes.

## Local Windows mode

This is the default for a workstation-local bridge bound to `127.0.0.1`.
The server ignores caller-supplied username headers and uses the Windows account
running the Python process. That account must exist as an active `dbo.Users`
row with the required `dbo.UserAccess` scope.

```powershell
$env:AUTH_MODE = 'local_windows'
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

## Central trusted-proxy mode

For a shared deployment, place the bridge behind IIS or another authenticating
reverse proxy and expose only HTTPS. The proxy must:

1. authenticate the caller with Windows Authentication or validated JWT;
2. remove inbound `X-Authenticated-User` and `X-Proxy-Secret` values;
3. inject the authenticated identity into `X-Authenticated-User`;
4. inject an internal high-entropy `X-Proxy-Secret` value;
5. proxy only to a bridge listener that is not directly reachable by clients.

Configure the bridge process:

```powershell
$env:AUTH_MODE = 'trusted_proxy'
$env:AUTH_PROXY_SECRET = '<secret shared only by proxy and bridge>'
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 4
```

Set `PYTHON_BRIDGE_URL` for Excel clients to the HTTPS proxy URL. WinHTTP sends
the logged-in Windows credentials for integrated authentication.

`development_header` exists only for controlled testing. Excel supplies the
logged-in workstation username in `X-User-Name`; the API accepts it only in
this mode. The client does not need `PYTHON_BRIDGE_AUTH_MODE` because
authentication mode is server configuration. Never enable this mode on a
public or otherwise untrusted network.

## Capacity and release controls

- Tune `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT`, and
  `DB_QUERY_TIMEOUT` only after representative load testing.
- The current workbook/server contract is carried in the
  `X-Bridge-Contract` response header. Mismatched workbooks fail with a clear
  upgrade/restart message.
- Digitally sign all three VBA projects with the organization's code-signing
  certificate before distribution. Signing needs the private certificate and
  therefore remains a release-owner step.
- Distribute read-only versioned workbook templates from one controlled
  location; users should save working copies, not modify the published master.
