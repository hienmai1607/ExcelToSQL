# Deployment Runbook

This procedure is for a new company Development or UAT environment. Production follows the same technical steps only after UAT approval.

## 1. Create the release artifact

On the controlled build workstation:

```powershell
powershell -ExecutionPolicy Bypass -File .\deployment\company\New-ReleaseChecksums.ps1
```

Copy the repository release and generated `release-files.sha256` through the company's approved transfer mechanism. Exclude `.env`, logs, database backups, temporary Excel lock files, personal test data, and credentials.

Verify checksums after transfer before installation.

## 2. Provision infrastructure

Company IT/DBA creates:

- a supported 64-bit Python installation;
- Microsoft ODBC Driver 18 for SQL Server;
- Microsoft `sqlcmd`;
- a dedicated empty SQL database;
- an API Windows service account;
- a separate database deployment identity;
- an internal DNS name and trusted TLS certificate;
- IIS or another approved authenticating reverse proxy.

Run the local prerequisite check:

```powershell
.\deployment\company\Test-DeploymentPrerequisites.ps1 `
    -PythonExe 'C:\Program Files\Python314\python.exe'
```

## 3. Install Python dependencies

Create a virtual environment in the release directory:

```powershell
& 'C:\Program Files\Python314\python.exe' -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --requirement requirements.lock.txt
```

The captured development runtime was Python 3.14.7 with the exact tested environment in `requirements.lock.txt`. `requirements.txt` records only the direct application dependencies. If company policy requires a different Python version, rebuild the lock and execute all tests before approving it.

## 4. Install a fresh database

The database runner:

- uses Windows Integrated authentication;
- refuses a database containing any `dbo` user table;
- applies the explicit manifest sequence;
- strips only the historical `USE [test]` directives from temporary execution copies;
- bootstraps one active Admin user;
- verifies required tables, types, procedures, sequence, and history tables.

First preview the target:

```powershell
.\deployment\company\Invoke-FreshDatabaseDeployment.ps1 `
    -ServerInstance 'COMPANY-SQL' `
    -Database 'ExcelBridge_Dev' `
    -BootstrapUserName 'approved.shortname' `
    -WhatIf
```

Then run it using the authorized deployment identity:

```powershell
.\deployment\company\Invoke-FreshDatabaseDeployment.ps1 `
    -ServerInstance 'COMPANY-SQL' `
    -Database 'ExcelBridge_Dev' `
    -BootstrapUserName 'approved.shortname' `
    -Confirm
```

Do not use this runner against an existing application database. A DBA must compare its schema with the baseline and create a separately reviewed upgrade migration.

After installation, the DBA grants the API service identity only the approved runtime permissions described in `architecture-and-security.md`.

## 5. Configure the API service

Use `.env.example` as a field reference only. Set real values in the Windows service manager or approved secret store.

Minimum production values:

```text
APP_ENV=production
AUTH_MODE=trusted_proxy
AUTH_PROXY_SECRET=<protected random secret>
DB_AUTH_MODE=windows
DB_SERVER=COMPANY-SQL
DB_NAME=ExcelBridge_Dev
DB_ODBC_DRIVER=ODBC Driver 18 for SQL Server
DB_ENCRYPT=yes
DB_TRUST_SERVER_CERTIFICATE=no
```

Run the API under the dedicated service account. The service working directory must be the repository's `core` folder. The package startup wrapper binds only to loopback:

```powershell
.\deployment\company\Start-Bridge.ps1 `
    -PythonExe '<release>\.venv\Scripts\python.exe' `
    -Workers 4
```

Register that command with the company's approved Windows service wrapper. Configure automatic restart, delayed start, restricted filesystem permissions, and log collection.

## 6. Configure the reverse proxy

The reverse proxy owner must:

1. expose only HTTPS;
2. enable company authentication and disable anonymous access;
3. proxy to `http://127.0.0.1:8000`;
4. remove caller-provided identity and proxy-secret headers;
5. inject the authenticated identity as `X-Authenticated-User`;
6. inject the protected internal secret as `X-Proxy-Secret`;
7. preserve `X-Request-ID` and response `X-Bridge-Contract` headers;
8. restrict direct access to port 8000.

Do not continue if users can reach Uvicorn directly.

## 7. Verify the service

From an authorized company client:

```powershell
.\deployment\company\Invoke-ReadOnlySmokeTest.ps1 `
    -ApiBaseUrl 'https://excelbridge-dev.example.internal' `
    -TestAdminReads
```

The bootstrap identity used for this test must match the identity delivered by the reverse proxy.

## 8. Configure and distribute workbooks

Set the client environment variable centrally:

```text
PYTHON_BRIDGE_URL=https://excelbridge-dev.example.internal
```

Sign `Admin_Master.xlsm`, `Product_Template.xlsm`, and `Sales_Template.xlsm`. Publish controlled read-only templates and give users working copies. Do not edit VBA after signing.

## 9. Load approved data

Use a separately approved data-import plan. Load parent data before children:

1. Users
2. User Access
3. Market and Currency
4. Product and Customer
5. Opportunity headers
6. Opportunity items

Reconcile source and target counts, rejected rows, unique keys, foreign keys, stage values, and sampled business records. Never load personal test Opportunities into the company database without written approval.
