# Fixed Seasoning in Recipe Info

Recipe Info always displays Seasoning ($/lbs) and Seasoning Ratio (%). Process Type component mappings no longer control these columns or their cost assignment. Process Loss calculations and grade-scoped Seasoning process eligibility remain separate.

Current TCB editing, preview and save use only Seasoning values. Separate saved Oil, Salt and custom component values are not merged into Seasoning, as requested. RM Ratio is 100 minus Seasoning Ratio. Historical version calculations retain their captured inputs.

Accepted Recipe Sheet defaults apply to matching Level 1 grade families without requiring a Seasoning process selection. Sheet-derived highlighting and individual manual overrides are retained; excluded grades show Seasoning fields without copying the sheet defaults.

No SQL migration is required. Deploy core and webapp/dist, restart the API and refresh the browser. Existing persisted Opportunity results change only when the TCB is saved again.

Validation: 23 focused browser checks, 6 component math checks, one rollback desktop commercial-save integration check, and the production build.
