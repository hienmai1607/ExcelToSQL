# Four-layer packaging and pallet limits (26 October 2026)

Desktop database `DESKTOP-5BGMJSC / test` has migrations 142 and 143 applied.

For a VM already through migration 141, back up the application database and stop
the API. Run `sql/deploy/upgrade_142_to_143_vm.sql` in SQLCMD mode, then deploy
matching `core/` and `webapp/dist/` before restarting. The bundle is not atomic:
142 can remain committed if 143 fails. Both migrations can be rerun.
Keep VM-local secrets and uploads; keep `LOCAL_AI_ENABLED=0`.

## Behavior

- Four cumulative layers: Primary, Secondary, Tertiary, Quaternary.
- A standalone product can use four layers. A Mix child can use at most three;
  the parent must retain at least one. Parent count plus the deepest child count
  cannot exceed four.
- Children using two and one layers put the parent's first physical container at
  Tertiary, with Quaternary available next. Requested and confirmed configurations
  derive offsets separately.
- Add/Edit Master shortcuts use the existing master validators and permissions.
  Packaging Pricing keeps its linked Material locked.
- Pallet Material `MaxPayloadKG` is a maximum **gross** rating including the base,
  accessories and all packed goods. Existing materials 412 and 424 start at
  1,200 kg; reruns never overwrite maintained ratings.
- Capacity suggestions maximize cartons per layer first, then whole layers within
  both height and weight limits. Cartons/layer and Layers/pallet remain editable;
  invalid counts and overweight saved plans are rejected.
- When a child's confirmed layer count changes, save the configuration before
  recalculating the parent's pricing against its new global layer position.

## Existing data

Migration 143 archives original `PackagingTypeOrder` memberships and the replaced
procedure definitions in `dbo.PackagingLayerMigrationArchive`.

Legacy Primary Mix memberships become Secondary/Tertiary/Quaternary; Secondary Mix
becomes Tertiary/Quaternary; Tertiary Mix becomes Quaternary. Canonical memberships
already present are retained. The old selectable Mix memberships are removed.

Per-item database slots remain relative to that item's physical containers.
This preserves existing quantities, prices, calculation fingerprints and immutable
pricing history. Read models derive their cumulative labels. No historical pricing
snapshot is rewritten and no packaging layer is discarded. A pre-existing family
over four layers stops migration and requires explicit correction.

The archive is not a substitute for a full database backup. Restore the pre-upgrade
backup together with matching application files if rollback is needed.

## Verification

- Current-schema standalone four-layer workflow: 44 checks passed; create masters and Opportunity,
  capture request defaults, price four layers, verify compounded net/gross weights,
  approve and check TCB packaging allocation; fixture writes roll back.
- Replicas of OPP-2026-10075 and controlled OPP-2026-10094: 309 checks, including
  all 56 reference TCB cells and 84 independent controlled TCB outputs; cleanup
  and original-record preservation verified.
- 158 focused browser tests passed, covering global labels, child/parent limits, responsive
  layout, pallet auto-fill and pricing-master edit refresh without losing drafts.

The full legacy migration-replay suite is not a current-schema test: some fixtures
reinstall retired three-layer constraints and fail during setup. The focused
contracts above exercise the installed schema instead. Older Pallet Master CRUD
browser tests also target the retired standalone Pallet page, not the current
Packaging Material-based pallet workflow; they are not included in the passing count.

Rebuild the bundle with `scripts/Build-VMUpgrade142To143.ps1`.
