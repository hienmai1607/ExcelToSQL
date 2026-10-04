"""Container families and read-only totals for independent loading profiles."""
import json

CONTAINER_TYPES = ("20DC", "40DC", "40HC", "20RC", "40RHC")


def container_types(family):
    return CONTAINER_TYPES[:3] if family == "Dry" else CONTAINER_TYPES[3:] if family == "Reefer" else CONTAINER_TYPES


def loading_profiles(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def container_results(row):
    from packing_way import packing_way
    return {
        kind: {key: value for key, value in packing_way({**row, **profile, "SelectedContainerType": kind}).items()
               if key in ("LayersPerContainer", "CalculatedCartonsPerContainer", "NetWeightPerContainerKG", "NetWeightPerContainerFloorKG")}
        for kind, profile in loading_profiles(row.get("ContainerLoadProfiles")).items()
        if kind in CONTAINER_TYPES and isinstance(profile, dict)
    }
