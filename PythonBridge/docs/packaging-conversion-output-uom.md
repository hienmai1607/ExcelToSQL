# Shared Packaging conversion output UoM

Apply SQL migration 100 after migrations through 99, then deploy the API and webapp together.

Packaging Dimension has one **Formula output UoM** beside **Convert from parent fx**. It applies to both conversion formulas. D1-D3 units remain the measurement input units; vendor Price UoM remains the quantity purchased from the supplier.

Both formula previews show the raw result in the selected output unit. Pricing converts that result to square metres for area pricing or the Material base UoM for count pricing. If units differ, maintain an active Unit Conversion, with material/vendor scope where needed. Missing or blocked conversions stop pricing rather than guessing a factor.

Example: with dimensions entered in mm, `D1*D2` returns mm2. Select mm2 and maintain mm2 to m2 with factor 0.000001. If the formula already divides by 1000000, its result is m2: select m2 instead. Do not convert twice.

The same output unit is shared; the two formulas still use their own parent/supplier measurement sets. Occupied area and volume remain fixed in m2 and m3.

Existing definitions retain a blank stored output UoM and their historical implicit units. Migration 100 does not rewrite formulas, prices, or saved request snapshots. Editing an Active definition with conversion formulas requires selecting an active output UoM. Changing its output UoM invalidates existing supplier-definition versions; refresh and save Packaging Material Pricing before recalculating.

Migration 100 is rerunnable and leaves existing row versions unchanged. Historical snapshots remain historical; new calculations capture the selected unit and maintained conversion metadata.
