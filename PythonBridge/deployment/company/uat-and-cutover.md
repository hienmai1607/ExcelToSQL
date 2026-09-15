# UAT and Production Cutover

## UAT entry criteria

- Development deployment and automated checks pass.
- Canonical identity format is approved.
- API, SQL, reverse proxy, certificate, gateway, and workbook owners are named.
- Test users exist for Admin, Product, Customer, Opportunity, inactive, and no-scope cases.
- No company credential or production data is stored in the source repository.

## Required UAT scenarios

Record tester, timestamp, request ID, expected result, actual result, and evidence for each scenario.

### Authentication and authorization

- Unknown and inactive users receive `Username is incorrect.`
- A valid user without the required scope receives the correct access-required message.
- Admin can maintain every current entity.
- Product and Customer users cannot maintain each other's masters.
- Opportunity users can read active lookup data but cannot maintain Product or Customer.
- Direct access to the Uvicorn port is blocked.

### Master data

For Market, Currency, Users, User Access, Product, and Customer:

- Create a valid record.
- Reject missing and duplicate required values.
- Update after Refresh.
- Reject an update using a stale RowVersion.
- Verify the entity-specific `D` behavior.
- Confirm blocked Product/Customer values disappear from Opportunity choices.
- Confirm cache invalidation makes successful master changes visible.

### Opportunity

- Create one header with two items.
- Confirm the official Opportunity Number is generated.
- Preserve blank numeric values as database `NULL`, distinct from zero.
- Update one Draft header without updating every repeated row.
- Update, add, and delete Draft items.
- Reject duplicate Products within one Opportunity.
- Verify pagination keeps all items with their header.
- Verify every filter independently and in combination.
- Reject Excel updates after workflow leaves Draft.
- Test valid and invalid header/item transitions through the application/API.
- Verify RowVersion conflict and idempotent RequestID behavior.
- Verify workflow history rows and actor identity.

### Performance

- Test representative master sizes and transaction volumes.
- Execute the concurrent read/load smoke test with expected user concurrency.
- Record p50, p95, error rate, API CPU/memory, SQL duration, blocking, and connection count.
- Confirm effective SQL pool maximum: `workers × (DB_POOL_SIZE + DB_MAX_OVERFLOW)`.

## Go/no-go checklist

Production is **No-Go** if any item below is incomplete:

- [ ] Database backup and restore test completed
- [ ] Rollback owner and decision window agreed
- [ ] TLS certificate trusted and monitored
- [ ] Direct API port blocked
- [ ] Runtime SQL principal is least-privileged
- [ ] Bootstrap Admin login verified and second Admin assigned
- [ ] VBA projects signed
- [ ] Workbook/API contract versions match
- [ ] UAT authorization and concurrency tests pass
- [ ] Data migration and reconciliation signed off
- [ ] Monitoring and alert routes tested
- [ ] Support desk has the user guide and escalation contacts

## Cutover sequence

1. Freeze changes in the outgoing environment.
2. Back up the target and record the restore point.
3. Deploy the exact checksum-verified UAT release.
4. Apply approved production database migration.
5. Load and reconcile approved data.
6. Start the API and reverse proxy.
7. Run read-only smoke tests.
8. Run one controlled Create/Update test and remove or clearly label the test record.
9. Publish signed workbooks and Power Platform solution.
10. Monitor closely during the agreed stabilization period.

## Rollback

Stop new user access first. Roll back the API and workbooks as one compatible release. Restore the database only under DBA control and only when business owners accept loss of changes made after the restore point.

Never solve a contract mismatch by distributing an old workbook against a newer incompatible database.
