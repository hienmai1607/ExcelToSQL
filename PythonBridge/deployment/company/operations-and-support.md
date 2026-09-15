# Operations and Support

## Ownership matrix

| Area | Primary owner | Responsibilities |
| --- | --- | --- |
| SQL Server | DBA | Availability, backup, restore, performance, migrations, runtime permissions |
| API host | Application/Infrastructure | Windows service, Python runtime, certificates, proxy, logs, monitoring |
| Identity/security | IAM/Security | Authentication, canonical identity, secret handling, access review |
| Power Platform | Platform team | Environments, connectors, gateways, solutions, DLP policies |
| Workbooks | Application owner | VBA signing, version distribution, contract compatibility |
| Business data | Data owners | Master approval, reconciliation, retention, workflow policy |

Name at least two people for every production-critical role.

## Daily monitoring

- API process and `/health/live` availability.
- `/health/ready` database connectivity.
- HTTP 5xx count, latency, and repeated 401/403 patterns.
- SQL blocking, timeouts, failed jobs, storage, and backup status.
- Reverse proxy certificate validity.
- Gateway availability when Power Platform uses on-premises connectivity.

The health endpoints do not require application authentication and return no business data. Restrict them to company monitoring networks through the proxy/firewall.

## Incident evidence

Capture:

- timestamp and timezone;
- environment and release checksum;
- workbook and sheet;
- operation and row number;
- complete user-facing error;
- `X-Request-ID`;
- API traceback with confidential values removed;
- SQL error number/procedure;
- affected record key, never passwords or proxy secrets.

Use the request ID to correlate Excel, proxy, API, and SQL evidence.

## Backup and recovery

- Follow company SQL full, differential, and transaction-log backup policy.
- Test restore into a non-production server on a defined schedule.
- Protect and separately retain gateway recovery keys.
- Keep the current and previous compatible release artifacts, checksums, signed workbooks, configuration inventory, and migration records.
- Do not back up secrets inside the release repository.

## Access reviews

Review active `dbo.Users` and `dbo.UserAccess` on a company-defined schedule and when staff change roles. Immediately deactivate departed users. Keep at least two active, tested Admin users.

Database runtime permissions, gateway admins, connector owners, service accounts, certificate owners, and workbook signing access must also be reviewed.

## Release process

Every release must:

1. have a unique version and change record;
2. include an incremental, forward-only database migration for existing environments;
3. preserve or deliberately increment `X-Bridge-Contract`;
4. pass Python, SQL, workbook, authorization, concurrency, and performance tests;
5. generate new checksums;
6. promote the same artifact Development → UAT → Production;
7. include rollback and data-impact notes.

Do not edit a migration already applied to a shared environment. Add a new migration instead.

## Known transition limitations

- The included database runner is for a new empty database only.
- Current Power Apps Entra token validation is a planned production integration, not implemented by this package.
- Current identity matching uses a short username. Multi-domain safety requires an explicit company decision and possibly a schema/API contract change.
- The package starts Uvicorn in the foreground; company IT must register it using an approved Windows service mechanism.
