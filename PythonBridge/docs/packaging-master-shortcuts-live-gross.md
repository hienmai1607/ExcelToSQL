# Packaging master shortcuts and live Mix gross weight

The Pallet selector has a compact Add new Pallet button. New materials start with the Pallet packaging type selected. The Pallet Pricing Calculator has material edit buttons and a Max payload (kg) column. Editing a material refreshes the catalog and parent pallet choices and invalidates the calculator result so the user must recalculate. Saved pricing snapshots remain unchanged.

The Container type selector uses the shared master button: blank selection creates a container; a selection edits it. Both shortcuts and the standalone Container Type Master use the same editor, save endpoint, permissions, row-version check and confirmation. Container maintenance remains Admin-only. Saving a master does not save the packaging request.

Mix Same config previously copied pricing inputs without copying packaging tare. Item-specific pricing fingerprints are intentionally cleared for copied children, so their live preview could not use the source result and retained old or missing tare until Save revalidated pricing. Synchronization now copies the source's saved or currently matched packaging tare for the live preview. Save still revalidates each target's pricing separately. Parent previews also derive children from the loaded family when the saved child projection is absent.

Regression coverage checks gross weights before Save, after enabling Same config and after Copy reference, along with Container create/edit, Pallet create/edit, payload display and grouped save behavior.

No SQL migration or API change is required. Deploy the rebuilt frontend and hard-refresh the browser.
