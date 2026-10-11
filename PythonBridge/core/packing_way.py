"""Derived Packing Way values from the request's immutable product weight snapshot."""
from decimal import Decimal, InvalidOperation, localcontext

INT_MAX = 2147483647


def pallet_layers(row):
    """Retain historical counts until geometry is supplied; never guess layer height."""
    height = row.get("HeightMM")
    if height in (None, ""):
        return row.get("LayersPerPallet")
    try:
        height, maximum = Decimal(str(height)), Decimal(str(row.get("ResponseMaxPalletHeightMM")))
        if not height.is_finite() or not maximum.is_finite() or height <= 0 or maximum <= 0:
            return None
        with localcontext() as ctx:
            ctx.prec = 50
            count = int(max(Decimal(0), maximum - 150) // height)
        return count if count <= INT_MAX else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def container_layers(row):
    """Whole shipping layers that fit vertically; typed profiles never use manual counts."""
    if not row.get("SelectedContainerType"):
        # Keep unassigned historical counts until a container is explicitly chosen.
        try:
            value = Decimal(str(row.get("LayersPerContainer")))
            return int(value) if value.is_finite() and value == value.to_integral_value() and 1 <= value <= INT_MAX else None
        except (InvalidOperation, ValueError, TypeError):
            return None
    try:
        height = Decimal(str(row.get("HeightMM")))
        if not height.is_finite() or height <= 0:
            return None
        with localcontext() as ctx:
            ctx.prec = 100
            count = int(Decimal(2070 if row["SelectedContainerType"] == "20RC" else 2090) // height)
            return count if count <= INT_MAX else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def packing_way(row):
    from container_loading import loading_profiles
    profile = loading_profiles(row.get("ContainerLoadProfiles")).get(row.get("SelectedContainerType"))
    if isinstance(profile, dict):
        row = {**row, **profile, "CartonsPerContainer":profile.get("CartonsPerContainer",profile.get("CartonsPerContainerFloor")), "CartonsPerContainerFloor":profile.get("CartonsPerContainer",profile.get("CartonsPerContainerFloor"))}
    layers = row.get("ResponseLayerCount") or row.get("RequestedLayerCount") or 2
    if layers not in (1, 2, 3):
        raise ValueError("Packaging layers must be 1, 2 or 3.")

    def units(key):
        value = row.get(key)
        try:
            n = Decimal(str(value))
            return int(n) if n.is_finite() and n == n.to_integral_value() and 1 <= n <= INT_MAX else None
        except (InvalidOperation, ValueError, TypeError):
            return None

    primary = 1 if layers == 1 else units("UnitsPerCarton")
    secondary = (1 if layers == 2 else units("UnitsPerTertiary")) if layers >= 2 else None
    tertiary = 1 if layers == 3 else None
    if row.get("IsMixParent"):
        from mix_efficiency import mix_totals
        row={**row,"ApplicableNetWeightGrams":mix_totals(row.get("ProductMixSnapshot"),row.get("MixResponseChildren"))["weight"]}
    try:
        weight = Decimal(str(row.get("ApplicableNetWeightGrams") if row.get("ApplicableNetWeightGrams") is not None or row.get("IsMixParent") else row.get("WeightGrams")))
        if not weight.is_finite() or weight < 0:
            weight = None
    except (InvalidOperation, ValueError, TypeError):
        weight = None

    configuration = str(row.get("ConfigurationRequest") or "").strip()
    pallet_load, floor_load = configuration not in ("Floor load", "Both"), configuration in ("Floor load", "Both")
    # SQL snapshot weights and five INT factors fit comfortably within this precision.
    with localcontext() as ctx:
        ctx.prec = 100
        second_weight = weight * primary if layers >= 2 and weight is not None and primary is not None else None
        third_weight = second_weight * secondary if layers == 3 and second_weight is not None and secondary is not None else None
        last_weight = (weight, second_weight, third_weight)[layers - 1]
        cartons, pallet_layer_count = units("CartonsPerLayer"), pallet_layers(row)
        try:
            n = Decimal(str(pallet_layer_count))
            pallet_layer_count = int(n) if n.is_finite() and n == n.to_integral_value() and 0 <= n <= INT_MAX else None
        except (InvalidOperation, ValueError, TypeError):
            pallet_layer_count = None
        last_units = 1 if layers == 1 else primary if layers == 2 else primary * secondary if primary is not None and secondary is not None else None
        pallet_units = last_units * cartons * pallet_layer_count if last_units is not None and cartons is not None and pallet_layer_count is not None else None
        pallet_weight = last_weight * cartons * pallet_layer_count if last_weight is not None and cartons is not None and pallet_layer_count is not None else None
        container_layer_count, pallets, floor_cartons = container_layers(row), units("PalletsPerContainer"), units("CartonsPerContainerFloor")
        if row.get("SelectedContainerType") and row.get("PalletsPerContainer") in (0, "0"):
            pallets = 0
        container_cartons = pallets * cartons * pallet_layer_count * (2 if row.get("ResponsePalletStacking")=="Double" else 1) if pallet_load and pallets is not None and cartons is not None and pallet_layer_count is not None else (floor_cartons or units("CartonsPerContainer")) if floor_load else None
        container_weight = last_weight * container_cartons if last_weight is not None and container_cartons is not None else None
        floor_weight = last_weight * floor_cartons if floor_load and last_weight is not None and floor_cartons is not None else None
        return dict(ApplicableNetWeightGrams=format(weight,"f") if weight is not None else None,NoOfPrimaryUnit=primary, NoOfSecondaryUnit=secondary, NoOfTertiaryUnit=tertiary,
                    LayersPerContainer=container_layer_count if pallet_load else None,
                    LayersPerPallet=pallet_layer_count,
                    UnitsPerPallet=str(pallet_units) if pallet_units is not None else None,
                    PrimaryNetWeightGrams=format(weight, "f") if weight is not None else None,
                    SecondaryNetWeightGrams=format(second_weight, "f") if second_weight is not None else None,
                    TertiaryNetWeightGrams=format(third_weight, "f") if third_weight is not None else None,
                    NetWeightPerPalletGrams=format(pallet_weight, "f") if pallet_weight is not None else None,
                    NetWeightPerPalletKG=format(pallet_weight / 1000, "f") if pallet_weight is not None else None,
                    CalculatedCartonsPerContainer=str(container_cartons) if container_cartons is not None else None,
                    NetWeightPerContainerKG=format(container_weight / 1000, "f") if container_weight is not None else None,
                    NetWeightPerContainerFloorKG=format(floor_weight / 1000, "f") if floor_weight is not None else None)
