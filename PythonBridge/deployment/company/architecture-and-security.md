# Architecture and Security

## Target topology

```text
Excel users
    |  HTTPS + Windows Authentication
    v
IIS / approved reverse proxy
    |  authenticated identity + internal proxy secret
    v
FastAPI bridge on 127.0.0.1:8000
    |  least-privileged service identity
    v
Dedicated SQL Server database

Power Apps / Power Automate
    |  preferred: Entra-authenticated custom connector
    +-----------------------------------------------> FastAPI bridge
    |  interim: controlled SQL connector + gateway
    +-----------------------------------------------> stored procedures only
```

The FastAPI port must not be reachable directly from user networks. Only the reverse proxy may reach it. Excel must use the HTTPS proxy URL through `PYTHON_BRIDGE_URL`.

## Trust boundaries

- Excel is an untrusted client. Hidden worksheet IDs, RowVersions, usernames, and commands must still be validated server-side.
- The reverse proxy authenticates the caller. It must remove inbound `X-Authenticated-User` and `X-Proxy-Secret` headers before injecting trusted replacements.
- `AUTH_PROXY_SECRET` is shared only by the reverse proxy and API service. Store it in an approved secret store or protected service configuration.
- SQL Server is authoritative for constraints, RowVersion concurrency, workflow transitions, and audit history.
- Power Apps must not write transaction stages directly to tables.

## Identity decision

Current `trusted_proxy` behavior accepts `X-Authenticated-User`, removes a `DOMAIN\` prefix, and matches the remaining value to `dbo.Users.UserName`.

Before Production, choose one canonical identifier:

- Entra Object ID: strongest long-term identifier and unaffected by renames;
- full UPN: practical and human-readable, but can change;
- short username: compatible with the current release, but only safe when globally unique.

If Object ID or full UPN is selected, update the Users model, proxy contract, and API authentication together and increment the bridge contract version.

## SQL permissions

Recommended runtime principal permissions:

- `CONNECT` to the application database;
- `EXECUTE` on approved `dbo.usp_*` procedures;
- no membership in `db_owner`, `db_ddladmin`, or `sysadmin`;
- no direct `INSERT`, `UPDATE`, or `DELETE` permissions on application tables.

Use a separate deployment identity with DDL permission. Do not run the API under the deployment identity.

Windows Integrated authentication is preferred when the API server and SQL Server share a trusted domain and the company can manage a service account or group-managed service account. If SQL authentication is mandated, store `DB_USER` and `DB_PASSWORD` outside the repository.

Production defaults require encrypted SQL transport and certificate validation. `DB_TRUST_SERVER_CERTIFICATE=yes` is a temporary diagnostic setting, not the production target.

## Application authorization

| Scope | Allowed maintenance |
| --- | --- |
| Admin | Market, Currency, Users, User Access, Product, Customer, Opportunity |
| Product | Product |
| Customer | Customer |
| Opportunity | Opportunity; read-only Customer/Product lookups |

An identity must be active in `dbo.Users`. User Access supplements company authentication; it does not replace it.

## Power Platform

Preferred production integration is an Entra-secured API custom connector so the API receives and validates the real caller identity. The current shared-header proxy mode is appropriate for the controlled Excel/IIS path, but Entra token validation requires a separate approved implementation before Power Apps production use.

If an on-premises SQL connector is used temporarily:

- route it through the company on-premises data gateway;
- give the connection identity only stored-procedure execution rights;
- use solutions and connection references for environment promotion;
- do not trust a username supplied by the canvas application as proof of identity;
- document which actions run as a shared connection identity.

## Workbook controls

- Digitally sign all VBA projects with the company code-signing certificate.
- Publish read-only versioned templates from a controlled location.
- Configure Trusted Publisher/Trusted Location policy through IT rather than instructing users to weaken macro security.
- Set `PYTHON_BRIDGE_URL` centrally.
- Keep the workbook/API `X-Bridge-Contract` versions aligned.
