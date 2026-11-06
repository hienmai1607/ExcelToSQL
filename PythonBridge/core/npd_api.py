"""NPD masters and captured request/sheet workflow. Approval publishes atomically."""
import base64
import json
from contextlib import contextmanager
from datetime import date,datetime,timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,ConfigDict,Field,model_validator
from auth import AccessContext,get_access_context
from db import get_raw_cursor,bytes_to_b64
from packaging_api import rv
from npd_recipes import RecipeLine,awarded_mt,document,evaluate,obj,quote_key,raw_grades,seasoning_inputs

router=APIRouter(prefix='/api/npd',tags=['NPD'])
SCOPES={'NPD','NPDManager','Opportunity'}

def allowed(ctx,page,edit=False):
    if ctx.is_admin:return True
    if ctx.permissions is not None:return ctx.permissions.get(page) in (('edit',) if edit else ('display','edit'))
    if page=='recipe-requests':return 'NPDManager' in ctx.scopes if edit else bool(ctx.scopes&SCOPES)
    return bool(ctx.scopes&{'NPD','NPDManager'})

def access(ctx,page,edit=False):
    if not allowed(ctx,page,edit):raise HTTPException(403,'NPD '+('edit' if edit else 'display')+' access is required.')

def manager(ctx):
    access(ctx,'recipe-requests',True)
    if not ctx.is_admin and not ctx.scopes&{'NPD','NPDManager'}:raise HTTPException(403,'NPD manager access is required.')

def serial(value):
    if isinstance(value,(bytes,bytearray)):return bytes_to_b64(value)
    if isinstance(value,(date,datetime)):return value.isoformat()
    if isinstance(value,Decimal):return str(value)
    return value

def query(cur,sql,*params):
    cur.execute(sql,*params)
    names=[c[0] for c in cur.description]
    return [{name:serial(value) for name,value in zip(names,row)} for row in cur.fetchall()]

def one(cur,sql,*params):
    rows=query(cur,sql,*params)
    if not rows:raise HTTPException(404,'NPD record was not found. Refresh the list.')
    return rows[0]

def ready(cur):
    if not cur.execute("SELECT COL_LENGTH('dbo.NPDIngredient','GradeNature')").fetchval():
        raise HTTPException(503,'Install NPD SQL migrations 154 through 157 before using this section.')

@contextmanager
def transaction(ctx):
    with get_raw_cursor() as cur:
        ready(cur)
        try:
            cur.execute("""SET XACT_ABORT ON; BEGIN TRANSACTION;
             DECLARE @Result INT; EXEC @Result=sys.sp_getapplock @Resource=N'NPDWorkspace',
             @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
             IF @Result<0 THROW 53054,'NPD is busy. Retry after refreshing.',1;""")
            if not cur.execute('SELECT ID FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE ID=? AND UserName=? AND IsActive=1',ctx.user_id,ctx.username).fetchone():
                raise HTTPException(403,'An active user is required.')
            yield cur
            cur.execute('COMMIT TRANSACTION')
        except Exception as exc:
            cur.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION')
            if isinstance(exc,HTTPException):raise
            if isinstance(exc,ValueError):raise HTTPException(422,str(exc)) from exc
            if any(code in str(exc) for code in ('2601','2627','1205','53054')):raise HTTPException(409,'NPD record changed, already exists, or is busy. Refresh and retry.') from exc
            if '547' in str(exc):raise HTTPException(422,'A selected master or linked record is invalid.') from exc
            raise

def audit(cur,entity,identity,action,value,ctx):
    cur.execute('INSERT dbo.NPDAudit(Entity,RecordID,Action,SnapshotJSON,ActorID) VALUES(?,?,?,?,?)',entity,identity,action,document(value),ctx.user_id)

def expected(row,version):
    if not version or row['RowVersion']!=version:raise HTTPException(409,'This record changed. Refresh before saving.')

class MasterRecord(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    ID:int|None=Field(None,ge=1)
    RowVersion:str|None=None
    Status:Literal['Active','Block']='Active'

class Ingredient(MasterRecord):
    Description:str=Field(min_length=1,max_length=300)
    Origin:str=Field('',max_length=150)
    GradeNature:str|None=Field(None,max_length=150)
    BaseUoMID:int=Field(ge=1)

class Price(MasterRecord):
    IngredientID:int=Field(ge=1)
    VendorID:int=Field(ge=1)
    CurrencyID:int=Field(ge=1)
    UnitPrice:Decimal=Field(ge=0,max_digits=19,decimal_places=6)
    PriceUoMID:int=Field(ge=1)
    QuantityFrom:Decimal=Field(0,ge=0,max_digits=19,decimal_places=6)
    QuantityTo:Decimal|None=Field(None,gt=0,max_digits=19,decimal_places=6)
    EffectiveFrom:date
    EffectiveTo:date|None=None
    ExchangeRateToUSD:Decimal|None=Field(None,gt=0,max_digits=19,decimal_places=9)
    @model_validator(mode='after')
    def ranges(self):
        if self.QuantityTo is not None and self.QuantityTo<=self.QuantityFrom:raise ValueError('Quantity to is exclusive and must exceed quantity from.')
        if self.EffectiveTo and self.EffectiveTo<self.EffectiveFrom:raise ValueError('Effective to must not precede effective from.')
        return self

def mass(cur,identity):
    row=one(cur,"SELECT * FROM dbo.UoM WHERE ID=? AND Status='Active'",identity)
    if row['Category']!='Weight/Mass' or not row['BaseFactor'] or Decimal(row['BaseFactor'])<=0:
        raise ValueError('Recipe ingredients and prices require a maintained weight/mass unit.')
    return row

PRICE_SOURCE="""FROM dbo.NPDIngredientPrice p JOIN dbo.NPDIngredient i ON i.ID=p.IngredientID
 JOIN dbo.UoM b ON b.ID=i.BaseUoMID JOIN dbo.UoM u ON u.ID=p.PriceUoMID
 JOIN dbo.Vendor v ON v.ID=p.VendorID JOIN dbo.Currency c ON c.ID=p.CurrencyID"""
PRICE_SELECT="""p.*,i.IngredientCode,i.Description,i.Origin,i.GradeNature,i.Status IngredientStatus,i.RowVersion IngredientVersion,
 b.UoMCode BaseUoM,b.BaseFactor,u.UoMCode PriceUnit,u.BaseFactor PriceUnitFactor,
 v.VendorName,v.Status VendorStatus,c.CurrencyCode"""

def eligible_members(cur):
    return query(cur,"""SELECT u.ID,u.UserName FROM dbo.Users u WHERE u.IsActive=1 AND (
      EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=u.ID AND
        (a.Scope='Admin' OR a.Scope IN('NPD','NPDManager') AND NOT EXISTS(
           SELECT 1 FROM dbo.WorkspaceRoleScope derived WHERE derived.UserID=u.ID AND derived.Scope=a.Scope)))
      OR EXISTS(SELECT 1 FROM dbo.WorkspaceUserRole ur JOIN dbo.WorkspaceRole r ON r.ID=ur.RoleID AND r.IsActive=1
        JOIN dbo.WorkspaceRolePermission p ON p.RoleID=r.ID AND p.PageKey='recipe-sheets' AND p.AccessLevel='edit'
        WHERE ur.UserID=u.ID)) ORDER BY u.UserName""")

@router.get('/lookups')
def lookups(ctx:AccessContext=Depends(get_access_context)):
    if not any(allowed(ctx,p) for p in ('ingredients','ingredient-prices','recipe-requests','recipe-sheets')):raise HTTPException(403,'NPD access is required.')
    with get_raw_cursor() as cur:
        ready(cur)
        units=query(cur,"SELECT ID,UoMCode,UoMName,BaseFactor FROM dbo.UoM WHERE Status='Active' AND Category='Weight/Mass' ORDER BY UoMCode")
        vendors=query(cur,"SELECT ID,VendorName FROM dbo.Vendor WHERE Status='Active' ORDER BY VendorName")
        currencies=query(cur,"SELECT ID,CurrencyCode FROM dbo.Currency ORDER BY CurrencyCode")
        ingredients=query(cur,'SELECT i.*,u.UoMCode BaseUoM FROM dbo.NPDIngredient i JOIN dbo.UoM u ON u.ID=i.BaseUoMID ORDER BY i.Description') if allowed(ctx,'ingredients') or allowed(ctx,'recipe-sheets') else []
        members=eligible_members(cur)
        return dict(units=units,vendors=vendors,currencies=currencies,ingredients=ingredients,members=members)

@router.get('/ingredients')
def ingredients(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=500),search:str=Query('',max_length=200),status:Literal['','Active','Block']='',sort:str='[]',ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredients')
    with get_raw_cursor() as cur:
        ready(cur);pattern=search+'%'
        from shared_master_views import order_by
        source="FROM dbo.NPDIngredient i JOIN dbo.UoM u ON u.ID=i.BaseUoMID WHERE (i.Description LIKE ? OR i.IngredientCode LIKE ? OR i.Origin LIKE ?) AND (?='' OR i.Status=?)"
        args=[pattern,pattern,pattern,status,status]
        return dict(rows=query(cur,'SELECT i.*,u.UoMCode BaseUoM '+source+' ORDER BY '+order_by('ingredients',sort)+' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',*args,(page-1)*page_size,page_size),total=cur.execute('SELECT COUNT(*) '+source,*args).fetchval(),page=page)

@router.post('/ingredients')
def ingredient_save(body:Ingredient,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredients',True)
    with transaction(ctx) as cur:
        mass(cur,body.BaseUoMID)
        if body.ID:
            old=one(cur,'SELECT * FROM dbo.NPDIngredient WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',body.ID);expected(old,body.RowVersion)
            if old['BaseUoMID']!=body.BaseUoMID and cur.execute('SELECT TOP(1) ID FROM dbo.NPDIngredientPrice WHERE IngredientID=?',body.ID).fetchone():
                raise ValueError('Base UoM is fixed after pricing is maintained. Create a new ingredient for another base.')
            cur.execute('UPDATE dbo.NPDIngredient SET Description=?,Origin=?,GradeNature=?,BaseUoMID=?,Status=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?',body.Description,body.Origin,body.GradeNature if body.GradeNature is not None else old['GradeNature'],body.BaseUoMID,body.Status,ctx.user_id,body.ID);identity=body.ID
        else:identity=cur.execute('INSERT dbo.NPDIngredient(Description,Origin,GradeNature,BaseUoMID,Status,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?,?,?,?)',body.Description,body.Origin,body.GradeNature or '',body.BaseUoMID,body.Status,ctx.user_id).fetchval()
        row=one(cur,'SELECT * FROM dbo.NPDIngredient WHERE ID=?',identity);audit(cur,'Ingredient',identity,'Save',row,ctx);return {'row':row}

@router.get('/ingredients/{identity}')
def ingredient_read(identity:int,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredients')
    with get_raw_cursor() as cur:
        ready(cur);return {'row':one(cur,'SELECT * FROM dbo.NPDIngredient WHERE ID=?',identity)}

@router.get('/ingredient-prices')
def prices(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=500),search:str=Query('',max_length=200),status:Literal['','Active','Block']='',sort:str='[]',ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredient-prices')
    with get_raw_cursor() as cur:
        from shared_master_views import order_by
        ready(cur);pattern=search+'%';source=PRICE_SOURCE+" WHERE (i.Description LIKE ? OR i.IngredientCode LIKE ? OR v.VendorName LIKE ?) AND (?='' OR p.Status=?)";args=[pattern,pattern,pattern,status,status]
        return dict(rows=query(cur,'SELECT '+PRICE_SELECT+' '+source+' ORDER BY '+order_by('ingredient-prices',sort)+' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',*args,(page-1)*page_size,page_size),total=cur.execute('SELECT COUNT(*) '+source,*args).fetchval(),page=page)

from shared_master_views import SharedExport,export_view
@router.post('/ingredients/export')
def ingredient_export(body:SharedExport,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredients');return export_view('ingredients',body)

@router.post('/ingredient-prices/export')
def price_export(body:SharedExport,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredient-prices');return export_view('ingredient-prices',body)

@router.post('/ingredient-prices')
def price_save(body:Price,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredient-prices',True)
    with transaction(ctx) as cur:
        mass(cur,body.PriceUoMID)
        one(cur,"SELECT ID FROM dbo.NPDIngredient WHERE ID=? AND Status='Active'",body.IngredientID)
        one(cur,"SELECT ID FROM dbo.Vendor WHERE ID=? AND Status='Active'",body.VendorID)
        one(cur,"SELECT ID FROM dbo.Currency WHERE ID=?",body.CurrencyID)
        if body.ID:expected(one(cur,'SELECT * FROM dbo.NPDIngredientPrice WHERE ID=?',body.ID),body.RowVersion)
        if body.Status=='Active' and cur.execute("""SELECT TOP(1) ID FROM dbo.NPDIngredientPrice WITH(UPDLOCK,HOLDLOCK)
          WHERE IngredientID=? AND VendorID=? AND Status='Active' AND ID<>?
           AND (QuantityTo IS NULL OR QuantityTo>?) AND (? IS NULL OR QuantityFrom<?)
           AND (EffectiveTo IS NULL OR EffectiveTo>=?) AND (? IS NULL OR EffectiveFrom<=?)""",
          body.IngredientID,body.VendorID,body.ID or 0,body.QuantityFrom,body.QuantityTo,body.QuantityTo,body.EffectiveFrom,body.EffectiveTo,body.EffectiveTo).fetchone():
            raise ValueError('This vendor already has an overlapping quantity tier and effective period for this ingredient.')
        fields=['IngredientID','VendorID','CurrencyID','UnitPrice','PriceUoMID','QuantityFrom','QuantityTo','EffectiveFrom','EffectiveTo','ExchangeRateToUSD','Status']
        values=[getattr(body,k) for k in fields]
        if body.ID:
            cur.execute('UPDATE dbo.NPDIngredientPrice SET '+','.join(k+'=?' for k in fields)+',UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?',*values,ctx.user_id,body.ID);identity=body.ID
        else:identity=cur.execute('INSERT dbo.NPDIngredientPrice('+','.join(fields)+',CreatedBy) OUTPUT INSERTED.ID VALUES('+','.join('?' for _ in range(len(fields)+1))+')',*values,ctx.user_id).fetchval()
        row=one(cur,'SELECT * FROM dbo.NPDIngredientPrice WHERE ID=?',identity);audit(cur,'IngredientPrice',identity,'Save',row,ctx);return {'row':row}

@router.get('/ingredient-prices/{identity}')
def price_read(identity:int,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'ingredient-prices')
    with get_raw_cursor() as cur:
        ready(cur);return {'row':one(cur,'SELECT '+PRICE_SELECT+' '+PRICE_SOURCE+' WHERE p.ID=?',identity)}

OPPORTUNITY_SOURCE="""FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID
 JOIN dbo.Customer c ON c.ID=o.CustomerID JOIN dbo.Currency currency ON currency.ID=COALESCE(o.RateCustomerCurrencyID,c.CurrencyID)
 JOIN dbo.Product p ON p.ID=i.ProductID
 LEFT JOIN dbo.OpportunityItem parent ON parent.ID=i.ParentItemID AND parent.OpportunityID=i.OpportunityID"""
OPPORTUNITY_SELECT="""i.ID OpportunityItemID,i.RowVersion,i.OpportunityID,i.ProductID,p.ProductCode,p.ProductName,
 i.ProductNetWeightGrams WeightGrams,i.AnnualUnit,
 CASE WHEN i.ParentItemID IS NOT NULL THEN parent.EstPctAwarded ELSE i.EstPctAwarded END EstPctAwarded,
 i.ProductGradeSnapshot,i.TCBCostInfo,
 p.IsMix,i.ParentItemID,i.Stage ItemStage,o.Stage HeaderStage,o.OpportunityNumber,c.CustomerName,
 o.ExchangeRateVNDPerUSD,o.ExchangeRateCustomerCurrencyPerUSD,currency.CurrencyCode CustomerCurrencyCode"""

@router.get('/opportunity-items')
def opportunity_choices(search:str=Query('',max_length=200),ctx:AccessContext=Depends(get_access_context)):
    if not ctx.is_admin and 'Opportunity' not in ctx.scopes:raise HTTPException(403,'Opportunity access is required to create recipe requests.')
    with get_raw_cursor() as cur:
        ready(cur)
        rows=query(cur,'SELECT TOP(200) '+OPPORTUNITY_SELECT+' '+OPPORTUNITY_SOURCE+" WHERE o.Stage='Draft' AND i.Stage='Draft' AND p.IsMix=0 AND (o.OpportunityNumber LIKE ? OR c.CustomerName LIKE ? OR p.ProductCode LIKE ?) ORDER BY o.ID DESC,i.ID",*(3*[search+'%']))
        rows=[r for r in rows if obj(r['ProductGradeSnapshot']).get('RequiresRecipeConfirmation')]
        for r in rows:
            r['EstimatedAwardedMT']=str(awarded_mt(r));r.pop('TCBCostInfo',None)
            r.update(obj(r['ProductGradeSnapshot']).get('RecipeRequirements') or {})
            r['HasLinkedRecipeRequest']=bool(cur.execute('SELECT ID FROM dbo.NPDRecipeRequestItem WHERE OpportunityItemID=? AND IsLinked=1',r['OpportunityItemID']).fetchone())
        return {'rows':rows}

class RequestLine(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    OpportunityItemID:int=Field(ge=1)
    RowVersion:str
    LaunchingDate:date|None=None
    SpecialComments:str|None=Field(None,max_length=2000)

class RecipeRequest(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    CreationKey:UUID
    RequestDue:date
    RequestNote:str|None=Field(None,max_length=2000)
    Items:list[RequestLine]=Field(min_length=1,max_length=100)

@router.post('/requests')
def request_create(body:RecipeRequest,ctx:AccessContext=Depends(get_access_context)):
    if not ctx.is_admin and 'Opportunity' not in ctx.scopes:raise HTTPException(403,'Opportunity access is required to create recipe requests.')
    if len({r.OpportunityItemID for r in body.Items})!=len(body.Items):raise HTTPException(422,'Choose each Opportunity item once.')
    with transaction(ctx) as cur:
        replay=query(cur,'SELECT * FROM dbo.NPDRecipeRequest WHERE CreationKey=?',str(body.CreationKey))
        if replay:
            original=one(cur,"SELECT SnapshotJSON FROM dbo.NPDAudit WHERE Entity='Request' AND RecordID=? AND Action='Create'",replay[0]['ID'])
            if obj(original['SnapshotJSON'])!=body.model_dump(mode='json'):raise HTTPException(409,'This creation key belongs to a different request. Refresh before retrying.')
            return {'row':replay[0],'replayed':True}
        selected=[]
        for line in body.Items:
            cur.execute('SELECT ID FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',line.OpportunityItemID).fetchone()
            cur.execute('SELECT o.ID FROM dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) JOIN dbo.OpportunityItem i ON i.OpportunityID=o.ID WHERE i.ID=?',line.OpportunityItemID).fetchone()
            r=one(cur,'SELECT '+OPPORTUNITY_SELECT+' '+OPPORTUNITY_SOURCE+' WHERE i.ID=?',line.OpportunityItemID)
            expected(r,line.RowVersion)
            if cur.execute('SELECT ID FROM dbo.NPDRecipeRequestItem WHERE OpportunityItemID=? AND IsLinked=1',line.OpportunityItemID).fetchone():raise ValueError('This item already has a linked Recipe Request. Close its recipe link before requesting again.')
            if not obj(r['ProductGradeSnapshot']).get('RequiresRecipeConfirmation'):raise ValueError('Enable Recipe confirmation on the Opportunity grade snapshot first.')
            if r['IsMix'] or r['ItemStage']!='Draft' or r['HeaderStage']!='Draft' or not raw_grades(r['ProductGradeSnapshot']):raise ValueError('Choose Draft non-Mix product items or Mix children with maintained Level 1 grades.')
            if selected and r['OpportunityID']!=selected[0]['OpportunityID']:raise ValueError('One recipe request belongs to one Opportunity.')
            if Decimal(str(r['WeightGrams'] or 0))<=0 or Decimal(str(r['AnnualUnit'] or 0))<=0 or r['EstPctAwarded'] is None:raise ValueError('Maintain net weight, annual units and estimated award percentage first.')
            selected.append(r)
        first=selected[0]
        identity=cur.execute('INSERT dbo.NPDRecipeRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerName,RequestNote,RequestDue,RequestedBy) OUTPUT INSERTED.ID VALUES(?,?,?,?,?,?,?)',str(body.CreationKey),first['OpportunityID'],first['OpportunityNumber'],first['CustomerName'],body.RequestNote,body.RequestDue,ctx.user_id).fetchval()
        for r,line in zip(selected,body.Items):
            requirements=obj(r['ProductGradeSnapshot']).get('RecipeRequirements') or {}
            cur.execute('INSERT dbo.NPDRecipeRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,WeightGrams,AnnualUnit,EstPctAwarded,GradeSnapshot,LaunchingDate,SpecialComments) VALUES(?,?,?,?,?,?,?,?,?,?,?)',identity,r['OpportunityItemID'],r['ProductID'],r['ProductCode'],r['ProductName'],r['WeightGrams'],r['AnnualUnit'],r['EstPctAwarded'],r['ProductGradeSnapshot'],requirements.get('LaunchingDate'),requirements.get('SpecialComments'))
        audit(cur,'Request',identity,'Create',body.model_dump(mode='json'),ctx)
        return {'row':one(cur,'SELECT * FROM dbo.NPDRecipeRequest WHERE ID=?',identity)}

@router.get('/requests')
def request_list(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=500),search:str=Query('',max_length=200),ctx:AccessContext=Depends(get_access_context),status:str=Query('',max_length=30),created_by:str=Query('',max_length=200),assigned_to:str=Query('',max_length=200),sort:str=Query('[]',max_length=4000)):
    from npd_views import request_order
    access(ctx,'recipe-requests');ordering=request_order(sort)
    if status not in ('','Open','Completed','Closed'):raise HTTPException(422,'Invalid Recipe Request status.')
    with get_raw_cursor() as cur:
        ready(cur);pattern=search+'%'
        summary="""WITH Summary AS (SELECT h.*,u.UserName RequestedByName,
          (SELECT COUNT(*) FROM dbo.NPDRecipeRequestItem i WHERE i.RequestID=h.ID) ItemCount,
          (SELECT COUNT(*) FROM dbo.NPDRecipeRequestItem i WHERE i.RequestID=h.ID AND i.PICUserID IS NULL AND i.IsOpen=1) Unassigned,
          (SELECT COUNT(*) FROM dbo.NPDRecipeRequestItem i WHERE i.RequestID=h.ID AND i.PICUserID=?) AssignedToMe,
          CASE WHEN EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem i WHERE i.RequestID=h.ID AND i.IsOpen=1) THEN 'Open'
           WHEN EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem i WHERE i.RequestID=h.ID AND i.ActiveSheetID IS NOT NULL) THEN 'Completed' ELSE 'Closed' END Status
          FROM dbo.NPDRecipeRequest h JOIN dbo.Users u ON u.ID=h.RequestedBy)
        """
        source="""FROM Summary h WHERE (RequestNumber LIKE ? OR OpportunityNumber LIKE ? OR CustomerName LIKE ?)
          AND (?='' OR Status=?) AND RequestedByName LIKE ?
          AND (?='' OR EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem i JOIN dbo.Users pic ON pic.ID=i.PICUserID WHERE i.RequestID=h.ID AND pic.UserName LIKE ?))"""
        args=(ctx.user_id,pattern,pattern,pattern,status,status,created_by+'%',assigned_to,assigned_to+'%')
        rows=query(cur,summary+'SELECT * '+source+' ORDER BY '+ordering+' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',*args,(page-1)*page_size,page_size)
        return dict(rows=rows,total=cur.execute(summary+'SELECT COUNT(*) '+source,*args).fetchval())

@router.get('/requests/{request_id}')
def request_read(request_id:int,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'recipe-requests')
    with get_raw_cursor() as cur:
        ready(cur)
        return {'row':one(cur,"SELECT h.*,u.UserName RequestedByName FROM dbo.NPDRecipeRequest h JOIN dbo.Users u ON u.ID=h.RequestedBy WHERE h.ID=?",request_id)}


ITEM_SOURCE="""FROM dbo.NPDRecipeRequestItem i JOIN dbo.NPDRecipeRequest h ON h.ID=i.RequestID
 LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID"""

@router.get('/requests/{request_id}/items')
def request_items(request_id:int,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'recipe-requests')
    can_read_sheets=allowed(ctx,'recipe-sheets')
    can_read_drafts=ctx.is_admin or bool(ctx.scopes&{'NPD','NPDManager'})
    with get_raw_cursor() as cur:
        ready(cur);rows=query(cur,"""SELECT i.*,h.RequestNumber,h.RequestDue,pic.UserName PIC,
          CASE WHEN latest.ApprovalStatus='Pending' THEN 'Submitted'
               WHEN i.IsOpen=1 AND latest.ApprovalStatus='Returned' THEN 'Returned'
               WHEN i.IsOpen=1 AND i.PICUserID IS NOT NULL THEN 'Assigned'
               WHEN i.IsOpen=1 THEN 'Open' WHEN i.ActiveSheetID IS NOT NULL THEN 'Approved' ELSE 'Closed' END Status,
          latest.ID LatestSheetID,latest.SheetNumber LatestSheetNumber,
          latest.Status LatestSheetStatus,latest.ApprovalStatus LatestSheetApprovalStatus,
          latest.ApprovedAt LatestSheetApprovedAt,approver.UserName LatestSheetApprovedByName,
          approved.ID ApprovedSheetID,approved.SheetNumber ActiveSheetNumber,
          (SELECT s.ID,s.SheetNumber,s.Revision,s.Status,s.ApprovalStatus,s.CreatedAt,s.UpdatedAt,s.SubmittedAt,s.ApprovedAt,
             COALESCE(JSON_VALUE(created.SnapshotJSON,'$.PIC'),pic.UserName) PIC,
             reviewer.UserName ApprovedByName,CAST(CASE WHEN s.ID=i.ActiveSheetID AND i.IsLinked=1 AND s.ApprovalStatus='Approved' THEN 1 ELSE 0 END AS BIT) IsCurrentApproved
           FROM dbo.NPDRecipeSheet s LEFT JOIN dbo.Users reviewer ON reviewer.ID=s.ApprovedBy
           OUTER APPLY (SELECT TOP(1) a.SnapshotJSON FROM dbo.NPDAudit a
              WHERE a.Entity='Sheet' AND a.RecordID=s.ID AND a.Action='Create' ORDER BY a.ID) created
           WHERE s.RequestItemID=i.ID AND ?=1 AND (?=1 OR s.ApprovalStatus='Approved')
           ORDER BY s.Revision DESC FOR JSON PATH) SheetVersions,
          CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.NPDRecipeSheet s WHERE s.RequestItemID=i.ID AND s.ApprovalStatus<>'Approved') THEN 1 ELSE 0 END AS BIT) HasWorkingSheet
          """+ITEM_SOURCE+""" OUTER APPLY (SELECT TOP(1) s.ID,s.SheetNumber,s.Status,s.ApprovalStatus,s.ApprovedBy,s.ApprovedAt
           FROM dbo.NPDRecipeSheet s WHERE s.RequestItemID=i.ID ORDER BY s.Revision DESC) latest
           LEFT JOIN dbo.Users approver ON approver.ID=latest.ApprovedBy
           LEFT JOIN dbo.NPDRecipeSheet approved ON approved.ID=i.ActiveSheetID AND approved.RequestItemID=i.ID AND approved.ApprovalStatus='Approved'
           WHERE h.ID=? ORDER BY i.ID""",bool(can_read_sheets),bool(can_read_drafts),request_id)
        for r in rows:
            r['EstimatedAwardedMT']=str(awarded_mt(r));r['Grades']=raw_grades(r['GradeSnapshot'])
            r['SheetVersions']=obj(r['SheetVersions'],[])
            r['CanAssignPIC']=bool(r['IsOpen'] and r['IsLinked'] and r.get('LatestSheetApprovalStatus') not in ('Pending','Approved'))
        return {'rows':rows}

class Assignment(BaseModel):
    model_config=ConfigDict(extra='forbid')
    RowVersion:str
    PICUserID:int=Field(ge=1)

class CloseItem(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    RowVersion:str
    Comment:str=Field(min_length=1,max_length=2000)

@router.post('/request-items/{item_id}/close')
def close_item(item_id:int,body:CloseItem,ctx:AccessContext=Depends(get_access_context)):
    manager(ctx)
    with transaction(ctx) as cur:
        row=one(cur,'SELECT * FROM dbo.NPDRecipeRequestItem WHERE ID=?',item_id);expected(row,body.RowVersion)
        if cur.execute("SELECT ID FROM dbo.NPDRecipeSheet WHERE RequestItemID=? AND ApprovalStatus='Pending'",item_id).fetchone():
            raise HTTPException(409,'Return the pending sheet before closing this request item.')
        cur.execute('UPDATE dbo.NPDRecipeRequestItem SET IsOpen=0,IsLinked=0 WHERE ID=?',item_id)
        audit(cur,'RequestItem',item_id,'Close',{'Comment':body.Comment},ctx)
        return {'row':one(cur,'SELECT * FROM dbo.NPDRecipeRequestItem WHERE ID=?',item_id)}

@router.post('/request-items/{item_id}/assign')
def assign(item_id:int,body:Assignment,ctx:AccessContext=Depends(get_access_context)):
    manager(ctx)
    with transaction(ctx) as cur:
        row=one(cur,'SELECT * FROM dbo.NPDRecipeRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',item_id);expected(row,body.RowVersion)
        if not row['IsOpen'] or not row['IsLinked']:raise HTTPException(409,'Closed or approved request items cannot be reassigned. Start a new recipe revision first.')
        if body.PICUserID not in {r['ID'] for r in eligible_members(cur)}:
            raise ValueError('Choose an active NPD member with Recipe Sheet edit access.')
        if cur.execute("SELECT ID FROM dbo.NPDRecipeSheet WHERE RequestItemID=? AND ApprovalStatus='Pending'",item_id).fetchone():raise HTTPException(409,'Return the submitted sheet before reassigning this item.')
        cur.execute('UPDATE dbo.NPDRecipeRequestItem SET PICUserID=?,AssignedBy=?,AssignedAt=SYSUTCDATETIME() WHERE ID=?',body.PICUserID,ctx.user_id,item_id)
        result=one(cur,'SELECT * FROM dbo.NPDRecipeRequestItem WHERE ID=?',item_id);audit(cur,'RequestItem',item_id,'Assign',result,ctx);return {'row':result}

SHEET_SOURCE="""FROM dbo.NPDRecipeSheet s JOIN dbo.NPDRecipeRequestItem i ON i.ID=s.RequestItemID
 JOIN dbo.NPDRecipeRequest h ON h.ID=i.RequestID LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID
 LEFT JOIN dbo.Users approver ON approver.ID=s.ApprovedBy"""
SHEET_SELECT="""s.*,i.OpportunityItemID,i.PICUserID,pic.UserName PIC,approver.UserName ApprovedByName,
 h.RequestNumber,h.RequestDue,i.ProductCode,i.ProductName,i.WeightGrams,i.AnnualUnit,i.EstPctAwarded,
 i.GradeSnapshot,i.LaunchingDate,i.SpecialComments,i.ActiveSheetID,i.IsOpen,i.IsLinked"""

def sheet_row(cur,identity):
    row=one(cur,'SELECT '+SHEET_SELECT+' '+SHEET_SOURCE+' WHERE s.ID=?',identity)
    if row.get('ExchangeRateVNDPerUSD') is None:
        row['ExchangeRateVNDPerUSD']=one(cur,'SELECT '+OPPORTUNITY_SELECT+' '+OPPORTUNITY_SOURCE+' WHERE i.ID=?',row['OpportunityItemID'])['ExchangeRateVNDPerUSD']
    return row

def owner(ctx,item):
    access(ctx,'recipe-sheets',True)
    if not item.get('IsLinked',True):raise HTTPException(409,'The recipe link is closed. Create a new Recipe Request.')
    if not item.get('PICUserID'):raise HTTPException(409,'Assign an NPD member before creating a recipe sheet.')
    if not ctx.is_admin and item['PICUserID']!=ctx.user_id:raise HTTPException(403,'Only the assigned NPD member can edit this recipe sheet.')
    if not item.get('IsOpen') and not item.get('ActiveSheetID'):raise HTTPException(409,'This request item is closed. Create a new request.')

def all_prices(cur):
    rows=query(cur,'SELECT '+PRICE_SELECT+' '+PRICE_SOURCE+" WHERE p.Status='Active' AND b.Status='Active' AND u.Status='Active'")
    for r in rows:
        r['EffectiveFrom']=date.fromisoformat(r['EffectiveFrom'])
        r['EffectiveTo']=date.fromisoformat(r['EffectiveTo']) if r['EffectiveTo'] else None
    return rows

def calculation(cur,row,lines,status,exchange_rate=None):
    opportunity=one(cur,'SELECT '+OPPORTUNITY_SELECT+' '+OPPORTUNITY_SOURCE+' WHERE i.ID=?',row['OpportunityItemID'])
    opportunity['ExchangeRateVNDPerUSD']=exchange_rate if exchange_rate is not None else row.get('ExchangeRateVNDPerUSD') or opportunity['ExchangeRateVNDPerUSD']
    ingredients=query(cur,"SELECT i.ID,i.IngredientCode,i.Description,i.GradeNature,i.Origin,i.Status,i.RowVersion IngredientVersion FROM dbo.NPDIngredient i JOIN dbo.UoM u ON u.ID=i.BaseUoMID WHERE u.Status='Active' AND u.Category='Weight/Mass' AND u.BaseFactor>0")
    return evaluate(lines,row,all_prices(cur),opportunity,ready=status!='Draft',ingredients=ingredients,vendors=query(cur,"SELECT ID,VendorName,Status FROM dbo.Vendor"))

@router.get('/sheets')
def sheet_list(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=200),search:str=Query('',max_length=200),ctx:AccessContext=Depends(get_access_context),pic:str='',status:Literal['','Draft','Price Ready','Final','Pending','Approved','Returned']='',sort:str=''):
    access(ctx,'recipe-sheets')
    columns={'SheetNumber':'s.ID','RequestNumber':'h.ID','ProductCode':'i.ProductCode','ProductName':'i.ProductName','PIC':'pic.UserName','Status':'s.Status','ApprovalStatus':'s.ApprovalStatus','Revision':'s.Revision','ApprovedByName':'approver.UserName'}
    order='s.ID DESC'
    if sort:
        try:
            rules=json.loads(sort)
            if not isinstance(rules,list) or not 1<=len(rules)<=len(columns):raise ValueError()
            if len({r['column'] for r in rules})!=len(rules):raise ValueError()
            if any(r['column'] not in columns or r['direction'] not in ('asc','desc') for r in rules):raise ValueError()
            order=','.join(columns[r['column']]+' '+r['direction'].upper() for r in rules)
            if not any(r['column']=='SheetNumber' for r in rules):order+=',s.ID DESC'
        except (ValueError,TypeError,KeyError):raise HTTPException(422,'Choose valid Recipe Sheet sort columns and directions.')
    if len(pic)>200:raise HTTPException(422,'PIC filter is too long.')
    with get_raw_cursor() as cur:
        ready(cur);pattern=search+'%';source=SHEET_SOURCE+' WHERE (s.SheetNumber LIKE ? OR h.RequestNumber LIKE ? OR i.ProductCode LIKE ? OR i.ProductName LIKE ?)'
        params=4*[pattern]
        if pic:source+=' AND pic.UserName LIKE ?';params.append(pic+'%')
        if status:
            source+=' AND '+('s.ApprovalStatus' if status in ('Pending','Approved','Returned') else 's.Status')+'=?';params.append(status)
        if not ctx.is_admin and not ctx.scopes&{'NPD','NPDManager'}:source+=" AND s.ApprovalStatus='Approved'"
        return dict(rows=query(cur,'SELECT '+SHEET_SELECT+' '+source+' ORDER BY '+order+' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',*params,(page-1)*page_size,page_size),total=cur.execute('SELECT COUNT(*) '+source,*params).fetchval())

@router.get('/sheets/{sheet_id}')
def sheet_read(sheet_id:int,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,'recipe-sheets')
    with get_raw_cursor() as cur:
        ready(cur);row=sheet_row(cur,sheet_id)
        if not ctx.is_admin and not ctx.scopes&{'NPD','NPDManager'} and row['ApprovalStatus']!='Approved':raise HTTPException(403,'Only approved recipe sheets are available outside NPD.')
        return {'row':row,'lines':obj(row['LinesJSON'],[]),'calculation':obj(row['CalculationJSON'])}

class NewSheet(BaseModel):
    model_config=ConfigDict(extra='forbid')
    CreationKey:UUID
    RowVersion:str

@router.post('/request-items/{item_id}/sheets')
def sheet_create(item_id:int,body:NewSheet,ctx:AccessContext=Depends(get_access_context)):
    with transaction(ctx) as cur:
        item=one(cur,'SELECT * FROM dbo.NPDRecipeRequestItem WHERE ID=?',item_id);owner(ctx,item)
        replay=query(cur,'SELECT ID,RequestItemID FROM dbo.NPDRecipeSheet WHERE CreationKey=?',str(body.CreationKey))
        if replay:
            if replay[0]['RequestItemID']!=item_id:raise HTTPException(409,'Creation key belongs to another item.')
            return {'row':sheet_row(cur,replay[0]['ID'])}
        expected(item,body.RowVersion)
        if cur.execute("SELECT ID FROM dbo.NPDRecipeSheet WHERE RequestItemID=? AND ApprovalStatus<>'Approved'",item_id).fetchone():raise HTTPException(409,'Continue the existing draft or returned recipe sheet for this item.')
        prior=query(cur,'SELECT TOP(1) * FROM dbo.NPDRecipeSheet WHERE RequestItemID=? ORDER BY Revision DESC',item_id)
        lines=obj(prior[0]['LinesJSON'],[]) if prior else [dict(Kind='Raw',GradePath=g['GradePath'],RatioPct=g['RatioPct'],LossPct='0',IngredientID=None,PriceID=None) for g in raw_grades(item['GradeSnapshot'])]
        if not lines:raise ValueError('The request needs captured Level 1 grades before creating a sheet.')
        cur.execute('UPDATE dbo.NPDRecipeRequestItem SET IsOpen=1 WHERE ID=?',item_id)
        exchange_rate=one(cur,'SELECT '+OPPORTUNITY_SELECT+' '+OPPORTUNITY_SOURCE+' WHERE i.ID=?',item['OpportunityItemID'])['ExchangeRateVNDPerUSD']
        identity=cur.execute('INSERT dbo.NPDRecipeSheet(CreationKey,RequestItemID,Revision,LinesJSON,CreatedBy,SeasoningLossPct,ExchangeRateVNDPerUSD) OUTPUT INSERTED.ID VALUES(?,?,?,?,?,?,?)',str(body.CreationKey),item_id,(prior[0]['Revision']+1) if prior else 1,document(lines),ctx.user_id,0,exchange_rate).fetchval()
        result=sheet_row(cur,identity);audit(cur,'Sheet',identity,'Create',result,ctx);return {'row':result}

class SheetSave(BaseModel):
    model_config=ConfigDict(extra='forbid')
    RowVersion:str
    Status:Literal['Draft','Price Ready','Final']='Draft'
    Lines:list[RecipeLine]=Field(min_length=1,max_length=300)
    ExchangeRateVNDPerUSD:Decimal|None=Field(None,gt=0,max_digits=19,decimal_places=6)
    # Accepted for older clients; the server always derives loss from ingredient rows.
    SeasoningLossPct:Decimal|None=None

def sheet_editor(ctx,row):
    if row['ApprovalStatus']=='Pending':
        manager(ctx);access(ctx,'recipe-sheets',True)
    else:owner(ctx,row)
    if row['ApprovalStatus']=='Approved':raise HTTPException(409,'Approved sheets are locked. Create a new revision.')


def store_sheet(cur,row,body,result,ctx,pending=False):
    saved=[{k:v for k,v in line.items() if k in RecipeLine.model_fields} for line in result['Lines']]
    cur.execute("UPDATE dbo.NPDRecipeSheet SET Status=?,ApprovalStatus=?,LinesJSON=?,CalculationJSON=?,SeasoningLossPct=?,ExchangeRateVNDPerUSD=?,ReviewComment=NULL,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?",body.Status,'Pending' if pending else 'Draft',document(saved),document(result),Decimal(result['SeasoningLossPct']).quantize(Decimal('.000000000001')),result['ExchangeRateVNDPerUSD'],ctx.user_id,row['ID'])
    audit(cur,'Sheet',row['ID'],'SaveReview' if pending else 'Save',result,ctx)
    return saved


@router.post('/sheets/{sheet_id}/preview')
def sheet_preview(sheet_id:int,body:SheetSave,ctx:AccessContext=Depends(get_access_context)):
    with get_raw_cursor() as cur:
        ready(cur);row=sheet_row(cur,sheet_id);sheet_editor(ctx,row);expected(row,body.RowVersion)
        try:return {'calculation':calculation(cur,row,body.Lines,body.Status,body.ExchangeRateVNDPerUSD)}
        except ValueError as exc:raise HTTPException(422,str(exc)) from exc

@router.post('/sheets/{sheet_id}')
def sheet_save(sheet_id:int,body:SheetSave,ctx:AccessContext=Depends(get_access_context)):
    with transaction(ctx) as cur:
        row=sheet_row(cur,sheet_id)
        cur.execute('SELECT ID FROM dbo.NPDRecipeRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',row['RequestItemID']).fetchone()
        row=sheet_row(cur,sheet_id);sheet_editor(ctx,row);expected(row,body.RowVersion)
        pending=row['ApprovalStatus']=='Pending'
        if pending and body.Status=='Draft':raise HTTPException(422,'A submitted sheet must remain Price Ready or Final.')
        result=calculation(cur,row,body.Lines,body.Status,body.ExchangeRateVNDPerUSD)
        if pending:
            from npd_recipes import validate_submission
            validate_submission(result)
        saved=store_sheet(cur,row,body,result,ctx,pending)
        return {'row':sheet_row(cur,sheet_id),'calculation':result,'lines':saved}

class Review(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    RowVersion:str
    Action:Literal['Submit','Approve','Return']
    Comment:str|None=Field(None,max_length=2000)
    Changes:SheetSave|None=None

    @model_validator(mode='after')
    def changes_for_approval(self):
        if self.Changes is not None and self.Action!='Approve':raise ValueError('Recipe changes may only accompany approval.')
        return self

def apply_seasoning(value,snapshot,config=None):
    """Preserve grade composition/oil/processing; rebalance the RM share once."""
    import copy
    from tcb_costs import Inputs,calculate,leaves
    result=copy.deepcopy(value);approved=result.get('NPDRecipe')
    if not approved:return result
    inputs=seasoning_inputs(result.get('Inputs',{}),approved,config,['0/'+str(g['ID']) for g in obj(snapshot).get('items',[]) if g['ParentID']=='0'])
    result['Inputs']=inputs
    try:
        grades=leaves(obj(snapshot).get('items',[]))
        captured={p['PriceID']:p for p in result.get('PriceSnapshots',[]) if p.get('PriceID')}
        calculated=calculate(Inputs(**inputs),grades,captured,allow_unpriced=True,weight=approved.get('WeightGrams'))
        if not grades or len(calculated['PriceSnapshots'])!=len(grades):calculated.update(RMCostUSDPerLb=None,ProductUSDPerLb=None)
        result.update(calculated)
    except ValueError:
        result.update(RMCostUSDPerLb=None,ProductUSDPerLb=None,MaterialCostSnapshots=[])
    return result

def publish(cur,row,result,ctx):
    cur.execute('SELECT o.ID FROM dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) JOIN dbo.OpportunityItem i ON i.OpportunityID=o.ID WHERE i.ID=?',row['OpportunityItemID']).fetchone()
    item=one(cur,'SELECT '+OPPORTUNITY_SELECT+' '+OPPORTUNITY_SOURCE+' WHERE i.ID=?',row['OpportunityItemID'])
    if item['ItemStage']!='Draft' or item['HeaderStage']!='Draft':raise HTTPException(409,'Only a Draft Opportunity can receive an approved recipe.')
    if obj(item['ProductGradeSnapshot'])!=obj(row['GradeSnapshot']):raise HTTPException(409,'Opportunity grades changed after the request. Create a new request using the current grades.')
    if any(Decimal(str(item[k]))!=Decimal(str(row[k])) for k in ('WeightGrams','AnnualUnit','EstPctAwarded')):
        raise HTTPException(409,'Opportunity weight or estimated award quantity changed. Close this request item and create a new request using current quantities.')
    value=obj(item['TCBCostInfo'])
    previous_loss=Decimal(str((value.get('NPDRecipe') or {}).get('SeasoningLossPct') or 0))
    value['NPDRecipe']={k:result[k] for k in ('SeasoningRatio','SeasoningUSDPerLb','SeasoningCostBasis','ExchangeRateVNDPerUSD','GradeRatiosDiffer','Warnings')}
    value['NPDRecipe'].update(ApplicableGradePaths=result['ApplicableGradePaths'],SheetID=row['ID'],SheetNumber=row['SheetNumber'],Revision=row['Revision'],WeightGrams=row['WeightGrams'],ApprovedBy=ctx.username)
    component=one(cur,"SELECT ID FROM dbo.RecipeComponent WHERE SystemKey='Seasoning'")
    value['NPDRecipe'].update(SeasoningLossPct=str(Decimal(result['SeasoningLossPct']).quantize(Decimal('.01'))),SeasoningComponentID=component['ID'])
    value['NPDRecipe']['CapturedGrades']=obj(row['GradeSnapshot'])['items']
    seasoning_processes={r[0] for r in cur.execute("SELECT pc.ProcessID FROM dbo.ProcessRecipeComponent pc JOIN dbo.RecipeComponent c ON c.ID=pc.ComponentID WHERE c.SystemKey='Seasoning'").fetchall()}
    for stage in value.get('Inputs',{}).get('ProcessLosses') or []:
        for index,code in enumerate(stage.get('Codes') or []):
            if code.get('MasterID') in seasoning_processes and not code.get('ManualLoss') and Decimal(str(stage['Ratios'][index]))==previous_loss:
                stage['Ratios'][index]=value['NPDRecipe']['SeasoningLossPct']
                code['SourceSheetID']=row['ID']
    # Existing manually entered ratios remain user-owned; the approved loss supplies
    # the default only when the Seasoning process is subsequently added.
    from recipe_components import catalog
    value=apply_seasoning(value,item['ProductGradeSnapshot'],catalog(cur))
    cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?',document(value),row['OpportunityItemID'])
    cur.execute('UPDATE dbo.OpportunityTCBVersion SET SavedJSON=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ItemID=? AND IsActive=1',document(value),ctx.username,row['OpportunityItemID'])
    cur.execute("""INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,FieldName,NewValue,ChangedBy,Source,Reason)
      VALUES(NEWID(),?,'Item',?,?,'Update','NPDRecipe',?,?,'User','Approved NPD recipe')""",item['OpportunityID'],row['OpportunityItemID'],row['ProductCode'],document(value['NPDRecipe']),ctx.username)

@router.post('/sheets/{sheet_id}/review')
def sheet_review(sheet_id:int,body:Review,ctx:AccessContext=Depends(get_access_context)):
    with transaction(ctx) as cur:
        from npd_recipes import validate_submission
        row=sheet_row(cur,sheet_id)
        cur.execute('SELECT ID FROM dbo.NPDRecipeRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',row['RequestItemID']).fetchone()
        row=sheet_row(cur,sheet_id);expected(row,body.RowVersion)
        if body.Action=='Submit':
            owner(ctx,row)
            if row['ApprovalStatus'] not in ('Draft','Returned') or row['Status']=='Draft':raise HTTPException(409,'Save a Price Ready or Final sheet before submitting.')
            result=calculation(cur,row,[RecipeLine(**r) for r in obj(row['LinesJSON'],[])],row['Status'])
            validate_submission(result)
            cur.execute("UPDATE dbo.NPDRecipeSheet SET ApprovalStatus='Pending',CalculationJSON=?,SubmittedBy=?,SubmittedAt=SYSUTCDATETIME(),ReviewComment=NULL WHERE ID=?",document(result),ctx.user_id,sheet_id)
        else:
            manager(ctx)
            if row['ApprovalStatus']!='Pending':raise HTTPException(409,'Only a submitted recipe sheet can be reviewed.')
            if body.Action=='Return':
                if not body.Comment:raise ValueError('Enter a reason when returning a sheet.')
                cur.execute("UPDATE dbo.NPDRecipeSheet SET ApprovalStatus='Returned',ReviewComment=? WHERE ID=?",body.Comment,sheet_id)
            else:
                cur.execute('SELECT ID FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',row['OpportunityItemID']).fetchone()
                if body.Changes is not None:
                    access(ctx,'recipe-sheets',True)
                    expected(row,body.Changes.RowVersion)
                    if body.Changes.Status=='Draft':raise HTTPException(422,'Only a Price Ready or Final sheet can be approved.')
                    result=calculation(cur,row,body.Changes.Lines,body.Changes.Status,body.Changes.ExchangeRateVNDPerUSD)
                    validate_submission(result)
                    store_sheet(cur,row,body.Changes,result,ctx,pending=True)
                    row=sheet_row(cur,sheet_id)
                else:
                    result=calculation(cur,row,[RecipeLine(**r) for r in obj(row['LinesJSON'],[])],row['Status'])
                    validate_submission(result)
                    previous=obj(row['CalculationJSON'])
                    if previous.get('SeasoningCostBasis')!='FinishedProduct':raise HTTPException(409,'Recipe calculation changed. Refresh pricing and review the updated recipe before approving.')
                    if quote_key(result)!=quote_key(previous):raise HTTPException(409,'An ingredient price, master or exchange rate changed. Refresh pricing and review the updated recipe before approving.')
                publish(cur,row,result,ctx)
                cur.execute("UPDATE dbo.NPDRecipeSheet SET ApprovalStatus='Approved',CalculationJSON=?,ApprovedBy=?,ApprovedAt=SYSUTCDATETIME(),ReviewComment=? WHERE ID=?",document(result),ctx.user_id,body.Comment,sheet_id)
                cur.execute('UPDATE dbo.NPDRecipeRequestItem SET ActiveSheetID=?,IsOpen=0 WHERE ID=?',sheet_id,row['RequestItemID'])
        result=sheet_row(cur,sheet_id);audit(cur,'Sheet',sheet_id,body.Action,result,ctx);return {'row':result}
