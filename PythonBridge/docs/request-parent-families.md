# Request parent families

Packaging Requests use a parent (or standalone item) as the visible workflow unit. Children are nested by their actual OpportunityItem.ParentItemID within the same request, ordered by MixChildNumber. Standalone occurrences of the same product code are never attached to a mix.

Header item counts and editor/detail pagination count parent/standalone groups. Families are not split across pages. Child responses remain independent; Same config is still an explicit choice for copying settings.

Assign PIC, Submit, Approve, Return and Cancel operate on the whole family from the parent. Assignment applies the same PIC to every member. Existing ownership, role, stage and completeness checks apply to every response; Admin override remains supported. Actions run in one transaction through existing audited procedures and roll back together.

The browser supplies ExpectedGroupVersions for every member. Stale membership or any changed child causes a refresh conflict. Older clients without that optional map still resolve and lock the whole family on the server. Sending a child ID cannot bypass grouping.

Response saves also batch an edited family atomically. Save drafts before workflow actions. Standalone items remain independent. Historical requests missing a parent or child are rejected instead of guessing a relationship or creating new business records.

Deploy matching core and rebuilt webapp/dist, then restart the API. This change adds no SQL migration and does not change existing PICs or stages on deployment. Prior migrations required by other features still apply.

Checks: request_family_contract, workbench_api_contract, packaging_pic_access_contract; request-families, request-editor and packaging-pic-access browser tests.
