"""Permanent deletion of unprocessed, unreferenced business records only.

Identifiers come from a closed registry or SQL Server metadata, never request text.
Inbound references are checked even for CASCADE foreign keys. No cascade cleanup.
"""
import json
from decimal import Decimal,InvalidOperation
from dataclasses import dataclass
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from auth import AccessContext,get_access_context
from db import get_raw_cursor
from packaging_api import rv
from workspace_access import DEFAULTS

router=APIRouter(prefix='/api/business-records',tags=['Business records'])

@dataclass(frozen=True)
class Target:
    table:str
    page:str
    label:str
    keys:tuple[str,...]
    stage:str|None=None

# Deliberately exclude Admin-maintained units, categories, losses, ports,
# container types, currencies, markets, users, roles and all immutable snapshots.
TARGETS={
 'customers':Target('Customer','customers','CustomerName',('CustomerID',)),
 'products':Target('Product','products','ProductName',('ProductID','ParentProductID','ChildProductID')),
 'materials':Target('PackagingMaterial','materials','MaterialName',('MaterialID','PackagingMaterialID','PalletMaterialID','ResponsePalletMaterialID')),
 'prices':Target('PackagingPrice','prices','ID',('PriceID','PackagingPriceID')),
 'raw-materials':Target('RawMaterial','raw-materials','MaterialName',('RawMaterialID','MaterialID')),
 'raw-prices':Target('RawMaterialPrice','raw-prices','ID',('PriceID','RawMaterialPriceID')),
 'raw-grades':Target('RawGrade','raw-grades','GradeName',('RawGradeID','GradeID')),
 'vendors':Target('Vendor','vendors','VendorName',('VendorID',)),
 'packaging-types':Target('PackagingType','packaging-types','PackagingType',('PackagingTypeID','PrimaryTypeID','SecondaryTypeID','TertiaryTypeID','QuaternaryTypeID','TypeID')),
 'packaging-dimensions':Target('PackagingDimension','packaging-dimensions','ID',('DimensionID','ParentDimensionID','MaterialDimensionID','SupplierDimensionID')),
 'pallets':Target('Pallet','pallets','ID',('PalletID','LegacyPalletID')),
 'conversions':Target('UnitConversion','conversions','ID',('ConversionID','UnitConversionID')),
 'opportunities':Target('Opportunity','opportunities','OpportunityNumber',('OpportunityID',),'Draft'),
 'opportunity-items':Target('OpportunityItem','opportunities','ItemDescription',('OpportunityItemID',),'Draft'),
 'requests':Target('PackagingConfigurationRequest','requests','RequestNumber',('RequestID',)),
 'request-items':Target('PackagingConfigurationRequestItem','requests','ProductName',('RequestItemID','ResponseItemID'),'Assigned'),
}

class DeleteRecord(BaseModel):
    model_config=ConfigDict(extra='forbid')
    ID:int=Field(ge=1)
    RowVersion:str=Field(min_length=1,max_length=24)

def quote(value):
    return '['+value.replace(']',']]')+']'

def editable(ctx,target):
    if ctx.is_admin:return True
    if ctx.permissions is not None:return ctx.permissions.get(target.page)=='edit'
    return any(DEFAULTS.get(scope,{}).get(target.page)=='edit' for scope in ctx.scopes)

def row_dict(cur):
    row=cur.fetchone()
    return dict(zip([c[0] for c in cur.description],row)) if row else None

def same_id(value,identity):
    # Booleans and fractional identifiers must never be treated as record IDs.
    if isinstance(value,(bool,dict,list)) or value is None:return False
    try:return Decimal(str(value))==identity
    except InvalidOperation:return False

def json_reference(value,target,identity):
    if isinstance(value,str) and value.lstrip().startswith(('{','[')):
        try:return json_reference(json.loads(value),target,identity)
        except (ValueError,TypeError):raise HTTPException(409,'Cannot verify a nested business snapshot. Deletion is blocked.')
    if isinstance(value,list):return any(json_reference(v,target,identity) for v in value)
    if not isinstance(value,dict):return False
    if target.table=='RawGrade' and isinstance(value.get('NutsGrade'),list):
        if any(isinstance(g,list) and len(g)==2 and same_id(g[1],identity) for g in value['NutsGrade']):return True
    keys={k.casefold() for k in target.keys}
    if any(k.casefold() in keys and same_id(v,identity) for k,v in value.items()):return True
    # Historical captures also embed full objects with a generic ID.
    if same_id(value.get('ID'),identity):
        if target.table=='PackagingDimension' and any(k in value for k in ('D1Name','ConvertFromParentFormula','OccupiedM2Formula')):return True
        if target.table in ('PackagingPrice','RawMaterialPrice') and 'UnitPrice' in value and 'MaterialCode' in value:return True
        if target.table=='Product' and 'ProductCode' in value:return True
        if target.table=='Customer' and 'CustomerName' in value:return True
        if target.table=='Vendor' and 'VendorName' in value and 'UnitPrice' not in value:return True
        if target.table in ('PackagingMaterial','RawMaterial') and 'MaterialCode' in value and 'UnitPrice' not in value:return True
        if target.table=='RawGrade' and 'GradeName' in value:return True
        if target.table=='Pallet' and 'PalletSize' in value and 'MaterialCode' not in value:return True
        if target.table=='PackagingType' and 'PackagingType' in value and 'MaterialCode' not in value:return True
        if target.table=='UnitConversion' and 'Factor' in value:return True
    return any(json_reference(v,target,identity) for v in value.values())

def assert_no_references(cur,target,identity,locked=True,json_cache=None,identities=()):
    hint=' WITH(UPDLOCK,HOLDLOCK)' if locked else ''
    cur.execute("""SELECT s.name,t.name,c.name,rc.name
        FROM sys.foreign_key_columns f
        JOIN sys.tables t ON t.object_id=f.parent_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
        JOIN sys.columns c ON c.object_id=f.parent_object_id AND c.column_id=f.parent_column_id
        JOIN sys.columns rc ON rc.object_id=f.referenced_object_id AND rc.column_id=f.referenced_column_id
        WHERE f.referenced_object_id=OBJECT_ID(?)""",'dbo.'+target.table)
    references=cur.fetchall()
    for schema,table,column,referenced in references:
        # Type-order rows are the type's own multi-value attribute, not another
        # business record. They are the sole explicitly owned cleanup below.
        if target.table=='PackagingType' and schema=='dbo' and table=='PackagingTypeOrder' and column=='PackagingTypeID':continue
        if target.table=='OpportunityItem' and schema=='dbo' and table=='OpportunityTCBVersion' and column=='ItemID':
            if not cur.execute("SELECT 1 FROM dbo.OpportunityTCBVersion"+hint+" WHERE ItemID=? AND (Version<>1 OR SavedJSON<>N'{}' OR ContextJSON IS NOT NULL)",identity).fetchone():continue
        if referenced!='ID':raise HTTPException(409,'This record has an unsupported reference definition; deletion is blocked.')
        found=cur.execute('SELECT TOP(1) 1 FROM '+quote(schema)+'.'+quote(table)+
            hint+' WHERE '+quote(column)+'=?',identity).fetchone()
        if found:raise HTTPException(409,'Cannot delete: referenced by '+table+'.')
    # Read-only batches scan saved JSON once, not once per icon. Final deletion
    # keeps its transaction locks and independently rechecks all references.
    cached=json_cache is not None and 'blocked' in json_cache
    if cached:
        if identity in json_cache['blocked']:raise HTTPException(409,'Cannot delete: referenced by saved business data.')
    else:
        blocked=set()
        candidates=tuple(identities) if json_cache is not None else (identity,)
        cur.execute("""SELECT s.name,t.name,c.name FROM sys.columns c
            JOIN sys.tables t ON t.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
            WHERE s.name='dbo' AND (c.name LIKE '%JSON' OR c.name IN
            ('ShipmentCostInfo','TCBCostInfo','ProductGradeSnapshot','ProductMixSnapshot','ProductLossSnapshot','LossProcesses','Inputs','Result'))
            AND t.name NOT IN ('WorkbenchPreference','BusinessDeletionAudit')
            ORDER BY t.name,c.column_id""")
        sources=cur.fetchall()
        for schema,table,column in sources:
            cur.execute('SELECT '+quote(column)+' FROM '+quote(schema)+'.'+quote(table)+
                hint+' WHERE '+quote(column)+' IS NOT NULL')
            while True:
                rows=cur.fetchmany(100)
                if not rows:break
                for row in rows:
                    if not row[0]:continue
                    try:value=json.loads(row[0])
                    except (ValueError,TypeError):
                        raise HTTPException(409,'Cannot verify references: invalid saved business JSON in '+table+'.')
                    for candidate in candidates:
                        if candidate not in blocked and json_reference(value,target,candidate):blocked.add(candidate)
        if json_cache is not None:json_cache['blocked']=blocked
        if identity in blocked:raise HTTPException(409,'Cannot delete: referenced by saved business data.')
    if target.table=='PackagingType':
        name=cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',identity).fetchval()
        if cur.execute(f"""SELECT TOP(1) 1 FROM dbo.PackagingConfigurationRequestItem {hint}
            WHERE FirstPMType=? OR SecondPMType=? OR ThirdPMType=? OR PrimaryTypeName=? OR SecondaryTypeName=? OR TertiaryTypeName=?""",
            *([name]*6)).fetchone():raise HTTPException(409,'Cannot delete: packaging type is used in a response.')
    if target.table=='Pallet':
        size=cur.execute('SELECT PalletSize FROM dbo.v_PalletMaster WHERE ID=?',identity).fetchval()
        if size:
            for table,columns in (('OpportunityItem',('PalletSize',)),('PackagingConfigurationRequestItem',('PalletSize','ResponsePalletSize'))):
                predicate=' OR '.join(quote(c)+'=?' for c in columns)
                if cur.execute('SELECT TOP(1) 1 FROM dbo.'+quote(table)+hint+' WHERE '+predicate,*([size]*len(columns))).fetchone():
                    raise HTTPException(409,'Cannot delete: pallet footprint is used in a transaction.')
    if target.table=='PackagingConfigurationRequestItem':
        for table,column in (('NutGradeDensity','SourceResponseItemID'),('NutGradeDensityHistory','ResponseItemID')):
            if cur.execute('SELECT TOP(1) 1 FROM dbo.'+quote(table)+hint+' WHERE '+quote(column)+'=?',identity).fetchone():
                raise HTTPException(409,'Cannot delete: referenced by grade density history.')
    if target.table=='PackagingDimension':
        for table in ('PackagingDimensionInheritanceLog','PackagingFormulaRoleMigrationLog'):
            if cur.execute('SELECT TOP(1) 1 FROM dbo.'+quote(table)+hint+' WHERE DimensionID=?',identity).fetchone():
                raise HTTPException(409,'Cannot delete: dimension has immutable migration history.')

def assert_unprocessed(cur,target,row,ctx,locked=True):
    hint=' WITH(UPDLOCK,HOLDLOCK)' if locked else ''
    if target.stage and row.get('Stage')!=target.stage:
        raise HTTPException(409,'Only unprocessed '+target.stage+' records may be deleted.')
    if target.table in ('Opportunity','OpportunityItem','PackagingConfigurationRequest','PackagingConfigurationRequestItem'):
        owner=row.get('RequestedBy') if target.table=='PackagingConfigurationRequest' else row.get('CreatedBy')
        if target.table=='PackagingConfigurationRequestItem':
            owner=cur.execute('SELECT RequestedBy FROM dbo.PackagingConfigurationRequest'+hint+' WHERE ID=?',row['RequestID']).fetchval()
            if any(row.get(k) is not None for k in ('PICUserID','SubmittedAt','SubmittedBy','ReviewedAt','ReviewedBy','LoadPlanID','PalletPricingID')):
                raise HTTPException(409,'Assigned, submitted, reviewed or calculated responses cannot be deleted.')
        if not ctx.is_admin and owner!=ctx.user_id:raise HTTPException(403,'Only the transaction creator or Admin may delete it.')
        # History/logs are deliberately retained; a reverted draft is processed.
        checks={
          'Opportunity':('OpportunityChangeLog','OpportunityID'),
          'OpportunityItem':('OpportunityChangeLog','ItemID'),
          'PackagingConfigurationRequest':('PackagingRequestChangeLog','RequestID'),
          'PackagingConfigurationRequestItem':('PackagingRequestChangeLog','ItemID')}
        table,column=checks[target.table]
        if cur.execute('SELECT TOP(1) 1 FROM dbo.'+quote(table)+hint+' WHERE '+quote(column)+
            """=? AND Action='Update' AND
            ((FieldName='Stage' AND (COALESCE(OldValue,'') NOT IN ('','Draft','Open','Assigned') OR COALESCE(NewValue,'') NOT IN ('','Draft','Open','Assigned')))
            OR (FieldName IN ('PIC','PICUserID','SubmittedAt','SubmittedBy','ReviewedAt','ReviewedBy')
                AND (NULLIF(OldValue,'') IS NOT NULL OR NULLIF(NewValue,'') IS NOT NULL)))""",row['ID']).fetchone():
            raise HTTPException(409,'Cannot delete: transaction has processing/change history.')
    if target.table=='UnitConversion' and (row.get('IsAutoGenerated') or row.get('ReverseConversionID') is not None):
        raise HTTPException(409,'Generated or paired conversions cannot be deleted.')
    if target.table=='UnitConversion' and row.get('PackagingMaterialID') is None and row.get('RawMaterialID') is None:
        raise HTTPException(403,'General conversions are Admin master data and excluded.')
    if target.table=='UnitConversion' and not ctx.is_admin:
        page='materials' if row.get('PackagingMaterialID') is not None else 'raw-materials'
        if not editable(ctx,Target('',page,'',())):raise HTTPException(403,'No edit access to this material conversion.')

def eligible_record(cur,entity,body,ctx,locked=True,json_cache=None,identities=()):
    hint=' WITH(UPDLOCK,HOLDLOCK)' if locked else ''
    target=TARGETS.get(entity)
    if not target:raise HTTPException(404,'Deletion is not available for this module.')
    if not editable(ctx,target):raise HTTPException(403,'Edit access is required to delete this business record.')
    actor=cur.execute('SELECT ID FROM dbo.Users'+(' WITH(HOLDLOCK)' if locked else '')+' WHERE ID=? AND UserName=? AND IsActive=1',ctx.user_id,ctx.username).fetchval()
    if actor is None:raise HTTPException(403,'An active authenticated user is required.')
    version=rv(body.RowVersion,True)
    cur.execute('SELECT * FROM dbo.'+quote(target.table)+hint+' WHERE ID=?',body.ID)
    row=row_dict(cur)
    if not row:raise HTTPException(404,'Record no longer exists. Refresh the page.')
    if bytes(row['RowVersion'])!=version:raise HTTPException(409,'Record changed. Refresh before deleting.')
    assert_unprocessed(cur,target,row,ctx,locked)
    assert_no_references(cur,target,body.ID,locked,json_cache,identities)
    return target,row,actor,version

def delete_record(cur,entity,body,ctx):
    target,row,actor,version=eligible_record(cur,entity,body,ctx)
    label=str(row.get(target.label) or body.ID)[:250]
    cur.execute('INSERT dbo.BusinessDeletionAudit(EntityKey,RecordID,DeletedRowVersion,RecordLabel,DeletedBy) VALUES(?,?,?,?,?)',
        entity,body.ID,version,label,actor)
    if target.table=='PackagingType':
        cur.execute('DELETE dbo.PackagingTypeOrder WHERE PackagingTypeID=?',body.ID)
    if target.table=='OpportunityItem' and cur.execute("SELECT OBJECT_ID('dbo.OpportunityTCBVersion','U')").fetchval():
        cur.execute("DELETE dbo.OpportunityTCBVersion WHERE ItemID=? AND Version=1 AND SavedJSON=N'{}' AND ContextJSON IS NULL",body.ID)
    cur.execute('DELETE FROM dbo.'+quote(target.table)+' WHERE ID=? AND RowVersion=?',body.ID,version)
    # Triggers may emit result sets or NOCOUNT, so do not rely on rowcount.
    if cur.execute('SELECT 1 FROM dbo.'+quote(target.table)+' WHERE ID=?',body.ID).fetchone():
        raise HTTPException(409,'Record was not deleted. Refresh before retrying.')
    return {'deleted':True,'ID':body.ID}

class EligibilityBatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
    rows:list[DeleteRecord]=Field(min_length=1,max_length=50)

@router.post('/{entity}/eligibility')
def eligibility(entity:str,body:EligibilityBatch,ctx:AccessContext=Depends(get_access_context)):
    target=TARGETS.get(entity)
    if not target or not editable(ctx,target):
        return {'rows':[dict(ID=row.ID,RowVersion=row.RowVersion,available=False) for row in body.rows]}
    result=[];cache={};identities=tuple(row.ID for row in body.rows)
    try:
        with get_raw_cursor() as cur:
            for row in body.rows:
                available=False
                try:
                    eligible_record(cur,entity,row,ctx,locked=False,json_cache=cache,identities=identities)
                    available=True
                except HTTPException:
                    pass
                result.append(dict(ID=row.ID,RowVersion=row.RowVersion,available=available))
    except Exception as exc:
        raise HTTPException(503,'Deletion availability could not be verified.') from exc
    return {'rows':result}

@router.post('/{entity}/delete')
def delete(entity:str,body:DeleteRecord,ctx:AccessContext=Depends(get_access_context)):
    try:
        with get_raw_cursor() as cur:
            cur.execute('SET XACT_ABORT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
            try:
                result=delete_record(cur,entity,body,ctx)
                cur.execute('COMMIT')
                return result
            except Exception:
                cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
                raise
    except HTTPException:raise
    except Exception as exc:
        # Never expose database names, SQL text or raw exceptions.
        raise HTTPException(409,'Deletion could not be completed. Refresh; the record may be referenced or changed.') from exc
