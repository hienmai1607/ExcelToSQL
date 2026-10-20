# Shipping Copy Dim. and live pallet totals

The browser accepts fixed-point Shipping heights with up to 20 decimal places, including captured values such as 147.000000. Pallet layers, units, net/gross weights and height efficiency are previewed from the current draft; no save is needed. Exact integer arithmetic still floors whole layers and checks supported count limits.

Copy Dim. applies in the calculator to every root Single type, including non-Shipping Singles such as Doy Count. The root-only Single eligibility rule remains unchanged. Non-shipping Singles can still have vendor prices created without dimensions, but their material geometry must be maintained before using Copy Dim. in a calculator.

Packaging Material remains the sole owner of physical measurements. A Shipping Single with Copy Dim. still requires a current, active, matching Material dimension definition and its defined measurements. Pricing does not add another geometry entry.

Deploy sql/132_shipping_single_copy_dimensions.sql to scope the legacy V6 SQL pricing guard. It changes procedure logic only, not master values, historical prices or business records. The calculator catalog and copy hydration no longer require Shipping: Copy Dim. copies the selected Single material\u0027s own geometry, not a child material into an assembled parent. The dedicated pallet calculator continues to read pallet Material measurements independently.
