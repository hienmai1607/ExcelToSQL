# Mix Product Same config

The switch in the Mix parent's Product Info response is saved on that PCR parent.
It starts off for existing requests and is not a Product Master setting.

When enabled, the first child in the immutable captured Mix composition is the
source, regardless of grid sorting or pagination. Other children display matching
confirmed layers, packaging types, packing quantities, calculator measurements,
MOQ and packaging prices. Their packaging controls are disabled. Changes to the
first child's packaging update the siblings immediately.

Each child's Nut Density remains independently editable. Product identities,
net weights, annual units, grades and mix quantities are never copied. Logistics
continue to belong to the Mix parent. Turning the switch off retains the copied
values as defaults and unlocks independent packaging editing.

The editor loads every page of Mix requests and retains their drafts while
paging. Closing or refreshing still asks before discarding unsaved work.
Groups cannot be enabled with missing children, approved/canceled children or
children assigned to a different PIC. Existing protected responses remain locked.

Review retrieves the source's saved pricing inputs when needed, then previews
each copied calculation for its target child. Pricing fingerprints are never
copied between items. Each linked Mix group saves in a single existing response
transaction; a permission, concurrency or pricing failure rolls back the group.
The API rejects partial linked-group saves and mismatched active packaging types
or packing quantities. Normal responses keep their existing independent save flow.

## Deployment

For a VM already through migration 85, run the single combined file
`sql/deploy/upgrade_086_to_088_vm.sql`, which includes 86, 87 and 88 in order.
Alternatively, run the individual migrations in order; do not run both forms.
See `docs/vm-upgrade-086-to-088.md` for the deployment checklist.
Deploy core/packaging_fields.py, core/request_views.py, core/mix_same_config.py
and the rebuilt webapp/dist together. Restart the API and reload the webapp.
Migration 88 is repeatable, defaults the new field off, preserves request history
and logs subsequent toggle changes.
