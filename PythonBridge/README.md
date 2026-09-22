# Excel-to-SQL Bridge

Current user documentation: [User Guide](docs/user-guide.md)

Company migration documentation starts at: [Company Deployment and Handover Package](deployment/company/README.md)

Technical design references:

- [Authentication and deployment](docs/authentication-and-deployment.md)
- [Transaction model](docs/transaction-model.md)
- [Packaging model](docs/packaging-model.md)

Project layout and shared functions:

- Active workbooks: Admin_Master.xlsm, Product_Template.xlsm, Sales_Template.xlsm and Packaging_Template.xlsm.
- VBA sources: root .bas files. modHttpJson shares HTTP, date and encoding functions; modSaveConfirmation shares command counting and Save/Refresh dialogs.
- modPagination shares editable page-size validation, navigation and successful-load state. Run scripts/update_pagination_workbooks.ps1 with Excel closed to update all four workbook controls and entity paging procedures.
- Entity modules keep field mappings, authorization-related validation and transaction rules specific to their entities. Opportunity confirmations count serialized headers/items.
- Workbook maintenance scripts use scripts/workbook_backup.ps1 to create unique recovery copies under backups/. Existing before_* copies are also archived there; restore by copying the chosen workbook back while Excel is closed.
- SQL migrations, deployment scripts, tests, prototypes and Database_Structure.xlsx remain project assets. Keep migrations for repeatable deployment.
- backups/, Python bytecode and Excel lock files are excluded from Git. Bytecode is regenerated automatically.
