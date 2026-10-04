# Web packaging requirement sections

The current layout and deployment requirements are described in
[packaging-request-layer-details.md](packaging-request-layer-details.md).
The historical implementation notes below describe the earlier SQL-56 layout.

Opportunity item create/edit now uses Container and Configuration, conditional
Pallet, Primary packaging, and Secondary packaging sections. Packaging Request
item details show the same sections read-only; Packaging response inputs remain
separate and unchanged.

- Container: Dry / Reefer.
- Configuration: Pallet load / Floor load / Both.
- Pallet fields appear for Pallet load or Both. Stacking: Single / Double.
  Floor load clears inactive pallet values on web saves.
- Primary and Secondary types select active root Packaging Types of the matching
  Order (Parent Type is empty). Previously selected unavailable types are retained
  on unrelated edits.
- Primary and Secondary transparency: Transparent / Opaque / NA.
- Number of Primary: optional positive whole number, up to 2,147,483,647.
- Both Shelf life fields are read-only: current Product Master values in
  Opportunity, stored request-time snapshots in Packaging Request.
- Mix-child items retain their established restriction: no Container or Pallet
  fields. Configuration and packaging fields remain available.
- Recyclable, Recycled content, Metalized/aluminum and Special comments are kept
  in Other requirements. Old Packaging type text remains visible read-only when
  present; new items use Primary Type instead.

New requested types, names, transparency and counts are copied into immutable
Packaging Request snapshots. They are independent of Primary/Secondary response
types. Shelf life is also stored at request creation in
`PackagingConfigurationRequestItem.ShelfLifeDays`. Request details display this
frozen value in both packaging sections; later Product Master edits do not change
existing requests. A missing historical shelf-life snapshot remains blank rather
than being filled with today's Product Master value.

Read-only request details label the type snapshots Requested Primary Type and
Requested Secondary Type. Editable web responses prefill an empty Primary Type
or Secondary Type from the matching requested name; existing response values
are never overwritten. Prefilling does not write to the database: Review and
save uses the regular response validation and row-version checks. Read-only
responses are not changed. An unavailable requested type remains visible, but
the user must choose an active type before saving it as a new response value.
The full request detail also displays both transparency fields, Number of
Primary, snapshot shelf life, container/configuration, conditional
pallet fields and the retained Other requirements.

All web request-item reads send an explicit sort parameter, defaulting to `[]`
when no sorting is selected. This selects the snapshot-aware API reader in both
the request list and Edit dialog. Omitting sort would use the legacy SQL grid
reader, which does not return the newer requested type, secondary transparency
and count fields even when they are stored correctly. Deploy the updated
`webapp/dist` and refresh to apply this reader-selection fix; it requires no
additional SQL, API code change or Excel Local Update change.

Opportunity header inputs are compact, with the counters alongside the second
field row at widths of 851px and above, including 1020px screens. Narrower screens
wrap the header fields for readability.

Each editable item's Packaging requirements has a Copy from item selector and
Copy packaging button. Sources are other selected-product items in this
Opportunity, including mix children and read-only items. Copy uses current
unsaved values and replaces applicable packaging fields, including blanks.
Product identity, description, annual units, estimated award, shelf price and
Product shelf life are never copied. Parent-only container and pallet fields
are copied only between parent items; Floor load clears inactive pallet values.
Read-only targets cannot receive copies. Review and save persists the result
through the existing validation, concurrency checks and audit workflow.

The compact-header and copy-controls addition is web-only: deploy the new
`webapp/dist` and refresh the browser. It needs no additional SQL beyond SQL 56.

Layout settings and Excel Local Update field lists/templates are unchanged.
Web-only enum validation is enabled by the web payload marker; existing Excel
inputs keep their established behavior. Old values are not rewritten by migration
or unrelated edits. New fields participate in processing locks and change logs.

Run `sql/56_web_packaging_requirement_sections.sql` after SQL 55 against the
intended database (the script selects `test`). Deploy updated core files and
`webapp/dist`, restart the API and refresh the browser. No workbook/template
deployment is needed for this change.
