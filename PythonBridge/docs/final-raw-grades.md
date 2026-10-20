# Final Raw Grades

Migration 134 adds `RawGrade.FinalGrade`. It marks existing grades with no children as final, including roots; existing parents stay non-final. IDs, hierarchy and material links are preserved. A rerun does not reset later flag choices.

New grades start unchecked. Raw Grade Master exposes the flag and places Grade name first. Raw Material can select an active final grade at any level. A final grade cannot have children. An assigned grade cannot be changed to non-final until its materials are reassigned. A parent with children cannot be marked final.

Product grade versions and Opportunity snapshots now accept direct material links on final root grades as well as final child grades. Material must be active and assigned to the exact selected final grade. Non-final grades do not show editable material boxes. Historical read-only assignments remain visible if lookup data is no longer available.

Grade tree layout:
- Version, status and view actions are grouped in the compact header.
- The general ratios note is removed; root totals and Add root sit beside Level 1.
- Child ratio totals and child counts are in each card's first/header line.
- Only final grades show editable Raw Material cards, aligned with their source nodes in a dedicated material column.

Coverage:
`python -m unittest final_grade_contract` with `PYTHONPATH=core;tests/python` verifies current-schema SQL/API behavior using rollback-only fixtures.
Browser coverage includes Product draft/version editing, root material selection, master flag saving, and alignment for mixed root/deeper final grades.
