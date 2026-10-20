# Inline business-master creation

A floating, display-only Open views trail shows the active list and nested views (for example Packaging Pricing List > Add new Pricing > Add new Vendor). The trail follows React dialog ancestry across portals; it does not close dialogs, discard drafts or bypass save confirmation. It stays within the protected workspace and disappears with its dialog on Close or Escape.

Related-master creation uses a tinted, icon-only package-plus button, distinct from plain add-row actions. Its tooltip identifies the target master. These controls are available in transactions and applicable business-master editors, including Product Customer/Category, Material Packaging Type/dimension definition, raw Grade/Material, and pricing Vendor/Material. Product Grades supports creating Raw Grades and Raw Materials without discarding its draft tree or ratios.

Target scope and edit permission are checked before launching the existing editor; the server retains all authorization and validation. Admin references such as Market, Currency, User and Role are not exposed. A display-only parent has no master-create buttons. Inline Unit creation is excluded even for Admins; maintain Units through their standalone screen.

Saving a related master writes that master independently, refreshes the invoking editor lookup, and selects the new eligible record only in the invoking batch section. Ineligible types, mismatched dimension definitions and unrelated child grades are not auto-selected. Parent drafts are not saved. Cancelling the parent does not remove an already saved related master. A failed lookup refresh explicitly reports that the master was saved and offers Retry refreshing choices without resubmitting it; parent save is disabled until refresh succeeds. No schema or SQL migration is required.

Opportunity entry uses the same CustomerCreate and Product MasterEditor forms as their master screens. The related-master buttons are shown only with the corresponding master-edit permission; Opportunity access alone does not grant master access.

Creating a Customer refreshes the choices and selects it only when no Customer is selected. An existing Opportunity's locked Customer cannot be changed by creating another Customer. Creating a Product fixes the selected Customer as display-only (including added batch sections), hides Customer creation in that context, and selects the saved Product on the invoking line when the user has not changed that line/customer while choices are refreshing.

When Product Mix is checked, the New Product form includes child selection and unit quantities before the parent is saved. The initial mix status defaults to Active and can be changed to Draft. The parent and initial version save in one transaction through the existing Product Mix procedure; SQL rechecks active same-customer normal children, child row versions, quantities, permissions and weight. A rejected mix rolls back its new parent. Each batch row retains its independent outcome.

New child Product opens a normal-Product creator without closing or saving the parent. Confirming that child saves its master separately, refreshes the parent choices and adds it to the draft mix. Cancelling the parent later does not delete this independently confirmed child. Changing the parent Customer clears draft mix children. Existing Product Mix versions continue to use their separate structure editor.

The unfinished-mix note and Configure icon are no longer displayed in Opportunity. Draft mixes remain ineligible until activated; they can be maintained in Product Master.

Opportunity Customer/Product/Mix lookups read current database data rather than a per-worker TTL cache, so a creation or activation is visible even when the next request reaches a different API worker. Updated mix children are used when selecting the newly activated Product.

The Opportunity draft is not saved or reset. A nested Escape closes only the master drawer. Partial master saves retain failed sections for correction; confirmed saved sections are not resubmitted. If lookup refresh fails after saving a master, reload choices rather than creating it again.

CustomerName and ProductName are the master descriptions. Existing SQL constraints UQ_Customer_Name and UQ_Product_Name enforce global uniqueness, including across different customers for Products. These constraints also prevent concurrent duplicate creation. No new database migration is needed.

Pricing entry uses desktop rows Vendor/Currency, Material/Price UoM, Quantity from/to, Unit price/Exchange rate, and Effective from/to. Empty QuantityTo and EffectiveTo display Unlimited and remain NULL in saved payloads; no numeric or date sentinel is stored.
