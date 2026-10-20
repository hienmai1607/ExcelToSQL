# Packaging

Packaging parents are assembled from child components. Shipping space and component consumption are separate quantities.

## Language

**Occupied m²**:
The footprint of one Shipping parent unit, in square metres. It is not the cut area of its materials.

**Occupied m³**:
The external occupied volume of one Shipping parent unit, in cubic metres.

**Convert from parent**:
The material quantity required for one child occurrence, evaluated using the parent measurements. Child multiplicity is separate.

**Material yield** (stored as ConvertFromSupplierFormula):
The usable quantity supplied per one material Base UoM, evaluated using material measurements. Its output unit matches Convert from parent. Pricing converts the vendor Price UoM to the material Base UoM separately.

**Component material dimensions**:
The component material's own named dimensions and units. They are independent of the parent dimensions used for consumption.

**Child quantity (N)**:
The number of occurrences of a child component in one parent packaging unit.

**Price UoM**:
The vendor unit to which a quoted unit price applies. When different from the material Base UoM, an explicit unit conversion is required; it does not define another physical geometry.

**Container family**:
The requested transport category: Dry, Reefer or Both.

**Container type**:
The specific transport container: 20DC, 40DC or 40HC for Dry; 20RC or 40RHC for Reefer.

**Container loading profile**:
The pallet-load and floor-load quantities for one container type. Choosing another type does not replace this profile.

**Material dimensions**:
The named physical measurements of one Packaging Material. Vendor prices refer to that material rather than defining separate supplier measurements.

**Palletization**:
The packaging category for a pallet and the accessories consumed with it.

**Pallet**:
The Packaging Type for the load-bearing base selected for palletization. Other Palletization types are accessories.

**Unprocessed record**:
A record with no completed workflow or processing activity and no other business records depending on it.

**Import clearance per container**:
The total clearance charge for one container, expressed in the customer's currency.

**Grade density default**:
The reusable density in grams per millilitre for an exact nut and grade combination, including its proportions. Different proportions form different combinations.
