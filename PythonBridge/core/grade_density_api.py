"""Shared exact-combination density defaults, never retroactive response edits."""
import json
from decimal import Decimal
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,ConfigDict,Field,model_validator
from auth import AccessContext,get_access_context
from db import get_raw_cursor
from packaging_api import execute,require,rv
from packaging_fields import consume
from grade_density import grade_combination
from shared_master_views import order_by,SharedExport,export_view
from workspace_access import DEFAULTS

router=APIRouter(prefix='/api/grade-densities',tags=['Grade Density Master'])
def access(ctx,edit=False):
    if ctx.is_admin:return
    level=(ctx.permissions or {}).get('grade-densities') if ctx.permissions is not None else max(
        (DEFAULTS.get(s,{}).get('grade-densities','none') for s in ctx.scopes),key=lambda x:{'none':0,'display':1,'edit':2}[x],default='none')
    if level not in (('edit',) if edit else ('display','edit')):raise HTTPException(403,'Grade Density Master access is required.')

def combinations(cur):
    cur.execute("""SELECT ProductGradeSnapshot FROM dbo.PackagingConfigurationRequestItem i
        WHERE ProductGradeSnapshot IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot m WHERE m.ParentItemID=i.OpportunityItemID)""")
    snapshots=[r[0] for r in cur.fetchall()]
    cur.execute("""SELECT v.ID VersionID,g.ParentID,g.ID,g.RawGradeID,g.RawMaterialID,g.Grade,g.RatioPct
        FROM dbo.ProductGradeVersion v JOIN dbo.Product p ON p.ID=v.ProductID
        JOIN dbo.ProductGradeItem g ON g.VersionID=v.ID
        WHERE v.Status='Active' AND p.Status='Active' AND p.IsMix=0 ORDER BY v.ID,g.ParentID,g.ID""")
    names=[c[0] for c in cur.description];versions={}
    for values in cur.fetchall():
        row=dict(zip(names,values));identity=row.pop('VersionID');versions.setdefault(identity,[]).append(row)
    snapshots.extend({'items':rows} for rows in versions.values())
    result={}
    for snapshot in snapshots:
        combination=grade_combination(snapshot)
        if combination:result[combination[0]]=combination[1]
    return result

@router.get('/lookups')
def lookups(ctx:AccessContext=Depends(get_access_context)):
    access(ctx)
    with get_raw_cursor() as cur:
        return {'rows':[dict(CombinationHash=signature,Combination=document) for signature,document in sorted(combinations(cur).items())]}

@router.get('')
def read(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=500),search:str=Query('',max_length=200),
         sort:str=Query('[]',max_length=2000),ctx:AccessContext=Depends(get_access_context)):
    access(ctx)
    sql="""WITH DensityRows AS(SELECT p.ID,p.CombinationJSON Combination,p.NutDensity,p.RowVersion,p.CombinationHash,
        COALESCE(p.UpdatedAt,p.CreatedAt) UpdatedAt,u.UserName UpdatedByName
        FROM dbo.NutGradeDensity p JOIN dbo.Users u ON u.ID=COALESCE(p.UpdatedBy,p.CreatedBy)
        WHERE (?='' OR p.CombinationJSON LIKE ?))
        SELECT * FROM DensityRows ORDER BY """+order_by('grade-densities',sort)+""" OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
        SELECT COUNT(*) Total FROM dbo.NutGradeDensity WHERE (?='' OR CombinationJSON LIKE ?);"""
    sets=execute(sql,[search,'%'+search+'%',(page-1)*page_size,page_size,search,'%'+search+'%'])
    return {'rows':sets[0],'total':sets[1][0]['Total'],'page':page}

@router.post('/export')
def export(body:SharedExport,ctx:AccessContext=Depends(get_access_context)):
    access(ctx)
    return export_view('grade-densities',body)

class DensitySave(BaseModel):
    model_config=ConfigDict(extra='forbid')
    ID:int|None=Field(None,ge=1)
    RowVersion:str|None=None
    CombinationHash:str=Field(pattern='^[0-9a-f]{64}$')
    NutDensity:Decimal=Field(gt=0,max_digits=18,decimal_places=6,allow_inf_nan=False)
    @model_validator(mode='after')
    def version_required(self):
        if bool(self.ID)!=bool(self.RowVersion):raise ValueError('ID and RowVersion must be supplied together.')
        return self

def save_record(cur,body,ctx):
    if not cur.execute('SELECT ID FROM dbo.Users WITH(HOLDLOCK) WHERE ID=? AND UserName=? AND IsActive=1',ctx.user_id,ctx.username).fetchone():
        raise HTTPException(403,'An active authenticated user is required.')
    if body.ID:
        record=cur.execute('SELECT CombinationHash,NutDensity,RowVersion FROM dbo.NutGradeDensity WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',body.ID).fetchone()
        if not record:raise HTTPException(404,'Density default no longer exists.')
        if bytes(record[2])!=rv(body.RowVersion,True):raise HTTPException(409,'Density default changed. Refresh before saving.')
        if record[0]!=body.CombinationHash:raise HTTPException(422,'An existing grade combination cannot be changed. Create another default.')
        old=record[1];identity=body.ID
        if old==body.NutDensity:return {'ID':identity}
        cur.execute('UPDATE dbo.NutGradeDensity SET NutDensity=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?',body.NutDensity,ctx.user_id,identity)
    else:
        document=combinations(cur).get(body.CombinationHash)
        if not document:raise HTTPException(422,'Choose an existing complete grade combination. Refresh the master.')
        if cur.execute('SELECT ID FROM dbo.NutGradeDensity WITH(UPDLOCK,HOLDLOCK) WHERE CombinationHash=?',body.CombinationHash).fetchone():
            raise HTTPException(409,'A default already exists for this combination. Edit that record instead.')
        cur.execute('INSERT dbo.NutGradeDensity(CombinationHash,CombinationJSON,NutDensity,CreatedBy) VALUES(?,?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY()) DensityID',body.CombinationHash,document,body.NutDensity,ctx.user_id)
        identity=consume(cur)[0][0]['DensityID'];old=None
    cur.execute('INSERT dbo.NutGradeDensityHistory(DensityID,OldDensity,NewDensity,ResponseItemID,ChangedBy) VALUES(?,?,?,NULL,?)',identity,old,body.NutDensity,ctx.user_id)
    return {'ID':identity}

@router.post('')
def save(body:DensitySave,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,True)
    try:
        with get_raw_cursor() as cur:
            cur.execute('SET XACT_ABORT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
            try:
                result=save_record(cur,body,ctx);cur.execute('COMMIT');return result
            except Exception:
                cur.execute('IF @@TRANCOUNT>0 ROLLBACK');raise
    except HTTPException:raise
    except Exception as exc:raise HTTPException(409,'Density could not be saved. Refresh and check for a duplicate or changed record.') from exc
