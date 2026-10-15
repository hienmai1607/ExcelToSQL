# Packaging PIC access (migrations 105 and 113)

The saved, assigned PIC or Admin may edit a response and move it to Working / Pending Review. The item must be Assigned, Working or Returned. Ordinary members need Packaging Request edit access and their own saved PIC assignment. Migration 113 adds the Admin ownership override across browser, Excel, API, additional response fields, pricing and load planning. It preserves the assigned PIC, audit trail, version checks and stage locks.

Packaging managers assign/reassign PIC and approve/return responses. Admin can also respond without reassigning the PIC. PIC choices are active Packaging members with Packaging Request edit access; Admin-only and display-only users are excluded. Existing assignments are retained; reassign an ineligible PIC to an eligible member.

An explicit PackagingManager direct-access grant provides management authority. Role-derived compatibility scopes do not: a role with Packaging Requests Edit makes its users Packaging members, not assignment/review managers. To make someone a manager, grant PackagingManager in User master Direct access. Managers who also respond need Packaging membership and their own saved PIC assignment.

## Deploy

1. Back up the application database and stop the API while upgrading.
2. Apply migrations through 104 first.
3. Run sql/105_packaging_pic_ownership.sql against the application database (not master). It is repeatable and updates definitions atomically; it does not change users, roles or business rows.
   The script explicitly captures ANSI_NULLS / QUOTED_IDENTIFIER ON. If PIC saves report SQL error 1934 after an earlier application of 105, rerun this corrected script; it repairs the affected module settings even when the ownership changes are already present.
4. After migrations through 112, apply sql/113_admin_response_override.sql. Deploy the updated core and built webapp/dist, then restart the API and sign in again.
5. Verify member A cannot edit/submit member B's response, managers can assign only eligible members, and assigned members can save and submit their own items.

Request document upload rules are unchanged; this policy governs response fields, saved pricing, load planning and submission. Migration 105 preserves the later Admin override when reapplied to repair SQL module settings.
