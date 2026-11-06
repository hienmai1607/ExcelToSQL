"""Allow-listed Recipe Request list preferences and sort rules."""
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from master_models import MasterLayout

HEADERS={'RequestNumber','ItemCount','OpportunityNumber','CustomerName','RequestDue','Status','Unassigned','AssignedToMe','RequestedByName','RequestedAt'}
ITEMS={'Review','ProductCode','ProductName','AnnualUnit','WeightGrams','EstimatedAwardedMT','LaunchingDate','SpecialComments','Sheet','Status','PIC'}
FILTERS={'header':{'search','status','created_by','assigned_to'},'items':{'search','pic','status'}}

class RecipeRequestViews(BaseModel):
    model_config=ConfigDict(extra='forbid')
    header:MasterLayout|None=None
    items:MasterLayout|None=None

    @field_validator('header','items')
    @classmethod
    def valid(cls,v,info):
        if v is None:return v
        allowed=HEADERS if info.field_name=='header' else ITEMS
        required={'RequestNumber','ItemCount'} if info.field_name=='header' else {'Review','ProductCode'}
        for keys in (v.columns,[r.column for r in v.sort]):
            if len(keys)!=len(set(keys)) or any(k not in allowed for k in keys):raise ValueError('Invalid or duplicate Recipe Request column.')
        if not required.issubset(v.columns):raise ValueError('Required Recipe Request columns are missing.')
        if any(k not in allowed for k in v.column_widths):raise ValueError('Invalid Recipe Request column width.')
        if len(v.filters)!=len(set(v.filters)) or any(k not in FILTERS[info.field_name] for k in [*v.filters,*v.values]):raise ValueError('Invalid Recipe Request filter.')
        if any(len(s)>200 for s in v.values.values()):raise ValueError('Filter too long.')
        statuses=('', 'Open','Completed','Closed') if info.field_name=='header' else ('','Open','Assigned','Submitted','Approved','Returned','Closed')
        if v.values.get('status','') not in statuses:raise ValueError('Invalid Recipe Request status.')
        return v

def request_order(raw):
    from master_models import MasterSort
    try:
        data=json.loads(raw)
        if not isinstance(data,list) or len(data)>len(HEADERS):raise ValueError()
        rules=[MasterSort.model_validate(r) for r in data]
        if len({r.column for r in rules})!=len(rules) or any(r.column not in HEADERS for r in rules):raise ValueError()
    except (ValueError,TypeError):raise HTTPException(422,'Invalid Recipe Request sort.')
    return ', '.join('['+r.column+'] '+r.direction.upper() for r in rules)+(', ' if rules else '')+'ID DESC'
