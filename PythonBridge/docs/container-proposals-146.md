# Container proposals (146-147)

The 3D icon uses one layout for both modes: controls and final carton measurements on the left, scene on the right, and a container comparison table below. Floor loading omits Palletization and the Pallets column. All five active container types are offered as alternatives, even when the request specifies one type or size. Each container has an independent carton count and a Proposal checkbox.

Checked options are shared with Opportunity when the packaging response is saved (and follow existing response approval visibility rules). The exact requested type is selected and cannot be unticked; for a family/size request, at least one matching type must remain selected. Additional alternatives start unchecked. Previewing alone does not add an alternative or replace an existing proposal in another loading mode. Multiple proposals, independent manual quantities, and read-only viewing are supported. Old configurations without flags retain legacy behavior until edited.

`ContainerLoadProfiles[code].Proposal` is a strict JSON boolean. Migration 146 extends the existing SQL profile validator and merger so flags persist across sparse saves. Migration 147 enforces the requested-type minimum in the SQL merge; API saves and submissions also enforce it. Previous procedure text is archived. No existing business rows, captured configurations or pricing snapshots are rewritten. Opportunity excludes unchecked profiles and plans, including the currently previewed option, so its costs cannot silently use an unchecked capacity. Sales still owns the commercial container choice.

## Deployment

Desktop test has migrations 146-147 installed and verified, including rollback rehearsals and idempotent reruns. For a VM already through 145, apply `sql/146_container_proposal_flags.sql`, then `sql/147_required_container_proposal.sql`. For a VM through 141, generate and apply `sql/deploy/upgrade_142_to_147_vm.sql` with `scripts/Build-VMUpgrade142To147.ps1`.

Back up the VM database and stop the API before migration. Deploy matching `core/` and `webapp/dist/`, restart the API, and hard-refresh the browser. Do not deploy the checkbox UI against an older API or SQL implementation.

## Checks

Focused browser tests cover independent multiple ticks, saved boolean payloads, retained manual counts, read-only checks, floor-only columns, and desktop/mobile layout. Python contracts and rollback-only current-schema audits verify boolean round trips, sparse-save retention, unchecked-option exclusion from Opportunity, unchanged TCB results for checked options, and original-data preservation.
