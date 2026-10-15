"""Container families and read-only totals for independent loading profiles."""
import json

CONTAINER_TYPES = ("20DC", "40DC", "40HC", "20RC", "40RHC")


def container_types(family, size=None):
    types = (family,) if family in CONTAINER_TYPES else CONTAINER_TYPES[:3] if family == "Dry" else CONTAINER_TYPES[3:] if family == "Reefer" else CONTAINER_TYPES
    return tuple(kind for kind in types if size not in ("20FT", "40FT") or kind.startswith(size[:2]))


def loading_profiles(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def container_results(row):
    from packing_way import packing_way
    result = {
        kind: {key: value for key, value in packing_way({**row, **profile, "LoadPlanJSON":None, "SelectedContainerType": kind}).items()
               if key in ("LayersPerContainer", "CalculatedCartonsPerContainer", "NetWeightPerContainerKG", "NetWeightPerContainerFloorKG")}
        for kind, profile in loading_profiles(row.get("ContainerLoadProfiles")).items()
        if kind in CONTAINER_TYPES and isinstance(profile, dict)
    }

    from response_load_plan import read_plan
    selected=read_plan(row)
    if selected:
        result[selected.get("Code") or "Load plan"]={key:value for key,value in packing_way(row).items() if key in ("CalculatedCartonsPerContainer","NetWeightPerContainerKG")}
    try:plans=json.loads(row.get('ContainerPlansJSON') or '[]') if isinstance(row.get('ContainerPlansJSON'),str) else row.get('ContainerPlansJSON') or []
    except ValueError:plans=[]
    if isinstance(plans,list):
        for plan in plans:
            if plan.get('Code'):
                result[plan['Code']]={key:value for key,value in packing_way({**row,'LoadPlanJSON':plan}).items() if key in ('CalculatedCartonsPerContainer','NetWeightPerContainerKG','GrossWeightPerContainerKG')}
    return result
