# Flexible load packing
The shared footprint solver is used for cartons on pallets, pallets in containers,
and floor-loaded cartons. It searches straight strips, four interlocking blocks,
then a bounded normal-coordinate search for small cases. Returned coordinates,
not an independent count estimate, determine quantities and the 3D placement.

Dimensions are integer micrometres. Rotation is 0/90 degrees in the horizontal
plane only. No overhang, tilting, arbitrary angles, or mixed carton sizes are
assumed. Saved cartons per layer remain authoritative: a response of 18 is not
silently increased to 20. Height, payload, door and stackability checks remain.

## Bounds and claims
The area bound is tightened by conservative one-dimensional scaling. For positive
integer mapped side lengths a,b, enumerate all combinations n*l+m*w <= axis size.
The maximum n*a+m*b is the transformed axis capacity. Non-overlap constraints can
be represented by horizontal or vertical precedence paths; each path uses such
a combination. Thus transformed rectangles a*b fit inside the transformed axis
capacities, giving a valid upper bound floor(capacityX*capacityY/(a*b)).
A footprint is a verified maximum only when a feasible layout reaches this bound.
This does not prove unrestricted 3D optimality. Search limits produce best-found
layouts, never an unsupported infeasibility or optimality claim. No-rotation
layouts have the exact regular-grid bound.

For PCR-33162, 296x195 mm cartons on 1118x1118 mm pallets:
the solver finds 20 non-overlapping cartons. With a=3,b=2 each axis capacity is
11, so floor(121/6)=20 proves the maximum. Five 147 mm layers plus a 150 mm pallet
give 100 cartons and 885 mm loaded height. Response quantities are not rewritten.

Existing saved plans retain their historical algorithm and coordinates. New
previews/saves identify mixed-blocks-v2 and expose separate pallet/container
footprint capacity, upper bound and proof flags. No schema migration is needed.
