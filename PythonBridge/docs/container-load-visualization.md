# Complete container-load visualization

Floor previews represent the entire selected carton count. They no longer show only the first 2,500 cartons.

- The back wall is x=0 and doors are at x=container length. Cartons fill cross-container depth rows from back to doors, with supported layers in each row.
- The target detailed section is the back third of container length. The split aligns to the nearest complete carton-row boundary, without cutting a carton. Small/partial loads may fit wholly within that section; interlocking layouts without an interior seam may require a larger detailed section. The actual length percentage is displayed.
- Detailed rows use grid-lined surfaces with exact carton subdivisions, avoiding separate objects for invisible internal carton faces. Grid lines closer than a few pixels simplify with zoom; carton totals never change.
- The remaining load uses one differently coloured block. Full regular rows have an exact rectangular block. Irregular layouts and partial final rows use an enclosing envelope, explicitly labelled so gaps are not mistaken for additional cartons.
- Notes identify the loading direction, rows, cartons per row per layer, number of layers, detailed count, grouped count and total. Canvas labels identify both sections and the doors.

For 4,800 upright 150 × 150 × 500 mm cartons in the maintained 40DC, the detailed section contains 27 × 15 × 4 = 1,620 cartons. The remaining block represents 53 × 15 × 4 = 3,180 cartons. The split is at 4,050 mm (33.7% of container length).

This is a rendering change, not a capacity/orientation/costing change. The 4,800-carton proposal remains unchanged. Container dimensions are displayed in named Length × Width × Height order. No SQL migration is added; hard-refresh the rebuilt UI. Existing backend/schema requirements remain through 147.
