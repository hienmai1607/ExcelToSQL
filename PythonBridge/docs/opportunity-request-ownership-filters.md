# Opportunity and Packaging Request ownership filters

Opportunity layout includes Created by. Request layout includes Created by and Assigned to. These match username prefixes, are parameterized, and filter the complete server result before header pagination. A request creator is its RequestedBy user; an Opportunity creator is its CreatedBy user. Search, Clear, hiding filters, profile persistence and Excel page export use the same filters.

The Assigned to me header column counts non-canceled request items assigned to the authenticated actor. It follows the existing Items grouping: a Mix family is one item when the parent is in the same request. Completed assigned items remain counted; canceled items do not. It can be sorted and hidden through layout. Existing request profiles receive the column once when upgraded to layout field version 9; subsequent saved choices are preserved.

No database migration is required. Deploy core and webapp/dist, restart the API, then refresh the browser. No existing assignments or transactions are changed.

Validation: 26 focused backend contracts and 12 browser/workbench checks passed, along with live desktop SQL/HTTP checks for Admin, Sales and two users with assignments. Production build passed. The checks made no business changes. Broader legacy suites still contain unrelated failures: old migration fixtures reject the current authorization procedure, Excel fixtures omit required template versions/dropdown mocks, and a workbench test uses an ambiguous date selector. These were excluded from the focused result above.

The item review area and request editor label PIC separately from Approved by. The approver comes from the existing ReviewedBy user recorded on the response, and is shown only while the item is Approved. Missing historic reviewers display Not recorded, without falling back to PIC or the current user. PCR-33493 was checked against desktop records: PIC hien.mai, approver Admin.
