# Packaging

## NPD language

**Ingredient**:
A seasoning input with an origin and a base unit of measure. Raw grades remain separate from ingredients.

**Recipe Request**:
A request to develop recipes for captured Opportunity items, with a due date and an assigned NPD person for each item.

**Recipe Sheet**:
A revision of one requested product recipe. Its fixed raw-grade identities come from the captured Level 1 Product Grades; NPD chooses their ratios and adds seasoning ingredients.

**Seasoning price**:
The loss-adjusted price per pound of the seasoning portion alone. The seasoning ratio describes its share of the finished recipe.

**Recipe Component**:
A named addition to the raw-material share, such as Salt, Oil or Seasoning. Process Types define which components are involved; each applicable component has a price per pound and a finished-recipe ratio.

**Recipe confirmation**:
The Product Grade or Opportunity snapshot setting that requires an approved NPD recipe. Its linked request captures and locks the grades and Recipe requirements.

**Seasoning process loss**:
The process yield loss whose default comes from the approved Sheet header. It is separate from ingredient-line loss, which increases ingredient cost only.

**Price Ready**:
A recipe whose ratios and seasoning prices are complete enough for commercial costing. Manager approval is separate from recipe status.

**Final recipe**:
A completed recipe revision. A manager-approved Price Ready or Final revision can supply seasoning values to TCB.

**Ingredient tier quantity**:
The ingredient quantity required for the estimated awarded product volume, measured in the ingredient's base unit. Ingredient loss affects price rather than this quantity or the finished recipe ratios.

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
