# Multi-item Opportunity numeric binding

The real ODBC TVP path failed before the stored procedure ran when later items required more numeric precision than the first item. For example, a first shelf price of 53.39 followed by a blank price (represented by the existing -99999999.99 NULL sentinel) raised SQLParamData 22003. Larger later annual units/prices and blank awarded percentages reproduced related errors. Reversing the same rows succeeded.

The Opportunity batch now binds AnnualUnit, EstPctAwarded and ShelfPrice as parameterized numeric text. SQL's typed TVP still converts and validates the DECIMAL values. This avoids first-row Decimal precision inference without float conversion, numeric rounding, new NULL sentinels, schema changes, or SQL text interpolation.

No business records are modified by deploying this fix. Failed documents remain rolled back; no unknown-save warning behavior was weakened.

Regression command (current-schema, rollback-only):
Set PYTHONPATH to core;tests/python and run:
python -m unittest opportunity_tvp_numbers_contract.MultiItemNumbers

Coverage: populated-to-blank prices/awards, larger later quantities/prices, true zero, reversed input order, and numeric boundary values.
