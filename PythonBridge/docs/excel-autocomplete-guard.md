# Excel AutoComplete in Local Update workbooks

Each Local Update data sheet keeps a hidden field-key row (Command, Status, Origin…) directly above the data. Excel AutoComplete includes hidden rows, so typing `C` in the Action column used to suggest "Command", and other columns behaved the same way.

All four Local Update templates (Packaging Master, which also produces the Ingredient workbooks; Packaging Request; Product; Opportunity) now import `modAutoCompleteGuard.bas`. Their `ThisWorkbook` events call it:

- **Open / Activate:** stores the user's current AutoComplete setting and turns AutoComplete off.
- **Deactivate / BeforeClose:** restores the stored setting.

AutoComplete is an Excel-wide option, so other workbooks behave normally whenever a Local Update workbook isn't active. The stored value is kept under `HKCU\Software\VB and VBA Program Settings\PythonBridge\Excel` until it is restored, so a VBA reset cannot lose it. If Excel crashes while the workbook is active, AutoComplete stays off until a Local Update workbook is next opened and closed. Users can also re-enable it in File › Options › Advanced.

Dropdown lists (Action C/U, Status, codes) are unaffected.

## Deployment

No API, SQL or template-version change is required. Deploy the rebuilt `templates/*.xlsm`; users get the fix by downloading fresh workbooks. To rebuild, run with Excel closed:

    powershell -File scripts/build_<family>_local_template.ps1

Check: `powershell -File scripts/test_autocomplete_guard.ps1` (opens copies of all four templates in Excel and verifies open, switch, reactivate and close, with AutoComplete initially on and off).
