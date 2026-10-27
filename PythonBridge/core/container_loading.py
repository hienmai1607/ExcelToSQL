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


def proposed_types(row):
    """None preserves legacy publication; explicit flags allow an empty selection."""
    profiles=loading_profiles(row.get('ContainerLoadProfiles'))
    if not any(isinstance(p,dict) and 'Proposal' in p for p in profiles.values()):return None
    return [code for code,p in profiles.items() if code in CONTAINER_TYPES and isinstance(p,dict) and p.get('Proposal') is True]


def validate_requested_proposal(profiles,request,size=None):
    if not any(isinstance(p,dict) and 'Proposal' in p for p in profiles.values()):return
    requested=(request,) if request in CONTAINER_TYPES else container_types(request,size)
    if not any(isinstance(profiles.get(code),dict) and profiles[code].get('Proposal') is True for code in requested):
        raise ValueError('Include the requested container type in Proposal.' if request in CONTAINER_TYPES else 'Include at least one container matching the requested family and size in Proposal.')


def validate_saved_proposals(cur,item_ids):
    from fastapi import HTTPException
    rows=cur.execute('''SELECT i.ContainerLoadProfiles,i.ContainerRequest,i.ShipmentContainerSizeFT
      FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
      WHERE oi.ParentItemID IS NULL AND i.ID IN(SELECT value FROM OPENJSON(?))''',json.dumps(list(item_ids))).fetchall()
    for profiles,request,size in rows:
        try:validate_requested_proposal(loading_profiles(profiles),request,size)
        except ValueError as exc:raise HTTPException(422,str(exc)) from exc


def published_options(row):
    """Only explicitly proposed capacities leave Packaging for Opportunity."""
    codes=proposed_types(row)
    if codes is None:return dict(row)
    result={**row,'ProposedContainerTypes':codes,'ContainerLoadProfiles':{k:v for k,v in loading_profiles(row.get('ContainerLoadProfiles')).items() if k in codes}}
    from response_load_plan import read_plan
    selected=read_plan(row)
    if selected and selected.get('Code') not in codes:result['LoadPlanJSON']=None
    plans=row.get('ContainerPlansJSON') or []
    try:plans=json.loads(plans) if isinstance(plans,str) else plans
    except ValueError:plans=[]
    if isinstance(plans,dict):plans=list(plans.values())
    result['ContainerPlansJSON']=[p for p in plans if isinstance(p,dict) and p.get('Code') in codes]
    if row.get('SelectedContainerType') not in codes:
        for key in ('LoadPlanJSON','CartonsPerContainer','CartonsPerContainerFloor','PalletsPerContainer'):result[key]=None
    return result


def container_results(row):
    from packing_way import packing_way
    result = {
        kind: {key: value for key, value in packing_way({**row, **profile, "LoadPlanJSON":None, "SelectedContainerType": kind}).items()
               if key in ("LayersPerContainer", "CalculatedCartonsPerContainer", "NetWeightPerContainerKG", "NetWeightPerContainerFloorKG", "GrossWeightPerContainerKG")}
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
