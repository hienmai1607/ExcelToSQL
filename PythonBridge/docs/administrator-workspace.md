# Administrator workspace

Only users with the built-in Admin access grant can see or use Administrator.
It contains User role, User master, Market Master and Currency Master.
Market Master maintains the existing Market records used by Customers and Ports,
not a separate country table.

## Set up access

1. Open User role and create an active role.
2. Choose No access, Display or Edit for each workspace page. Review and save.
3. Open User master, create or select a user, and assign one or more roles.
   Login name must match the identity supplied by the configured authentication
   mode. Database user IDs are generated automatically.
4. Review and save. Refresh or sign in again to refresh the navigation.

Sidebar pages with No access are omitted entirely, rather than shown disabled.
Group headings are also omitted when none of their pages are accessible.
Display and Edit pages remain visible; Admin retains all sidebar pages.

Permissions combine using the highest grant: Edit wins over Display, which
wins over No access. A No access setting does not deny access granted by another
role. Inactive roles contribute no permissions; inactive users cannot sign in.
Existing direct access scopes are preserved and also contribute permissions.
To restrict a previously unrestricted user, remove the relevant direct scope
as well as changing their roles. Admin is a built-in direct access grant, not a
permission that a custom role can grant.

Display users can view the permitted page but cannot save through its browser
or Excel endpoints. Where supported, Excel local template supplies a protected,
macro-free read-only .xlsx view instead of an editable workbook. Edit permission
does not bypass existing PIC ownership, workflow rules, or restrictions on
general Unit Conversions.

## Maintenance safeguards

Role and user changes are atomic and use row-version concurrency checks.
Saving a role immediately updates the access derived from that role for its
assigned users. The next API request checks current database permissions,
although an already open browser needs a refresh to update its controls.

Users and roles are deactivated rather than deleted. The current administrator
cannot remove their own Admin grant, deactivate or rename their own account.
The last active administrator is protected. Market and Currency maintenance
uses the existing code/name records and their concurrency protection.

The server enforces page permissions for API calls, including Excel saves;
hiding a sidebar button is not the authorization boundary.

## Database installation

Run from the PythonBridge root with the intended database explicitly selected:

```powershell
python scripts/apply_administrator_workspace.py --database test --apply
```

Migration 104 adds role, page-permission, user-role and derived-scope tracking
tables. It does not replace existing Users or UserAccess records. The runner
checks the database identity and preserves the existing user/access snapshot
inside a transaction. Re-running it is safe.

## Authentication for shared deployments

Authentication configuration is unchanged. Local Windows mode identifies the
Windows account running the bridge, not each remote browser user. A shared
deployment needs the existing trusted-proxy mode with an authenticating reverse
proxy to distinguish users and apply their individual roles. Do not enable
development-header authentication on an untrusted network.

See [Authentication and deployment](authentication-and-deployment.md) for the
identity and proxy setup.
