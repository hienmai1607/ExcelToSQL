# Web Packaging response sections

Web response forms now group fields into:

- Primary packaging: Primary Type, 1st PM MOQ, Nut Density (g/ml),
  calculated Used volume (ml), Cost basis.
- Secondary packaging: Secondary Type, Unit / CTN, 2nd PM MOQ.
- Palletization: Cartons / layer, Layers / pallet, Packs / pallet,
  Cartons / container.

Packaging description is no longer displayed or included in web response save
payloads. Its existing database column and historical values are preserved.
It no longer blocks submission or approval. Primary/Secondary Type, Unit / CTN
and both MOQs remain required for review.

PIC assignment is beside each item's heading/status instead of below the
Packaging request details. Existing assignment permissions, stage locks,
row-version checks, save/review confirmation and audit logging are unchanged.
The header wraps on narrow screens; 1920x1080 remains the primary resolution.

The web field list is separate from the legacy response field list. Layout
settings, Excel field lists and Local Update templates have not been modified.
The legacy description input remains supported.

For the sections-only VM deployment, run sql/57_packaging_response_sections.sql after SQL 56,
then deploy updated webapp/dist and refresh the browser. No new core API files
or workbook/template changes are needed for this addition. The migration alters
only the transition business implementation, leaving its public audit wrapper
in place, and can be run again safely.

The later density addition also needs SQL 58 and updated core files; see
[Nut Density and Used volume](packaging-response-density.md) for its deployment.
