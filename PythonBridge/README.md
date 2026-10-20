# Excel-to-SQL Bridge

Single / Copy Dim.: [migration 106 and behavior](docs/packaging-copy-dimensions.md).

Packaging PIC permissions: [migration 105 and deployment notes](docs/packaging-pic-access.md).

Current user documentation: [User Guide](docs/user-guide.md)

Latest VM incremental upgrade (database already through migration 116): [combined migrations 117-137 and VM move checklist](docs/vm-upgrade-117-to-137.md). AI is temporarily disabled in this release.

For databases already through migration 104: [combined migrations 105-116 and deployment notes](docs/vm-upgrade-105-to-116.md).

For databases through migration 96: [combined migrations 97-104 and deployment notes](docs/vm-upgrade-097-to-104.md). For older databases, apply the prerequisite [89-96 bundle](docs/vm-upgrade-089-to-096.md) first, following its documented upgrade order.

Company migration documentation starts at: [Company Deployment and Handover Package](deployment/company/README.md)

Technical design references:

- [Authentication and deployment](docs/authentication-and-deployment.md)
- [Transaction model](docs/transaction-model.md)
- [Packaging model](docs/packaging-model.md)
- [Packaging Final components and migration 99](docs/packaging-final-component.md)
- [Shared conversion output UoM and migration 100](docs/packaging-conversion-output-uom.md)
- [Response weight, Container Load and density defaults: migration 101](docs/response-weight-loading-density.md)
- [Opportunity change log](docs/opportunity-change-log.md)

Project layout and shared functions:

- Active workbooks: Admin_Master.xlsm, Product_Template.xlsm, Sales_Template.xlsm and Packaging_Template.xlsm.
- VBA sources: root .bas files. modHttpJson shares HTTP, date and encoding functions; modSaveConfirmation shares command counting and Save/Refresh dialogs.
- modPagination shares editable page-size validation, navigation and successful-load state. Run scripts/update_pagination_workbooks.ps1 with Excel closed to update all four workbook controls and entity paging procedures.
- Entity modules keep field mappings, authorization-related validation and transaction rules specific to their entities. Opportunity confirmations count serialized headers/items.
- Workbook maintenance scripts use scripts/workbook_backup.ps1 to create unique recovery copies under backups/. Existing before_* copies are also archived there; restore by copying the chosen workbook back while Excel is closed.
- SQL migrations, deployment scripts, tests, prototypes and Database_Structure.xlsx remain project assets. Keep migrations for repeatable deployment.
- backups/, Python bytecode and Excel lock files are excluded from Git. Bytecode is regenerated automatically.
