# Packaging Type Shipping

Apply `sql/73_packaging_type_shipping.sql` after migration 72. It is rerunnable and defaults existing Packaging Types to `Shipping = False`; it does not guess which types are shipping containers.

- Shipping is a Boolean on root (parent) types only. Children cannot enable it; reparenting a root clears Shipping.
- The final layer of a two- or three-layer request/response must support its Secondary/Tertiary order and have Shipping enabled. Intermediate layers need only match their order. A single Primary layer is unchanged.
- Unchanged historical selections remain readable and can accompany unrelated edits. Changing layer count or selecting a different final type applies the new rule.
- Shipping dimension definitions require D1, D2, D3 names and active units, regardless of price basis. Complete any existing active dimension definitions before enabling Shipping on that type.
- Square-meter formulas and preview are available for Shipping Count/Volume types too. Formula remains optional unless the price basis is Square meter.
- Migration 74 adds an optional Shipping-only Volume formula and cubic-metre preview; all three dimension definitions remain required.

The database validates root eligibility and dimension completeness as well as the application. Optimistic RowVersion checks, authorization and audit behavior remain in place.

After migration and API/UI updates, restart the API and refresh the browser. Mark appropriate root types Shipping in Packaging Type Master; no existing business classification is overwritten.
