"""Supplier dimensions describe ONE vendor price unit, separately from parent consumption."""
from decimal import Decimal
from dimension_formula import conversion_formula, formula_variables

SUPPLIER_FIELDS = {
    "SupplierDimensionID": "Supplier dimension ID",
    "SupplierD1": "Supplier D1", "SupplierD2": "Supplier D2", "SupplierD3": "Supplier D3",
}


def supplier_area(dimension, measurements):
    if not dimension or dimension.get("FormulaNeedsReview") or dimension.get("ParentFormulaNeedsReview"):
        raise ValueError("Choose a reviewed child supplier dimension definition.")
    formula = (dimension.get("ConvertFromSupplierFormula") if "ConvertFromSupplierFormula" in dimension
               else dimension.get("EffectiveSquareMeterFormula") or dimension.get("SquareMeterFormula"))
    if not formula:
        raise ValueError("Maintain the child Convert from supplier formula.")
    variables = formula_variables(formula, allow_constant=True)
    for key in ("D1", "D2", "D3"):
        value = measurements.get(key)
        if value is not None and (not dimension.get(key+"Name") or Decimal(value) <= 0):
            raise ValueError("Supplier "+key+" must be positive and defined on the child type.")
        if key in variables and value is None:
            raise ValueError("Enter supplier "+key+" for one Price UoM.")
        if dimension.get(key+"Name") and dimension.get(key+"UnitStatus", "Active") != "Active":
            raise ValueError("Supplier dimensions require active units.")
    return conversion_formula(formula, {k: Decimal(measurements[k]) for k in variables})
