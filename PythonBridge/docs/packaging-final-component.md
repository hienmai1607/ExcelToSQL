# Final components in Packaging Type Master

Apply sql/99_packaging_final_component.sql after 98 in the intended application database, stopping on errors. Restart the API and refresh the browser. The script is rerunnable.

- The Order caption is removed; Primary, Secondary and Tertiary choices remain for root types.
- The editor uses three rows: Parent Type / Packaging Type; horizontal Primary / Secondary / Tertiary choices; Shipping / Final component / Status. Narrow screens stack fields. Shipping remains root-only and required shipping-layer rules are unchanged.
- Final component is an explicit checkbox for both roots and child types.
- Only active Final components with no child types can receive new Packaging Material assignments.
- A parentless Final component still appears in root Packaging Type selectors and its own Materials are included in pricing.
- A Final component cannot be a Parent Type. Clear Material assignments before clearing the flag.
- Existing child leaves and leaf types with legacy Material assignments are marked Final component during the first migration run. Their type RowVersions change; refresh open forms. Saved quote/PCR snapshots are not rewritten.
- Price Basis is retired from the current UI/layout/export/Excel Local Update. Stored values are retained for existing calculations; omitted values on type edits preserve the stored basis. New types default internally to Count.
- Final component is included in layout, export and Excel Local Update. Download a fresh workbook.
- Old unrelated invalid geometry does not prevent a flag-only change; hierarchy and shipping formula constraints still apply when those attributes change.
