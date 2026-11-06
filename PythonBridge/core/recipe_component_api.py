from uuid import uuid4
from typing import Literal,Annotated
from fastapi import APIRouter,Depends,Query,HTTPException
from pydantic import BaseModel,Field,ConfigDict
from auth import AccessContext,get_access_context
from db import get_raw_cursor
from workspace_access import require_page_edit
from npd_api import query,one,transaction,expected,audit
from shared_master_views import order_by,SharedExport,export_view

router=APIRouter(prefix='/api/recipe-components',tags=['Recipe Components'])
class ComponentSave(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    ID:int|None=Field(None,ge=1)
    RowVersion:str|None=None
    ComponentName:str=Field(min_length=1,max_length=100)
    Status:Literal['Active','Block']='Active'

@router.get('')
def read(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=500),search:str=Query('',max_length=200),status:Literal['','Active','Block']='',sort:str='[]',ctx:AccessContext=Depends(get_access_context)):
    with get_raw_cursor() as cur:
        where=" WHERE ComponentName LIKE ? AND (?='' OR Status=?)";params=[search+'%',status,status]
        return dict(rows=query(cur,'SELECT * FROM dbo.RecipeComponent'+where+' ORDER BY '+order_by('recipe-components',sort)+' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',*params,(page-1)*page_size,page_size),total=cur.execute('SELECT COUNT(*) FROM dbo.RecipeComponent'+where,*params).fetchval(),page=page)

@router.post('/export')
def export(body:SharedExport,ctx:AccessContext=Depends(get_access_context)):return export_view('recipe-components',body)

@router.post('')
def save(body:ComponentSave,ctx:AccessContext=Depends(get_access_context)):
    require_page_edit(ctx,'recipe-components')
    with transaction(ctx) as cur:
        if body.ID:
            old=one(cur,'SELECT * FROM dbo.RecipeComponent WHERE ID=?',body.ID);expected(old,body.RowVersion)
            cur.execute('UPDATE dbo.RecipeComponent SET ComponentName=?,Status=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?',body.ComponentName,body.Status,body.ID);identity=body.ID
        else:identity=cur.execute('INSERT dbo.RecipeComponent(ComponentName,SystemKey,Status,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?,?)',body.ComponentName,'Custom_'+uuid4().hex[:20],body.Status,ctx.username).fetchval()
        row=one(cur,'SELECT * FROM dbo.RecipeComponent WHERE ID=?',identity);audit(cur,'RecipeComponent',identity,'Save',row,ctx);return {'row':row}
