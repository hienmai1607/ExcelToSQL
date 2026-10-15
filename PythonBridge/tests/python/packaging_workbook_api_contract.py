'''Packaging API smoke contract against test; all fixtures are rolled back.'''
import sys
import uuid
import asyncio
import os
import tempfile
import json as jsonlib
from types import SimpleNamespace
from urllib.parse import urlencode, urlsplit
from contextlib import contextmanager
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
import pyodbc
import packaging_api as api
import attachments_api as attachments
from main import app
from auth import AccessContext, get_access_context

class TestClient:
    # Match the repository's dependency-free ASGI test approach.
    def __init__(self, application):
        self.application=application

    async def request(self, method, url, params=None, json=None, raw=None):
        target=urlsplit(url)
        query=urlencode(params) if params else target.query
        body=raw if raw is not None else jsonlib.dumps(json).encode() if json is not None else b''
        delivered=False
        sent=[]
        async def receive():
            nonlocal delivered
            if not delivered:
                delivered=True
                return {'type':'http.request','body':body,'more_body':False}
            await asyncio.Event().wait()
        async def send(message):
            sent.append(message)
        scope={'type':'http','asgi':{'version':'3.0','spec_version':'2.4'},'http_version':'1.1',
               'method':method,'scheme':'http','path':target.path,'raw_path':target.path.encode(),
               'query_string':query.encode(),'root_path':'','headers':[(b'content-type',b'application/json')],
               'client':('127.0.0.1',12345),'server':('test',80)}
        await self.application(scope,receive,send)
        start=next(m for m in sent if m['type']=='http.response.start')
        content=b''.join(m.get('body',b'') for m in sent if m['type']=='http.response.body').decode()
        headers={k.decode().lower():v.decode() for k,v in start['headers']}
        headers['X-Bridge-Contract']=headers.get('x-bridge-contract')
        return SimpleNamespace(status_code=start['status'],text=content,headers=headers,json=lambda:jsonlib.loads(content))

    def get(self,url,**kwargs):
        return asyncio.run(self.request('GET',url,**kwargs))

    def post(self,url,**kwargs):
        return asyncio.run(self.request('POST',url,**kwargs))

    def put(self,url,**kwargs):
        return asyncio.run(self.request('PUT',url,**kwargs))

cn=pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=DESKTOP-5BGMJSC;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
def scalar(sql,*args):
    cursor=cn.cursor()
    try:
        return cursor.execute(sql,*args).fetchone()[0]
    finally:
        cursor.close()
def sql(sql,*args):
    cursor=cn.cursor()
    try:
        cursor.execute(sql,*args)
        while cursor.nextset():
            pass
    finally:
        cursor.close()
@contextmanager
def test_cursor():
    cur=cn.cursor()
    try:
        yield cur
    finally:
        cur.close()
old_cursor=api.get_raw_cursor
old_attachment_cursor=attachments.get_raw_cursor
old_attachment_root=os.environ.get('ATTACHMENT_ROOT')
attachment_files=tempfile.TemporaryDirectory(prefix='packaging-api-files-')
os.environ['ATTACHMENT_ROOT']=attachment_files.name
attachments.get_raw_cursor=test_cursor
tag=uuid.uuid4().hex[:8]
name='pkg.workbook.'+tag
try:
    sql('BEGIN TRANSACTION')
    uid=scalar('INSERT dbo.Users(UserName,IsActive) OUTPUT inserted.ID VALUES(?,1)',name)
    for scope in ('Admin',):
        sql('INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)',uid,scope)
    api.get_raw_cursor=test_cursor
    app.dependency_overrides[get_access_context]=lambda: AccessContext(uid,name,frozenset({'Admin'}))
    client=TestClient(app)
    for path in ('material','price','requests','manual'):
        response=client.get('/api/packaging/'+path)
        assert response.status_code==200,response.text
        assert response.json()['page_size']==200
        assert response.headers['X-Bridge-Contract']=='2'
        assert client.get('/api/packaging/'+path+'?page_size=501').status_code==422
        assert client.get('/api/packaging/'+path+'?page_size=0').status_code==422
    assert client.post('/api/packaging/response/batch',json={'rows':[]}).status_code==422
    app.dependency_overrides[get_access_context]=lambda: AccessContext(uid,name,frozenset({'Customer'}))
    assert client.post('/api/packaging/material/batch',json={'rows':[{'RowNum':1,'Command':'C','MaterialCode':tag,'MaterialName':tag,'UnitOfMeasure':'piece'}]}).status_code==403
    app.dependency_overrides[get_access_context]=lambda: AccessContext(uid,name,frozenset({'Admin'}))
    r=client.post('/api/packaging/material/batch',json={'rows':[{'RowNum':1,'Command':'C','MaterialCode':'T'+tag,'MaterialName':'Test '+tag,'UnitOfMeasure':'piece'}]})
    assert r.status_code==200,r.text
    material=r.json()['results'][0]
    assert material['Status']=='OK',material
    currency=scalar('SELECT TOP(1) ID FROM dbo.Currency ORDER BY ID')
    r=client.post('/api/packaging/price/batch',json={'rows':[{'RowNum':1,'Command':'C','MaterialID':material['NewID'],'CurrencyID':currency,'PriceBasis':'piece','QuantityFrom':0,'UnitPrice':0,'EffectiveFrom':'2026-01-01'}]})
    assert r.status_code==200,r.text
    assert r.json()['results'][0]['Status']=='OK',r.text
    customer=scalar('SELECT TOP(1) ID FROM dbo.Customer WHERE Status=\'Active\' ORDER BY ID')
    opp=scalar('INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,CreatedBy) OUTPUT inserted.ID VALUES(?,?,?,\'2026-01-01\',\'2026-12-31\',?)','T-'+tag,customer,'Workbook smoke',uid)
    for n in range(2):
        product=scalar('INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy) OUTPUT inserted.ID VALUES(?,?,10,?)',f'T{n}'+tag,f'Test{n} '+tag,uid)
        sql('INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,CreatedBy) VALUES(?,?,?,10,?)',opp,product,'Test line',uid)
    r=client.get('/api/packaging/manual',params={'opportunity_number':'T-'+tag,'page_size':1})
    assert r.status_code==200,r.text
    first=r.json()['rows'][0]
    second=client.get('/api/packaging/manual',params={'opportunity_number':'T-'+tag,'page_size':1,'page':2}).json()['rows'][0]
    assert first['OpportunityItemID']!=second['OpportunityItemID']
    payload={'OpportunityID':opp,'ExpectedRowVersion':first['HeaderRowVersion'],'CreationKey':str(uuid.uuid4()),'ResponseDue':'2099-01-01','items':[{'OpportunityItemID':first['OpportunityItemID'],'ExpectedRowVersion':first['ItemRowVersion'],'PackagingRequirement':'Quote package'}]}
    r=client.post('/api/packaging/manual',json=payload)
    assert r.status_code==200,r.text
    created=r.json()
    assert len(created['items'])==1
    replay=client.post('/api/packaging/manual',json=payload)
    assert replay.status_code==200,replay.text
    assert replay.json()['replayed'] is True
    assert replay.json()['header']['ID']==created['header']['ID']
    changed=dict(payload,RequestNotes='different')
    assert client.post('/api/packaging/manual',json=changed).status_code==409
    item=created['items'][0]
    attachment_key=str(uuid.uuid4())
    for attempt in range(2):
        uploaded=client.put(f'/api/packaging/items/{item["ID"]}/attachments/{attachment_key}?filename=test.pdf',raw=b'%PDF-1.7 fixture')
        assert uploaded.status_code==200,uploaded.text
    assert scalar('SELECT COUNT(*) FROM dbo.PackagingItemAttachment WHERE ItemID=?',item['ID'])==1
    assert len(list(Path(attachment_files.name).iterdir()))==1
    listing=client.get(f'/api/packaging/items/{item["ID"]}/attachments')
    assert len(listing.json()['rows'])==1
    downloaded=client.get(f'/api/packaging/items/{item["ID"]}/attachments/{attachment_key}/download')
    assert downloaded.status_code==200 and downloaded.text=='%PDF-1.7 fixture',downloaded.text
    assert downloaded.headers['x-content-type-options']=='nosniff'
    other_uid=scalar('INSERT dbo.Users(UserName,IsActive) OUTPUT inserted.ID VALUES(?,1)',name+'.pic')
    sql('INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)',other_uid,'Packaging')
    r=client.post(f'/api/packaging/items/{item["ID"]}/assign',json={'PICUserID':other_uid,'ExpectedRowVersion':item['RowVersion']})
    assert r.status_code==200,r.text
    version=r.json()['result']['RowVersion']
    r=client.post('/api/packaging/response/batch',json={'rows':[{'RowNum':1,'ID':item['ID'],'RowVersion':version}]})
    assert r.status_code==403,r.text  # Admin cannot save another PIC's response.
    grid=client.get('/api/packaging/requests',params={'opportunity_number':'T-'+tag,'page_size':1})
    assert grid.status_code==200,grid.text
    assert grid.json()['rows'][0]['Cost'] is None
    invalid={'rows':[{'RowNum':1,'ID':item['ID'],'RowVersion':'bad'}]}
    assert client.post('/api/packaging/response/batch',json=invalid).status_code==422
    # Admin must have Packaging membership and own the saved PIC assignment.
    version=grid.json()['rows'][0]['ItemRowVersion']
    sql('INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)',uid,'Packaging')
    r=client.post(f'/api/packaging/items/{item["ID"]}/assign',json={'PICUserID':uid,'ExpectedRowVersion':version})
    assert r.status_code==200,r.text
    r=client.post('/api/packaging/response/batch',json={'rows':[{'RowNum':1,'ID':item['ID'],'RowVersion':r.json()['result']['RowVersion'],'MaterialID':material['NewID'],'HeightMM':10,'WidthMM':20,'Cost':0,'CurrencyID':currency,'CostBasis':'piece'}]})
    assert r.status_code==200,r.text
    version=r.json()['results'][0]['NewRowVersion']
    for stage in ('Pending Review','Approved'):
        r=client.post(f'/api/packaging/items/{item["ID"]}/transition',json={'TargetStage':stage,'ExpectedRowVersion':version})
        assert r.status_code==200,r.text
        version=r.json()['result']['RowVersion']
    # Stage locks apply even to Admin; SQL rolls back the encompassing fixture transaction.
    try:
        sql('EXEC dbo.usp_PackagingAttachment_Authorize ?,?,1',name,item['ID'])
        raise AssertionError('Approved item accepted attachment writes')
    except pyodbc.Error as locked:
        assert '51203' in str(locked),str(locked)
    r=client.post('/api/packaging/response/batch',json={'rows':[{'RowNum':1,'ID':item['ID'],'RowVersion':version}]})
    assert r.status_code==409,r.text
    if scalar('SELECT @@TRANCOUNT')>0:
        sql('ROLLBACK TRANSACTION')
    assert scalar('SELECT COUNT(*) FROM dbo.Users WHERE UserName=?',name)==0
    print('PASS: Admin-only Packaging access, master writes, cross-PIC save rejection, owner saves/submission, assignment, approval, stage locks, paging and manual create/retry; fixtures rolled back.')
finally:
    if scalar('SELECT @@TRANCOUNT')>0:
        sql('ROLLBACK TRANSACTION')
    api.get_raw_cursor=old_cursor
    attachments.get_raw_cursor=old_attachment_cursor
    if old_attachment_root is None:
        os.environ.pop('ATTACHMENT_ROOT',None)
    else:
        os.environ['ATTACHMENT_ROOT']=old_attachment_root
    attachment_files.cleanup()
    app.dependency_overrides.clear()
    cn.close()
