# Compact response and pallet price defaults

Deploy migration 103_pallet_price.sql after 102, then matching core and rebuilt
webapp/dist. The rerunnable migration adds an optional USD/EA Pallet Master
price, refreshes the master view, and updates audited/concurrency-protected
pallet saves. Existing records remain NULL; no saved TCB costs are overwritten.
Older web/Excel clients that omit the price preserve it; explicit null clears it.

TCB defaults a blank pallet cost from the active matching response pallet, or
the requested pallet if no response pallet is selected. Saved overrides,
including zero, take precedence. The default is read-only until a normal TCB
save captures it. Child products do not receive their own pallet-cost input.

Packing Way gives Dimensions the largest share of its first row. Shipping
height stays in the calculation state but its separate field is hidden. Height
is highlighted in captured dimensions. Packaging sections show I/II/III at the
top-right. Pricing popups keep Calculate, Apply to response, and Close outside
the scrolling content; Apply still requires the normal response save.

Pallet-load container cartons = pallets per container x layers per pallet x
cartons per layer x (2 for Double stacking, otherwise 1). This also doubles
container net weight, not units or weight per individual pallet. Floor/Both
manual container entries remain unchanged.
