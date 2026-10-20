# Raw Material Origin and form layout

Raw Material now uses optional Origin (up to 200 characters) in its editor, list, search and Excel template. Description is retired from these surfaces, but historical database values are retained and are not converted into Origin. Sparse API updates preserve omitted values; explicitly clearing Origin removes it.

Deploy sql/131_raw_material_origin.sql before the updated API. It adds the nullable column and V3 write contract while retaining V2.

The master Excel contract is master-5. Download a fresh template; older master templates are rejected before updates. The checked-in local XLSM and VBA module use the same version.

Scrolling master and transaction dialogs place their action bar and navigation trail after the form content, rather than over later records. Bounded record dialogs retain their separately allocated footer.

Product grade and Opportunity grade snapshot Material cards follow their source grade row, including resizing and hierarchy edits. Assignments from different depths use separate columns to avoid overlap when parent and child grades share a row.
