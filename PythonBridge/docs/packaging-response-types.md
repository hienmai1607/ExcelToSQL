# Packaging response types

Primary Type and Secondary Type use active Packaging Type Master entries, filtered by Order. Blank choices are allowed in an incomplete response; the existing submission completeness checks still apply.

Pallet type, PM cost and cost currency are removed from response forms, view layouts and new Excel downloads. Historical database values and audit history are retained. Unrelated edits preserve historical costs and legacy/unavailable type selections. New or changed types are validated against the matching master order in SQL.

For VM deployment:

1. Run SQL 51 (Packaging Type Master) if not already applied.
2. Run sql/52_packaging_response_types.sql in the VM database.
3. Deploy updated core files and webapp/dist, then restart the API.
4. Download fresh Packaging Request Excel workbooks. Old workbooks cannot update retired fields.

SQL 52 has been applied locally only. No new business types are seeded; Admin or Packaging maintains the choices.
