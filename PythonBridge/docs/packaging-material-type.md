# Packaging Material type assignment

Packaging Material has an optional Packaging Type assignment from Packaging Type Master. New assignments must use active child types with no children, not root types. Existing root, non-leaf or blocked assignments survive unrelated edits but cannot be newly selected. Dropdowns show the child type name.

The assignment uses PackagingTypeID with a foreign key. Existing materials are left unassigned; no business records are automatically classified. Admin and Packaging maintain it; PackagingManager can view it. Raw Material is unchanged.

The Packaging Material table, layout/sort options and Excel exports include Packaging Type. For Excel updates, use Order / Packaging Type; an unqualified name is accepted only when it uniquely identifies an active child leaf. Blank clears the assignment, while omitted values preserve it.

Description is retired from Packaging Material entry, layout, sort and exports. SQL 75 retains historical descriptions unchanged; Raw Material still supports Description. Older material clients cannot overwrite the retired description.

VM deployment:

1. Apply sql/53_packaging_material_type.sql after SQL 52, then sql/75_packaging_material_child_types.sql after the existing hierarchy migrations.
2. Deploy updated core files and webapp/dist.
3. Restart the API and download fresh Packaging Material workbooks.

The existing shared workbook template is reused; no VBA rebuild is needed. SQL 53 has been applied locally only.
Current assignment rules: [Final components](packaging-final-component.md). After migration 99, active Final components without children can be assigned, including parentless types.
