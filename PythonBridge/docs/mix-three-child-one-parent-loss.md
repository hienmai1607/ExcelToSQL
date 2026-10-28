# Mix packaging losses: three child layers and one parent layer

Verified configuration: a child uses Primary, Secondary and Tertiary; the parent uses one common Quaternary layer. The parent starts at one plus the largest child layer count, not the sum of counts across children. Children with fewer layers can still share that parent layer.

The child loss percentages adjust each child material layer separately. Primary is divided by its surviving yield; Secondary additionally divides by primary units contained; Tertiary additionally divides by the cumulative primary/secondary unit count. The parent Quaternary material price is adjusted by the parent loss and allocated equally per smallest child unit using the captured Mix quantities. Parent loss is applied once; it is not copied onto each child packaging layer.

For an independently checked example, child A contains 3 primary units per secondary and 2 secondary units per tertiary. Its prices are USD 0.1, 0.6 and 1.2; losses are 1%, 2% and 3%. Child packaging per smallest unit is 0.1/0.99 + 0.6/0.98/3 + 1.2/0.97/6 = 0.511277300673... USD. A Mix containing 6 units of A and 10 of B, with parent packaging USD 2 and 4% parent loss, shares 2/0.96/16 = 0.130208333333... USD per smallest unit. Editing a child loss leaves this shared parent amount unchanged; editing the parent loss leaves child packaging unchanged.

The existing save mapping uses parent-local packaging slots internally. For a one-layer parent this is MixPrimaryPackaging, but its global display must be Quaternary when the longest child has three layers. TCB now labels parent columns using PackagingLayerStart, matching Packaging Response, while preserving saved inputs and calculations.

Validation includes an exact Fraction/independent Decimal cost comparison, browser verification of child three/parent one fields and submitted percentages, and real SQL consecutive save/reopen of parent and child with Direct price 0.1. SQL fixture updates roll back and original rowversions/data are verified restored.

Deploy the matching latest webapp/dist and hard-refresh for corrected cumulative parent labels. No new SQL migration is required beyond 152, and core files are unchanged by the label correction.
