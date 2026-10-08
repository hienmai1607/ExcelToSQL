"""Packaging Excel endpoints. SQL remains authoritative for permissions/state."""
import base64
import binascii
import json
import logging
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, computed_field
from auth import AccessContext, get_access_context
from db import get_raw_cursor
from packaging_fields import ResponseFields, enriched_response, sql_error
from pkg_pricing import Calculation

router = APIRouter(prefix='/api/packaging', tags=['Packaging'])
log = logging.getLogger(__name__)

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')

class MasterRow(Input):
    RowNum: int = Field(ge=1)
    Command: Literal['C', 'U', 'D']
    ID: int | None = Field(None, ge=1)
    RowVersion: str | None = None

class MaterialRow(MasterRow):
    MaterialCode: str | None = Field(None, max_length=40)
    MaterialName: str | None = Field(None, max_length=200)
    Description: str | None = Field(None, max_length=500)
    UnitOfMeasure: str | None = Field(None, max_length=20)
    Status: Literal['Active', 'Block'] | None = None

class PackagingMaterialRow(MaterialRow):
    PackagingTypeID: int | None = Field(None, ge=1)

    @computed_field
    @property
    def PackagingTypeSet(self) -> bool:
        return "PackagingTypeID" in self.model_fields_set

class UoMRow(MasterRow):
    UoMCode: str | None = Field(None, max_length=40)
    UoMName: str | None = Field(None, max_length=500)
    Status: Literal["Active", "Block"] | None = None

class UoMBatch(Input):
    rows: list[UoMRow] = Field(min_length=1,max_length=500)

class VendorRow(MasterRow):
    CurrencyID: int | None = Field(None, ge=1)
    VendorName: str | None = Field(None, max_length=200)
    Address: str | None = Field(None, max_length=500)
    Status: Literal["Active", "Block"] | None = None

class VendorBatch(Input):
    rows: list[VendorRow] = Field(min_length=1,max_length=500)

class PriceRow(MasterRow):
    ExchangeRateToUSD: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=10)
    VendorID: int | None = Field(None, ge=1)
    MaterialID: int | None = Field(None, ge=1)
    CurrencyID: int | None = Field(None, ge=1)
    BaseUoM: str | None = Field(None, max_length=40)
    PriceBasis: str | None = Field(None, max_length=40)
    QuantityFrom: Decimal | None = Field(None, ge=0, max_digits=18, decimal_places=4)
    QuantityTo: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=4)
    UnitPrice: Decimal | None = Field(None, ge=0, max_digits=18, decimal_places=4)
    EffectiveFrom: date | None = None
    EffectiveTo: date | None = None
    Status: Literal['Active', 'Block'] | None = None

class ResponseRow(Input, ResponseFields):
    PricingCalculations: list[Calculation] | None = Field(None, max_length=3)

    @field_validator('PricingCalculations')
    @classmethod
    def distinct_pricing_orders(cls, value):
        if value and len({c.PackagingOrder for c in value}) != len(value):
            raise ValueError('Only one calculation per packaging order is allowed.')
        return value

    RowNum: int = Field(ge=1)
    ID: int = Field(ge=1)
    MaterialID: int | None = Field(None, ge=1)
    HeightMM: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    WidthMM: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    LengthMM: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    Cost: Decimal | None = Field(None, ge=0, max_digits=18, decimal_places=4)
    CurrencyID: int | None = Field(None, ge=1)
    CostBasis: str | None = Field(None, max_length=40)
    ResponseNotes: str | None = Field(None, max_length=1000)
    RowVersion: str

class MaterialBatch(Input):
    rows: list[PackagingMaterialRow] = Field(min_length=1, max_length=500)

class PriceBatch(Input):
    rows: list[PriceRow] = Field(min_length=1, max_length=500)

class PackagingPriceRow(PriceRow):
    SupplierDimensionID: int | None = Field(None, ge=1)
    SupplierDimensionRowVersion: str | None = None
    SupplierD1: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    SupplierD2: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    SupplierD3: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)

class PackagingPriceBatch(Input):
    rows: list[PackagingPriceRow] = Field(min_length=1, max_length=500)

class ResponseBatch(Input):
    rows: list[ResponseRow] = Field(min_length=1, max_length=500)

class Selection(Input):
    OpportunityItemID: int = Field(ge=1)
    ExpectedRowVersion: str
    PackagingRequirement: str | None = Field(None, max_length=1000)

class ManualRequest(Input):
    OpportunityID: int = Field(ge=1)
    ExpectedRowVersion: str
    CreationKey: UUID
    ResponseDue: date
    RequestNotes: str | None = Field(None, max_length=1000)
    items: list[Selection] = Field(min_length=1, max_length=10000)

    @field_validator('items')
    @classmethod
    def distinct_items(cls, items):
        if len({r.OpportunityItemID for r in items}) != len(items):
            raise ValueError('Duplicate Opportunity item selections.')
        return items

class Assignment(Input):
    PICUserID: int = Field(ge=1)
    ExpectedRowVersion: str

class Transition(Input):
    ExpectedRowVersion: str
    TargetStage: Literal['Working', 'Pending Review', 'Approved', 'Returned', 'Canceled']
    Comment: str | None = Field(None, max_length=1000)

def require(ctx, *scopes):
    if ctx.is_admin:
        return
    if not ctx.scopes.intersection(scopes):
        raise HTTPException(403, f'{scopes[0]} access is required for this action.')

def rv(value, required=True):
    if not value:
        if required:
            raise HTTPException(422, 'ID and RowVersion are required; refresh first.')
        return None
    try:
        decoded = base64.b64decode(value, validate=True)
        if len(decoded) != 8:
            raise ValueError()
        return decoded
    except (ValueError, binascii.Error):
        raise HTTPException(422, 'RowVersion must be base64 encoding of exactly 8 bytes.')

def execute(sql, params):
    try:
        with get_raw_cursor() as cur:
            cur.execute(sql, *params)
            sets = []
            while True:
                if cur.description:
                    names = [d[0] for d in cur.description]
                    rows = []
                    for record in cur.fetchall():
                        row = dict(zip(names, record))
                        for key, value in row.items():
                            if isinstance(value, (bytes, bytearray)):
                                row[key] = base64.b64encode(value).decode('ascii')
                        rows.append(row)
                    sets.append(rows)
                if not cur.nextset():
                    break
            return sets
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        detail = sql_error(exc)
        if detail:
            raise HTTPException(403 if '52998' in message else 409 if any(code in message for code in ('52952','52958','52997')) else 422, detail) from exc
        if '51101' in message:
            raise HTTPException(401, 'Username is incorrect.') from exc
        if '51125' in message:
            raise HTTPException(409, 'An Opportunity item already has an active Packaging Request. Complete (approve) or cancel that request item before creating another. Refresh Opportunities to see the current request.') from exc
        if any(code in message for code in ('51102', '51130', '51133')):
            raise HTTPException(403, 'Required Packaging role or PIC ownership is missing.') from exc
        if any(code in message for code in ('51108', '51122', '51123', '51124', '51125', '51127', '51128', '1205')):
            raise HTTPException(409, 'Conflict: refresh and check ownership/stage. For a manual request retry, use the same CreationKey.') from exc
        if any(str(code) in message for code in range(51103, 51138)) or any(code in message for code in ('(547)', '(2627)', '(2601)')):
            raise HTTPException(422, 'SQL rejected the values or workflow state. Check required fields, active references, dates and stage.') from exc
        log.exception('Packaging SQL request failed')
        raise HTTPException(500, 'Packaging database operation failed; contact support.') from exc

# Static schemas preserve NULL without pyodbc nullable-TVP inference/sentinel values.
MATERIAL = [('RowNum','INT'),('Command','CHAR(1)'),('ID','INT'),('MaterialCode','NVARCHAR(40)'),('MaterialName','NVARCHAR(200)'),('Description','NVARCHAR(500)'),('UnitOfMeasure','NVARCHAR(20)'),('Status','VARCHAR(10)'),('RowVersionB64','VARCHAR(18)')]
PRICE = [('RowNum','INT'),('Command','CHAR(1)'),('ID','INT'),('MaterialID','INT'),('CurrencyID','INT'),('PriceBasis','NVARCHAR(40)'),('QuantityFrom','DECIMAL(18,4)'),('QuantityTo','DECIMAL(18,4)'),('UnitPrice','DECIMAL(18,4)'),('EffectiveFrom','DATE'),('EffectiveTo','DATE'),('Status','VARCHAR(10)'),('RowVersionB64','VARCHAR(18)')]
RESPONSE = [('RowNum','INT'),('ID','INT'),('MaterialID','INT'),('HeightMM','DECIMAL(12,2)'),('WidthMM','DECIMAL(12,2)'),('LengthMM','DECIMAL(12,2)'),('Cost','DECIMAL(18,4)'),('CurrencyID','INT'),('CostBasis','NVARCHAR(40)'),('ResponseNotes','NVARCHAR(1000)'),('RowVersionB64','VARCHAR(18)')]
SELECTION = [('OpportunityItemID','INT'),('ExpectedRowVersion','VARCHAR(18)'),('PackagingRequirement','NVARCHAR(1000)')]

def tvp_sql(type_name, fields):
    columns = ','.join(f'[{name}] {kind}' for name, kind in fields)
    values = ','.join(f'CONVERT(VARBINARY(8),[{name}],1)' if name in ('RowVersionB64','ExpectedRowVersion','SupplierDimensionRowVersion') else f'[{name}]' for name, _ in fields)
    return f'DECLARE @Rows dbo.{type_name}; INSERT @Rows SELECT {values} FROM OPENJSON(?) WITH ({columns}); '

def batch(payload, ctx, type_name, proc, fields, scope="Packaging", document_extra=None):
    require(ctx, scope)
    documents = []
    seen = set()
    for r in payload.rows:
        data = r.model_dump(mode='json')
        if r.ID is not None:
            if r.ID in seen:
                raise HTTPException(422, 'Duplicate record IDs in batch.')
            seen.add(r.ID)
        version = rv(data.pop('RowVersion'), getattr(r, 'Command', 'U') != 'C')
        if getattr(r, 'Command', 'U') != 'C' and r.ID is None:
            raise HTTPException(422, 'Update/block requires ID.')
        data['RowVersionB64'] = '0x'+version.hex() if version else None
        if document_extra:
            data.update(document_extra.get(r.RowNum, {}))
        documents.append(data)
    if len({r.RowNum for r in payload.rows}) != len(payload.rows):
        raise HTTPException(422, 'Duplicate RowNum values.')
    result = execute(tvp_sql(type_name, fields)+f'EXEC dbo.{proc} @Rows,?;', [json.dumps(documents),ctx.username])
    return {'results': result[0]}

@router.post('/material/batch')
def material_save(payload: MaterialBatch, ctx: AccessContext = Depends(get_access_context)):
    return batch(payload,ctx,'PackagingMaterialBatchTypeV2','usp_PackagingMaterial_BatchV2',
                 MATERIAL+[('PackagingTypeID','INT'),('PackagingTypeSet','BIT')])

@router.post('/price/batch')
def price_save(payload: PackagingPriceBatch, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging')
    for row in payload.rows:
        if 'BaseUoM' in row.model_fields_set:
            if row.PriceBasis is not None and row.PriceBasis != row.BaseUoM:
                raise HTTPException(422,'Conflicting Base UoM values.')
            row.PriceBasis=row.BaseUoM
    missing=[r.ID for r in payload.rows if r.Command!='C' and r.ID and 'VendorID' not in r.model_fields_set]
    if missing:
        current=execute("DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Maintain',@Actor OUTPUT; SELECT ID,VendorID FROM dbo.PackagingPrice WHERE ID IN(SELECT value FROM OPENJSON(?))",[ctx.username,json.dumps(missing)])[0]
        vendors={r['ID']:r['VendorID'] for r in current}
        for row in payload.rows:
            if row.ID in vendors and 'VendorID' not in row.model_fields_set: row.VendorID=vendors[row.ID]
    missing_rates=[r.ID for r in payload.rows if r.Command!='C' and r.ID and 'ExchangeRateToUSD' not in r.model_fields_set]
    if missing_rates:
        current=execute("DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Maintain',@Actor OUTPUT; SELECT ID,CurrencyID,ExchangeRateToUSD FROM dbo.PackagingPrice WHERE ID IN(SELECT value FROM OPENJSON(?))",[ctx.username,json.dumps(missing_rates)])[0]
        existing={r['ID']:r for r in current}
        for row in payload.rows:
            if row.ID in existing and 'ExchangeRateToUSD' not in row.model_fields_set and row.CurrencyID==existing[row.ID]['CurrencyID']:
                row.ExchangeRateToUSD=existing[row.ID]['ExchangeRateToUSD']
    from supplier_geometry import SUPPLIER_FIELDS, supplier_area
    extra = {}
    for row in payload.rows:
        supplied = bool((set(SUPPLIER_FIELDS) | {'SupplierDimensionRowVersion'}) & row.model_fields_set)
        extra[row.RowNum] = {'SupplierSet': supplied}
        if row.Command == 'D' or not supplied:
            continue
        dimension_id = getattr(row, 'SupplierDimensionID', None)
        measurements = {k: getattr(row, 'Supplier'+k, None) for k in ('D1','D2','D3')}
        if dimension_id is None:
            if any(v is not None for v in measurements.values()) or getattr(row, 'SupplierDimensionRowVersion', None):
                raise HTTPException(422, 'Supplier measurements require a child dimension definition.')
            continue
        definitions = execute("""DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Maintain',@Actor OUTPUT;
            SELECT d.*,d.EffectiveSquareMeterFormula,
             u1.Status AS D1UnitStatus,u2.Status AS D2UnitStatus,u3.Status AS D3UnitStatus
            FROM dbo.v_PackagingDimensionWeb d JOIN dbo.PackagingMaterial m ON m.PackagingTypeID=d.PackagingTypeID
            JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
            JOIN dbo.PackagingDimension parent ON parent.ID=d.ParentDimensionID
            JOIN dbo.UoM u1 ON u1.ID=d.D1UoMID LEFT JOIN dbo.UoM u2 ON u2.ID=d.D2UoMID LEFT JOIN dbo.UoM u3 ON u3.ID=d.D3UoMID
            WHERE d.ID=? AND m.ID=? AND d.Status='Active' AND parent.Status='Active'
             AND t.Status='Active' AND t.ParentTypeID IS NOT NULL;""", [ctx.username, dimension_id, row.MaterialID])[0]
        if not definitions:
            raise HTTPException(422, 'Choose an active child dimension belonging to the selected material.')
        definition = definitions[0]
        version = rv(getattr(row, 'SupplierDimensionRowVersion', None), True)
        if definition['RowVersion'] != base64.b64encode(version).decode('ascii'):
            raise HTTPException(409, 'Supplier formula changed. Refresh pricing before saving.')
        try:
            area = supplier_area(definition, measurements)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        extra[row.RowNum].update(SupplierDimensionRowVersion='0x'+version.hex(), SupplierAreaPerPriceUnit=str(area))
    supplier_columns = [('SupplierDimensionID','INT'),('SupplierDimensionRowVersion','VARCHAR(18)'),
        ('SupplierD1','DECIMAL(18,6)'),('SupplierD2','DECIMAL(18,6)'),('SupplierD3','DECIMAL(18,6)'),
        ('SupplierAreaPerPriceUnit','DECIMAL(28,9)'),('SupplierSet','BIT')]
    return batch(payload,ctx,'PackagingPriceBatchTypeV4','usp_PackagingPrice_BatchV5',
        PRICE+[('VendorID','INT'),('ExchangeRateToUSD','DECIMAL(18,10)')]+supplier_columns, document_extra=extra)

@router.post('/response/batch')
def response_save(payload: ResponseBatch, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging')
    return enriched_response(payload,ctx)

def paged(sql, params, page, page_size):
    rows = execute(sql,params)[0]
    return {'rows':rows,'page':page,'page_size':page_size,'total':int(rows[0]['TotalMatchingRows']) if rows else 0}

@router.get('/material')
def material_read(page: int = Query(1,ge=1), page_size: int = Query(200,ge=1,le=500),
                  search: str | None = None, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging','PackagingManager','Admin')
    return paged('EXEC dbo.usp_PackagingMaterial_Read ?,?,NULL,?,?', [ctx.username,search,page,page_size],page,page_size)

@router.get('/price')
def price_read(page: int = Query(1,ge=1), page_size: int = Query(200,ge=1,le=500),
               ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging','PackagingManager','Admin')
    return paged('EXEC dbo.usp_PackagingPrice_Read ?,NULL,NULL,NULL,NULL,NULL,?,?', [ctx.username,page,page_size],page,page_size)

@router.get('/requests')
def request_read(page: int = Query(1,ge=1), page_size: int = Query(200,ge=1,le=500),
                 stage: str | None = None, opportunity_number: str | None = None,
                 request_id: int | None = Query(None, ge=1),
                 ctx: AccessContext = Depends(get_access_context),
                 sort: str | None = Query(None,max_length=2000)):
    require(ctx,'Packaging','PackagingManager','Opportunity','Admin')
    if isinstance(sort,str):
        from request_views import item_read
        return item_read(ctx.username,request_id,page,page_size,stage,opportunity_number,sort)
    return paged('EXEC dbo.usp_PackagingRequest_Grid_Read @Username=?,@Stage=?,@PageSize=?,@PageNumber=?,@OpportunityNumber=?,@RequestID=?',
                 [ctx.username,stage,page_size,page,opportunity_number,request_id],page,page_size)

@router.get('/manual')
def manual_read(page: int = Query(1,ge=1), page_size: int = Query(200,ge=1,le=500),
                opportunity_number: str | None = None, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Opportunity','Admin')
    return paged('EXEC dbo.usp_PackagingManualSource_Read ?,?,?,?', [ctx.username,opportunity_number,page,page_size],page,page_size)

@router.get('/lookups')
def lookups(ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging','PackagingManager','Admin')
    results=execute('EXEC dbo.usp_PackagingWorkbookLookup_Read ?', [ctx.username])
    types=execute('EXEC dbo.usp_PackagingResponseTypeLookup_Read ?', [ctx.username])[0]
    from packaging_orders import decode_orders
    decode_orders(types)
    pallets=execute("SELECT p.ID,p.PalletSize,p.PalletAreaMM2,c.PalletsPer20DC,c.PalletsPer40DC,c.PalletsPer40HC,c.PalletsPer20RC,c.PalletsPer40RHC FROM dbo.v_PalletMaster p JOIN dbo.Pallet c ON c.ID=p.ID JOIN dbo.UoM u ON u.ID=p.UoMID WHERE p.Status='Active' AND u.Status='Active' ORDER BY p.PalletSize,p.ID",[])[0]
    return {'materials':results[0],'currencies':results[1],'packagingTypes':types,'pallets':pallets}

@router.post('/manual')
def manual_create(payload: ManualRequest, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Opportunity','Admin')
    # Reconcile lost replies using the same key; never create a second document.
    existing=execute('EXEC dbo.usp_PackagingRequest_Replay_Read ?,?', [ctx.username,str(payload.CreationKey)])
    if existing[0]:
        h=existing[0][0]
        expected={r.OpportunityItemID:(r.PackagingRequirement or '') for r in payload.items}
        actual={r['OpportunityItemID']:(r['PackagingRequirement'] or '') for r in existing[1]}
        if h['OpportunityID']!=payload.OpportunityID or h['ResponseDue']!=payload.ResponseDue or (h['RequestNotes'] or '')!=(payload.RequestNotes or '') or expected!=actual:
            raise HTTPException(409,'CreationKey already belongs to a different request payload.')
        return {'header':h,'items':existing[1],'replayed':True}
    documents=[]
    for r in payload.items:
        data=r.model_dump(mode='json')
        data['ExpectedRowVersion']='0x'+rv(r.ExpectedRowVersion).hex()
        documents.append(data)
    sql='EXEC dbo.usp_PackagingRequest_CreateJson ?,?,?,?,?,?,?'
    results=execute(sql,[json.dumps(documents),ctx.username,payload.OpportunityID,rv(payload.ExpectedRowVersion),str(payload.CreationKey),payload.ResponseDue,payload.RequestNotes])
    return {'header':results[0][0],'items':results[1],'replayed':False}

@router.post('/items/{item_id}/assign')
def assign(item_id: int, payload: Assignment, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'PackagingManager')
    return {'result':execute('EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?', [ctx.username,item_id,payload.PICUserID,rv(payload.ExpectedRowVersion)])[0][0]}

@router.post('/items/{item_id}/transition')
def transition(item_id: int, payload: Transition, ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging' if payload.TargetStage in ('Working','Pending Review') else 'PackagingManager')
    return {'result':execute('EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,?,?', [ctx.username,item_id,rv(payload.ExpectedRowVersion),payload.TargetStage,payload.Comment])[0][0]}

@router.post("/vendor/batch")
def vendor_save(payload:VendorBatch,ctx:AccessContext=Depends(get_access_context)):
    fields=[("RowNum","INT"),("Command","CHAR(1)"),("ID","INT"),("VendorName","NVARCHAR(200)"),("Address","NVARCHAR(500)"),("Status","VARCHAR(10)"),("RowVersionB64","VARCHAR(18)")]
    missing=[r.ID for r in payload.rows if r.Command!='C' and r.ID and 'CurrencyID' not in r.model_fields_set]
    if missing:
        current=execute("DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Maintain',@Actor OUTPUT; SELECT ID,CurrencyID FROM dbo.Vendor WHERE ID IN(SELECT value FROM OPENJSON(?))",[ctx.username,json.dumps(missing)])[0]
        currencies={r['ID']:r['CurrencyID'] for r in current}
        for row in payload.rows:
            if row.ID in currencies and 'CurrencyID' not in row.model_fields_set: row.CurrencyID=currencies[row.ID]
    return batch(payload,ctx,"VendorBatchTypeV2","usp_Vendor_BatchV2",fields+[('CurrencyID','INT')])

@router.post("/uom/batch")
def uom_save(payload:UoMBatch,ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Admin")
    fields=[("RowNum","INT"),("Command","CHAR(1)"),("ID","INT"),("UoMCode","NVARCHAR(40)"),("UoMName","NVARCHAR(500)"),("Status","VARCHAR(10)"),("RowVersionB64","VARCHAR(18)")]
    return batch(payload,ctx,"UoMBatchType","usp_UoM_Batch",fields)
