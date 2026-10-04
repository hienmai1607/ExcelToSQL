"""Read-only response efficiency from captured parent geometry and pallet master area."""
import json
from decimal import Decimal, InvalidOperation, localcontext
from dimension_formula import area_formula, volume_formula, formula_variables

ORDERS = ("Primary", "Secondary", "Tertiary")
TYPE_FIELDS = ("FirstPMType", "SecondPMType", "ThirdPMType")
EFFICIENCY_FIELDS = {
    "PalletHeightMM", "CartonEfficiencyKGM3", "RelativeCartonEfficiencyPct",
    "PalletUtilizationPct", "PalletHeightEfficiencyPct",
}


def decimal_value(value, zero=False):
    try:
        number = Decimal(str(value))
        return number if number.is_finite() and (number >= 0 if zero else number > 0) else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def geometry_metrics(definition, measurements):
    """Parent formulas output m2/m3; child material area is not carton footprint."""
    result = {"AreaM2": None, "VolumeM3": None}
    if not definition or definition.get("FormulaNeedsReview") or definition.get("OccupiedFormulaNeedsReview"):
        return result
    modern = "OccupiedM2Formula" in definition
    if modern and (definition.get("ParentDimensionID") is not None or not definition.get("Shipping")):
        return result
    for key, formula_key, evaluate in (
        ("AreaM2", "OccupiedM2Formula" if modern else "SquareMeterFormula", area_formula),
        ("VolumeM3", "OccupiedM3Formula" if modern else "VolumeFormula", volume_formula),
    ):
        formula = definition.get(formula_key)
        if not formula:
            continue
        try:
            variables = formula_variables(formula)
            values = {k: decimal_value(measurements.get(k)) for k in variables}
            if all(v is not None for v in values.values()):
                result[key] = evaluate(formula, values)
        except (ValueError, InvalidOperation):
            pass  # Missing/unreviewed efficiency geometry must not block Count pricing.
    return result


def saved_geometry(row, snapshot):
    layers = row.get("ResponseLayerCount") or row.get("RequestedLayerCount") or 2
    empty = {"AreaM2": None, "VolumeM3": None}
    try:
        data = json.loads(snapshot) if isinstance(snapshot, str) else snapshot
        if not isinstance(data, dict) or layers not in (1, 2, 3):
            return empty
        captured_layers = data.get("Context", {}).get("Request", {}).get("ConfirmedLayerCount")
        if (data.get("PackagingOrder") != ORDERS[layers-1]
                or data.get("PackagingTypeName") != row.get(TYPE_FIELDS[layers-1])
                or captured_layers != layers):
            return empty
        return geometry_metrics(data.get("ParentDimension"), data.get("ParentMeasurements") or {})
    except (ValueError, TypeError, AttributeError):
        return empty


def captured_layer_dimensions(row, snapshots):
    """Only publish parent measurements from matching, immutable pricing snapshots."""
    layers = row.get("ResponseLayerCount") or row.get("RequestedLayerCount") or 2
    captures = {}
    for index, order in enumerate(ORDERS):
        try:
            data = snapshots.get(order)
            data = json.loads(data) if isinstance(data, str) else data
            if (not isinstance(data, dict) or index >= layers
                    or data.get("PackagingOrder") != order
                    or data.get("PackagingTypeName") != row.get(TYPE_FIELDS[index])
                    or data.get("Context", {}).get("Request", {}).get("ConfirmedLayerCount") != layers):
                continue
            definition = data.get("ParentDimension") or {}
            measurements = data.get("ParentMeasurements") or {}
            dimensions = []
            for key in ("D1", "D2", "D3"):
                value = decimal_value(measurements.get(key))
                if definition.get(key+"Name") and definition.get(key+"Unit") and value is not None:
                    dimensions.append(dict(Name=definition[key+"Name"], Unit=definition[key+"Unit"],
                        Value=format(value, "f")))
            if dimensions:
                captures[order] = dict(PackagingTypeName=data["PackagingTypeName"], LayerCount=layers,
                    Dimensions=dimensions)
        except (ValueError, TypeError, AttributeError):
            continue  # Legacy or incomplete snapshots have no captured parent measurements.
    return captures


def response_efficiency(row, packing, geometry, pallet_area_mm2):
    values = {key: None for key in EFFICIENCY_FIELDS}
    layers = row.get("ResponseLayerCount") or row.get("RequestedLayerCount") or 2
    last = decimal_value(packing.get(
        ("PrimaryNetWeightGrams", "SecondaryNetWeightGrams", "TertiaryNetWeightGrams")[layers-1]), zero=True)
    volume = decimal_value(geometry.get("VolumeM3"))
    area = decimal_value(geometry.get("AreaM2"))
    density = decimal_value(row.get("NutDensity"))
    cartons = decimal_value(row.get("CartonsPerLayer"))
    if cartons is not None and (cartons != cartons.to_integral_value() or cartons > 2147483647):
        cartons = None
    pallet_area = decimal_value(pallet_area_mm2)
    height = decimal_value(row.get("HeightMM"))
    count = decimal_value(packing.get("LayersPerPallet"), zero=True)
    if count is not None and (count != count.to_integral_value() or count > 2147483647):
        count = None
    maximum = decimal_value(row.get("ResponseMaxPalletHeightMM"))
    with localcontext() as context:
        context.prec = 100
        if height is not None and count is not None:
            values["PalletHeightMM"] = Decimal(150) + count * height
        if last is not None and volume is not None:
            values["CartonEfficiencyKGM3"] = last / 1000 / volume
            if density is not None:
                values["RelativeCartonEfficiencyPct"] = values["CartonEfficiencyKGM3"] / density / 1000 * 100
        if area is not None and cartons is not None and pallet_area is not None:
            values["PalletUtilizationPct"] = area * cartons / (pallet_area / 1000000) * 100
        if values["PalletHeightMM"] is not None and maximum is not None:
            values["PalletHeightEfficiencyPct"] = values["PalletHeightMM"] / maximum * 100
    return {key: format(value, "f") if value is not None else None for key, value in values.items()}


def response_derived(row, packing):
    """Consume internal SELECT aliases; never expose raw draft pricing JSON."""
    snapshot = row.pop("FinalLayerPricingSnapshot", None)
    captures = captured_layer_dimensions(row, {
        order: row.pop(order+"LayerPricingSnapshot", None) for order in ORDERS})
    pallet_area = row.pop("EfficiencyPalletAreaMM2", None)
    geometry = saved_geometry(row, snapshot)
    values = response_efficiency(row, packing, geometry, pallet_area)
    layers = row.get("ResponseLayerCount") or row.get("RequestedLayerCount") or 2
    return {**values, "LayerDimensionCaptures": captures,
        "FinalLayerAreaM2": format(geometry["AreaM2"], "f") if geometry["AreaM2"] is not None else None,
        "FinalLayerVolumeM3": format(geometry["VolumeM3"], "f") if geometry["VolumeM3"] is not None else None,
        "EfficiencyLayerCount": layers, "EfficiencyTypeName": row.get(TYPE_FIELDS[layers-1]),
        "ResponsePalletAreaMM2": pallet_area}
