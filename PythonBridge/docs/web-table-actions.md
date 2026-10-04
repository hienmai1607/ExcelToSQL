# Compact web workspace

The desktop baseline is 1920 x 1080, with responsive layouts for smaller screens
and both light and dark themes.

## Navigation and lists

- The sidebar groups Sales workspace, Packaging, Raw materials and Shared masters.
- Click a record ID/code to edit it, or to open its permitted read-only view.
  Click the item total on an Opportunity or Packaging Request to show item lines.
  A request item's Product code opens its response at that item.
- Record IDs stay pinned on the left during horizontal scrolling. Product
  Grades, item selection and document controls remain available where needed.
- Table bodies scroll within a bounded area, keeping the horizontal scrollbar
  close to the visible rows. Column headers stay visible while rows scroll.
- Existing code-column widths and sorting remain available. The record ID/code
  remains the first column; other columns keep the saved view order.

## Packaging response

Product Info contains Nut Density and calculated Used volume. Nut Density remains
an input on the response, not a Product Master field. Product weight comes from
the request snapshot.

Packing Way shows the confirmed layer count and the original requested count.
Each layer has its unit count with its calculated net weight directly below.
The final layer's count remains fixed at 1. Primary, Secondary and Tertiary
pricing sections sit side by side when the viewport permits.

Request editors and standalone response forms have fixed headings and action
bars, with only the body scrolling. Pricing history is an icon beside the item's
PIC and status. Icons retain accessible names and tooltips.

## Compact interaction update (2026-10-03)

- Success and general error notifications are dismissible top-centre popups.
  They use the browser's top layer so notifications remain visible over open
  editors without taking space in the form. Success messages dismiss after
  12 seconds; errors remain until dismissed or replaced.
- Customer, Opportunity, Request and master layout panels support dragging
  columns. Keyboard-accessible move buttons remain available. Only the panel
  body scrolls; Reset, Save and Close stay in its fixed footer.
- New-record icons sit at the right of the pinned ID header and use compact
  dimensions. Opportunity editing has a fixed heading and footer around a
  compact scrolling body.
- Packaging requirements and responses use dividing lines rather than nested
  boxes. Requested layers and container settings share a desktop row; the
  Primary, Secondary and Tertiary requirement sections appear side by side
  according to the requested layer count. Narrow screens stack these sections.
- Explanatory help is available through small information icons on hover or
  keyboard focus. Actual request notes, snapshot data, calculated values and
  actionable validation warnings are retained.
- The Packaging Request item table owns PIC assignment and workflow review.
  Its pinned Review column shows permission-appropriate Assign,
  Submit, Approve, Return and Cancel icons. Return/cancel require a reason.
  Assignment and transitions use the current item row version and refresh
  items after success. Unknown write outcomes block further actions until
  the user refreshes the items.
- Editors show PIC as read-only. Response editing and Review & save remain
  in the editor; manager workflow review is no longer duplicated there.

This incremental interaction update changes only the webapp. Deploy the newly
built webapp/dist to an installation with the preceding API/features already
applied, then refresh the browser. No additional API or SQL change is required.
Excel Local Update contracts, workbooks and macros remain unchanged.

## Consistent controls update (2026-10-03)

Packaging copy is now a compact Copy icon on the requirements heading. It
opens a source-selection popup and copies the latest unsaved packaging values;
product details and shelf life remain unchanged. Locked items cannot receive
copies. Copying does not save or submit the Opportunity.

Contextual help sits directly beside the label or heading text. Monetary and
exchange-rate text inputs use a consistent 15-character width. Packaging
request/response accordions have an accent heading; field labels use lighter
weight. Shared icon controls use 28-pixel buttons with 16-pixel glyphs.

All list filter actions use Search / Clear. The redundant sort summary is
removed; sortable headings and the sort editor remain available.

Unit Conversions uses the standard toolbar, a bounded scrolling table and the
shared pager outside that table. Its API supplies the authorized, filter-matched
total for the standard records / Page N of M display. Records per page still
saves through the existing profile layout.

Review controls are horizontal. Response attachment controls are hidden in Item
View and Edit View. The default desktop review column is 360 pixels, and saved custom
widths remain supported with horizontal overflow rather than wrapped controls.
Narrow screens temporarily cap this column at 220 pixels without changing
saved desktop widths. Review permissions and row-version checks are unchanged.

This update is webapp-only. Build and deploy webapp/dist to an installation
with the preceding features already applied. No new API, SQL, workbook or
Excel Local Update changes are required.

## Saved records per page behavior

The Layout panel saves records per page along with other view preferences.
Opportunity and Request header/item views are independent, as are Customer,
each master, Unit Conversions and Packaging Dimensions. The request editor also
provides a Save item page size icon. Allowed sizes are 1 through 500.

Item View and Edit View now save separate page sizes for both Opportunities and
Packaging Requests. Item View keeps its existing table layout; the editor saves
to its own `editor_page_size` preference (default 25 for older profiles).
Saving either view leaves the other unchanged. Product links locate the correct
editor page even when its page size differs from the Item View table.
Restart the API and rebuild/deploy webapp/dist for this preference-model update;
no SQL migration is required.

Older profiles without the added fields still load. Profile saves use the
existing per-user version check. Viewing a read-only record never enables a
save operation.

## Deployment

Deploy the updated webapp/dist together with core/preferences_api.py,
core/opportunity_views.py, core/request_views.py and core/unit_conversion_api.py.
Restart the API and refresh the browser. These UI and preference changes require
no new SQL migration; the earlier feature migrations remain prerequisites.
Excel Local Update workbooks and macros are not part of this update.

## Current editor fields and grouped item layouts

Opportunity and Packaging Request Item Views now use a web-only field catalog
matching the current editors. Product Info, Packaging Request and Packaging
Responses each have their own visibility and column-order group. Drag/drop and
the keyboard move buttons cannot cross group boundaries. Prefix columns are
limited to Product Info. Calculated fields are visible but do not offer
server-side sorting.

Older item layouts are upgraded to field version 4 and initially display every
supported editor field. Legacy-only fields are removed from web layout choices.
After saving a version-4 layout, hidden fields and within-section order are
restored normally. Header layout choices, saved page sizes and valid widths are
preserved. The legacy workbook field catalogs remain separate and unchanged.

The Packaging Request header displays its immutable request note once rather
than repeating it on each item. Pagination and editor actions share a fixed
footer outside the scrolling content; shared change-log dialogs also keep their
pager outside the scrolling table. Unit Conversions now returns an authorized,
filter-matched total and displays the same records / Page N of M information as
other lists, including on empty pages.

Search, selected field tabs and selected toolbar icons use shared action-theme
tokens in both light and dark mode. Response reads retain their existing
draft/approved permission checks; calculated Opportunity response weights use
the original request's product-weight snapshot.

Deploy the rebuilt webapp/dist with core/web_item_fields.py and the updated
core/opportunity_views.py, core/request_views.py and core/unit_conversion_api.py;
restart the API. This update requires no new SQL migration.

## Packaging spacing and notification refinement (2026-10-03)

Request and response sections share compact typography and spacing: section
padding is 8 pixels, headings have a 6-pixel gap, and field labels have a 4-pixel
gap before their value/control. Both editable and read-only fields use the same
font rhythm. Packing Way no longer adds padding around each layer.

Read-only field labels use smaller muted text (11 pixels), with larger
foreground values (13 pixels) directly underneath. The distinction applies
to all shared packaging requirement sections in both light and dark themes.

Submit and Cancel appear only when the item has a saved PIC assignment.
Selecting a person without saving does not reveal those actions. Existing
role checks, stage checks, row-version protection and unknown-outcome guards
are retained. Approve and Return remain manager review actions.

Response attachment controls are removed from both Item View and Edit View;
stored attachments and initial Opportunity request uploads are not deleted or
changed. The Review column keeps its existing saved-width preference key.

Request-time snapshot metadata is available from a focusable Info icon on the
field-tab line, including its timestamp and exchange rate, instead of a banner.
Actual request notes remain visible.

The notification regression was reproduced from a no-wrap review table cell.
Shared notification text now explicitly wraps and can shrink without clipping
the close icon. Failed review-action notifications live inside the active
confirmation dialog, so native modal inertness does not block dismissal.
The confirmation and entered reason remain available for retry.

These refinements are webapp-only. Deploy the rebuilt webapp/dist to an
installation with the preceding API changes applied; no additional SQL or API
change is needed for this refinement.

## Entry versus display controls (2026-10-03)

Info icons follow their label text with a small gap rather than sitting at the
far edge of a field. Shared tooltips stay within the viewport on focus/hover.
Request snapshot help also sits beside the field tabs.

Only entry fields retain borders and filled input backgrounds. Calculated,
read-only and permanently locked fields use plain display styling.
Temporary loading/saving disables an entry control without changing that
visual distinction. Locked dropdowns no longer show an entry arrow.

Editors with a top close control no longer repeat Close/Cancel in their footer.
Unit Conversion closing is also at the top. The existing unsaved-change checks
and busy locks remain intact; confirmation dialogs retain their Back actions.

Unit Conversions displays records / Page N of M from the authorized API total.
For older API responses without a total, an exact count can also be determined
on page 1 without more rows, or on a non-empty final page. Unknown multi-page
totals are not guessed: deploy the current core/unit_conversion_api.py along
with the webapp to obtain full page counts for every list.

## Design references

The grouped navigation and compact record header/body/action layout draw on
[Salesforce layout guidance](https://www.lightningdesignsystem.com/2e1ef8501/p/33e9af-layout)
and the [Atlassian navigation layout](https://atlassian.design/components/navigation-system/layout).
The existing application palette, business fields and permission rules are retained.
