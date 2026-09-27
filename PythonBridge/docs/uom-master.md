# Units of Measure

Admin users maintain Units of Measure from the webapp sidebar: unique UoM code, optional UoM name, and Active/Block status. The shared master interface includes confirmation, RowVersion concurrency, layouts, sorting, exports and Excel Local Update. Packaging users can select units in pricing but cannot maintain the master.

Packaging Material Pricing now displays **Base UoM** instead of free-text Price Basis. New selections must be active. Existing blocked units can remain unchanged on an existing price. Delete blocks a unit; it does not delete referenced data. A referenced UoM code cannot be renamed; its descriptive name can be changed.

Apply sql/34_uom_master.sql after migration 33 to the existing test database. Existing Price Basis values are imported exactly as UoM codes, without guessing conversions. The original SQL column and legacy batch field PriceBasis remain internally for compatibility, backed by a foreign key to dbo.UoM.UoMCode. New interfaces use BaseUoM. Saved layouts upgrade the old field automatically. Older clients must also use a valid UoM code.

Deploy API, webapp/dist and the rebuilt templates/Packaging_Master_Local_Update.xlsm; restart the API and download fresh workbooks. Apply sql/36_material_uom_lookup.sql to connect Packaging Material's UnitOfMeasure to the same master-backed dropdown and SQL validation. Existing material units are imported if missing. Codes referenced by materials cannot be renamed. This does not implement automatic unit conversion; Product weight entry remains the separate g/oz conversion control.
