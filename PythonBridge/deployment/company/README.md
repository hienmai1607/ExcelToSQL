# Company Deployment and Handover Package

Release contract: `2`  
Prepared: 13 September 2026

This package moves the Excel-to-SQL bridge from a personal workstation into a controlled company environment. It supports a new, dedicated SQL Server database and a centrally hosted FastAPI service. It does not automatically upgrade an unknown existing database.

## Package contents

| Item | Purpose |
| --- | --- |
| `requirements.txt` | Direct Python dependencies |
| `requirements.lock.txt` | Exact tested Python environment, including transitive dependencies |
| `.env.example` | Production configuration reference; never store real secrets in it |
| `sql/deploy/000_empty_database_baseline.sql` | Dependency-ordered schema for a fresh database |
| `migration-manifest.json` | Approved fresh-install SQL sequence |
| `Invoke-FreshDatabaseDeployment.ps1` | Guarded Windows-authenticated fresh database installer |
| `Test-DeploymentPrerequisites.ps1` | Checks Python, sqlcmd, ODBC, workbooks, and release files |
| `Start-Bridge.ps1` | Starts the API on loopback with production safeguards |
| `Invoke-ReadOnlySmokeTest.ps1` | Tests HTTPS, API/DB readiness, contract version, and optional Admin reads |
| `New-ReleaseChecksums.ps1` | Produces SHA-256 hashes for release verification |
| `deployment-runbook.md` | End-to-end installation procedure |
| `architecture-and-security.md` | Target topology, trust boundaries, identity, and permissions |
| `uat-and-cutover.md` | UAT evidence, go/no-go, rollback, and production cutover |
| `operations-and-support.md` | Monitoring, backup, incidents, upgrades, and ownership |

## Mandatory decisions before production

Company owners must approve and record:

1. API host, DNS name, TLS certificate, and reverse proxy owner.
2. Dedicated Development, UAT, and Production database names.
3. Canonical user identity format: short account name, full UPN, or Entra Object ID.
4. API service account and SQL authentication method.
5. Power Platform connection pattern.
6. Gateway/API high-availability requirements.
7. Backup, retention, recovery-time, and recovery-point targets.
8. Workbook VBA-signing certificate and distribution owner.

The current bridge uses the short username after removing `DOMAIN\`. Do not approve production until the company confirms that short usernames are unique across all relevant domains.

## Recommended execution order

1. Read `architecture-and-security.md` and resolve the mandatory decisions.
2. Create company Development infrastructure.
3. Follow `deployment-runbook.md` in Development.
4. Run automated checks and execute the documented workbook tests.
5. Repeat in UAT using the same release artifact and scripts.
6. Obtain business, security, DBA, API, and Power Platform approvals.
7. Follow `uat-and-cutover.md` for Production.

Do not copy personal credentials, `.env` files, SQL backups, test Opportunities, or production data between personal and company environments.
