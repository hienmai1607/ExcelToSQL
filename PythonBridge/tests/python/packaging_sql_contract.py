'''SQL integration contracts; use a dedicated scratch database only.'''
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import pyodbc

server, database = sys.argv[1:3]
if not database.startswith('PythonBridge_Packaging_Contract_'):
    raise SystemExit('Refusing to test against a non-scratch database.')
cn = pyodbc.connect(f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};DATABASE={database};Trusted_Connection=yes;TrustServerCertificate=yes', autocommit=True)
start = time.perf_counter()
checks = 0

def run(sql, *params):
    cur = cn.cursor()
    try:
        cur.execute(sql, *params)
        result = []
        while True:
            if cur.description:
                names = [c[0] for c in cur.description]
                result.append([dict(zip(names, row)) for row in cur.fetchall()])
            if not cur.nextset():
                break
        return result
    finally:
        cur.close()

def scalar(sql, *params):
    return next(iter(run(sql, *params)[0][0].values()))

def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print('PASS:', label)

def denied(code, sql, *params):
    try:
        run(sql, *params)
    except pyodbc.Error as exc:
        check(str(code) in str(exc), f'expected SQL rejection {code}')
    else:
        raise AssertionError(f'Expected SQL error {code}')

tag = uuid.uuid4().hex[:10]
actors = {}
for role in ('Admin', 'Opportunity', 'Packaging', 'PackagingManager', 'Other', 'Inactive'):
    name = f'pkg.{role}.{tag}'
    uid = scalar('INSERT dbo.Users(UserName,IsActive) OUTPUT inserted.ID VALUES(?,1)', name)
    actors[role] = (name, uid)
    if role not in ('Other', 'Inactive'):
        run('INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)', uid, role)
run('UPDATE dbo.Users SET IsActive=0 WHERE ID=?', actors['Inactive'][1])
admin, admin_id = actors['Admin']
sales, sales_id = actors['Opportunity']
pic, pic_id = actors['Packaging']
manager, manager_id = actors['PackagingManager']
authorize = 'DECLARE @a INT; EXEC dbo.usp_Packaging_Authorize ?,?,@a OUTPUT'
for name, action, error in [('missing.'+tag,'Maintain',51101),(actors['Inactive'][0],'Maintain',51101),(sales,'Maintain',51102),(pic,'Review',51102)]:
    denied(error,authorize,name,action)
run(authorize,admin,'Maintain')
run(authorize,admin,'Review')
run('EXEC dbo.usp_Packaging_Access_Set ?,?,?,1',admin,actors['Other'][1],'Packaging')
run('EXEC dbo.usp_Packaging_Access_Set ?,?,?,0',admin,actors['Other'][1],'Packaging')
check(not scalar('SELECT COUNT(*) FROM dbo.UserAccess WHERE UserID=?',actors['Other'][1]),'Admin grants/revokes Packaging access')

material_batch='DECLARE @r dbo.PackagingMaterialBatchType; INSERT @r VALUES(1,?,?,?,?,?,?,?,?); EXEC dbo.usp_PackagingMaterial_Batch @r,?;'
code='MAT-'+tag
r=run(material_batch,'C',None,code,'Material '+tag,None,'piece',None,None,pic)[0][0]
check(r['Status']=='OK','material create')
mat, mat_rv = r['NewID'],r['NewRowVersion']
r=run(material_batch,'U',mat,code,'Updated '+tag,None,'piece',None,mat_rv,pic)[0][0]
check(r['Status']=='OK' and r['NewRowVersion']!=mat_rv,'material update/RowVersion')
stale=run(material_batch,'D',mat,None,None,None,None,None,mat_rv,pic)[0][0]
check(stale['Status']=='ERROR','stale material block rejected')
r=run(material_batch,'D',mat,None,None,None,None,None,r['NewRowVersion'],pic)[0][0]
check(r['Status']=='OK' and scalar('SELECT Status FROM dbo.PackagingMaterial WHERE ID=?',mat)=='Block','material D means Block')
run(material_batch,'U',mat,code,'Material '+tag,None,'piece','Active',r['NewRowVersion'],pic)
currency=scalar('SELECT TOP(1) ID FROM dbo.Currency ORDER BY ID') if scalar('SELECT COUNT(*) FROM dbo.Currency') else scalar('INSERT dbo.Currency(CurrencyCode,CurrencyName) OUTPUT inserted.ID VALUES(?,?)','ZZZ','Test currency')
price_batch='DECLARE @r dbo.PackagingPriceBatchType; INSERT @r VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?); EXEC dbo.usp_PackagingPrice_Batch @r,?;'
r=run(price_batch,'C',None,mat,currency,'piece',0,100,Decimal('1.25'),'2026-01-01',None,'Active',None,pic)[0][0]
check(r['Status']=='OK','price create')
price_id,price_rv=r['NewID'],r['NewRowVersion']
r=run(price_batch,'C',None,mat,currency,'piece',50,150,2,'2026-02-01',None,'Active',None,pic)[0][0]
check(r['Status']=='ERROR','overlapping price ranges rejected')
r=run(price_batch,'C',None,mat,currency,'piece',100,None,2,'2026-01-01',None,'Active',None,pic)[0][0]
check(r['Status']=='OK','adjacent quantity ranges accepted')
r=run(price_batch,'U',price_id,mat,currency,'piece',0,100,Decimal('1.5'),'2026-01-01',None,'Active',price_rv,pic)[0][0]
check(r['Status']=='OK','price update')
r=run(price_batch,'D',price_id,None,None,None,None,None,None,None,None,None,r['NewRowVersion'],pic)[0][0]
check(r['Status']=='OK' and scalar('SELECT Status FROM dbo.PackagingPrice WHERE ID=?',price_id)=='Block','price D means Block')

market=scalar('INSERT dbo.Market(MarketCode,MarketName) OUTPUT inserted.ID VALUES(?,?)',tag,'Market '+tag)
customer=scalar('INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,CreatedBy) OUTPUT inserted.ID VALUES(?,?,?,?)','Customer '+tag,market,currency,sales_id)
opp_sql='INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,CreatedBy) OUTPUT inserted.ID VALUES(?,?,?,?,?,?)'
opp=scalar(opp_sql,'OPP-'+tag,customer,'Packaging test','2026-01-01','2026-12-31',sales_id)
items=[]
for n in range(3):
    product=scalar('INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy) OUTPUT inserted.ID VALUES(?,?,?,?)',f'P{n}-{tag}',f'Product {n} {tag}',10,sales_id)
    items.append(scalar('INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,CreatedBy) OUTPUT inserted.ID VALUES(?,?,?,?,?)',opp,product,'Source description',100,sales_id))
create = '''
DECLARE @r dbo.PackagingRequestSelectionType;
INSERT @r SELECT ID,RowVersion,N'Packaging brief' FROM dbo.OpportunityItem WHERE ID IN(?,?);
DECLARE @rv VARBINARY(8)=(SELECT RowVersion FROM dbo.Opportunity WHERE ID=?);
EXEC dbo.usp_PackagingRequest_Create @Username=?,@OpportunityID=?,@ExpectedRowVersion=@rv,
 @CreationKey=?,@ResponseDue='2099-01-01',@Items=@r;
'''
key=str(uuid.uuid4())
result=run(create,items[0],items[1],opp,sales,opp,key)
request=result[0][0]['ID']
request_items=result[1]
check(len(request_items)==2,'selected 2 of 3 creates exactly 2 lines')
check(scalar('SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=?',items[2])==0,'unselected item excluded')
denied(51122,create,items[0],items[1],opp,sales,opp,key)
denied(51125,create,items[0],items[1],opp,sales,opp,str(uuid.uuid4()))
check(scalar('SELECT COUNT(*) FROM dbo.PackagingConfigurationRequest WHERE OpportunityID=?',opp)==1,'failed create leaves no orphan header')
item=request_items[0]['ID']
rv=request_items[0]['RowVersion']
denied(51126,'EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?',manager,item,actors['Other'][1],rv)
run('EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?',manager,item,pic_id,rv)
def item_rv():
    return scalar('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',item)
response='DECLARE @r dbo.PackagingResponseBatchType; INSERT @r VALUES(1,?,?,?,?,?,?,?,?,?,?); EXEC dbo.usp_PackagingResponse_Batch @r,?;'
run(response,item,None,None,None,None,None,None,None,None,item_rv(),pic)
check(scalar('SELECT Cost FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',item) is None,'blank numeric response remains NULL')
transition='EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,?'
denied(51134,transition,pic,item,item_rv(),'Pending Review')
oldrv=item_rv()
run(response,item,mat,10,20,None,0,currency,'piece','Zero is intentional',oldrv,pic)
check(scalar('SELECT Cost FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',item)==0,'zero cost remains zero')
unreviewed=run('EXEC dbo.usp_PackagingRequest_Grid_Read @Username=?,@RequestID=?',sales,request)[0]
check(unreviewed[0]['Cost'] is None and unreviewed[0]['HeightMM'] is None,'Sales cannot read unapproved response values')
denied(51128,response,item,mat,10,20,None,8,currency,'piece',None,oldrv,pic)
run(transition,pic,item,item_rv(),'Pending Review')
denied(51128,response,item,mat,10,20,None,8,currency,'piece',None,item_rv(),pic)
denied(51132,transition,manager,item,item_rv(),'Returned')
run(transition+',?',manager,item,item_rv(),'Returned','Correct dimensions')
check(scalar('SELECT ManagerComment FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',item)=='Correct dimensions','latest return reason retained')
run(response,item,mat,11,21,None,5,currency,'piece','Corrected',item_rv(),pic)
run(transition,pic,item,item_rv(),'Pending Review')
run('INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)',pic_id,'PackagingManager')
denied(51133,transition,pic,item,item_rv(),'Approved')
run(transition,manager,item,item_rv(),'Approved')
denied(51128,response,item,mat,10,20,None,8,currency,'piece',None,item_rv(),pic)
run('UPDATE dbo.OpportunityItem SET ItemDescription=? WHERE ID=?','Changed after request',items[0])
grid=run('EXEC dbo.usp_PackagingRequest_Grid_Read @Username=?,@RequestID=?',sales,request)[0]
check(grid[0]['SourceChanged'] and grid[0]['ItemDescription']=='Source description','source snapshot retained; later source change flagged')
check(grid[0]['Cost']==5 and grid[0]['HeightMM']==11,'Sales can read approved response values')
check(grid[0]['RequestStatus']=='Open','header stays open while any item remains open')
second=request_items[1]['ID']
second_rv=scalar('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',second)
run(transition+',?',manager,second,second_rv,'Canceled','No longer required')
grid=run('EXEC dbo.usp_PackagingRequest_Grid_Read @Username=?,@RequestID=?',sales,request)[0]
check(grid[0]['RequestStatus']=='Completed','header completion derived from terminal items')
denied(51135,'EXEC dbo.usp_PackagingRequest_Grid_Read @Username=?,@PageSize=10000',pic)
def create_racer(_):
    race_cn=pyodbc.connect(f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};DATABASE={database};Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
    try:
        c=race_cn.cursor()
        c.execute(create,items[2],items[2],opp,sales,opp,str(uuid.uuid4()))
        while c.nextset():
            pass
        return 'created'
    except pyodbc.Error as exc:
        if '51125' in str(exc) or '1205' in str(exc):
            return 'rejected'
        raise
    finally:
        race_cn.close()
with ThreadPoolExecutor(max_workers=2) as pool:
    raced=list(pool.map(create_racer,range(2)))
check(sorted(raced)==['created','rejected'],'concurrent request creation allows only one active source request')
check(scalar('SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=? AND IsOpen=1',items[2])==1,'concurrent create leaves exactly one open item')
largeopp=scalar(opp_sql,'L-'+tag,customer,'10k test','2026-01-01','2026-12-31',sales_id)
run('''
;WITH n AS (SELECT TOP(10000) ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy)
SELECT ?+CONVERT(VARCHAR(6),n),?+CONVERT(VARCHAR(6),n),10,? FROM n;
INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,CreatedBy)
SELECT ?,ID,'10k source',100,? FROM dbo.Product WHERE ProductCode LIKE ?;
''','L'+tag,'Load '+tag,sales_id,largeopp,sales_id,'L'+tag+'%')
large=run('''
DECLARE @r dbo.PackagingRequestSelectionType;
INSERT @r SELECT ID,RowVersion,NULL FROM dbo.OpportunityItem WHERE OpportunityID=?;
DECLARE @rv VARBINARY(8)=(SELECT RowVersion FROM dbo.Opportunity WHERE ID=?);
EXEC dbo.usp_PackagingRequest_Create @Username=?,@OpportunityID=?,@ExpectedRowVersion=@rv,
 @CreationKey=?,@ResponseDue='2099-01-01',@Items=@r;
''',largeopp,largeopp,sales,largeopp,str(uuid.uuid4()))[0][0]['ID']
seen=set()
after=0
paging_start=time.perf_counter()
while True:
    page=run('EXEC dbo.usp_PackagingRequest_Grid_Read @Username=?,@RequestID=?,@AfterID=?,@PageSize=500',pic,large,after)[0]
    if not page:
        break
    ids=[x['ItemID'] for x in page]
    assert len(page)<=500 and not seen.intersection(ids)
    assert all(x['TotalMatchingRows']==10000 for x in page)
    seen.update(ids)
    after=ids[-1]
check(len(seen)==10000,'10,000 items paged without missing/duplicate IDs')
print(f'Grid: 10,000 rows / 20 pages plus terminal empty page in {time.perf_counter()-paging_start:.3f}s')
check(not scalar('SELECT COUNT(*) FROM sys.tables WHERE name LIKE ?', 'Packaging%History%'),'no Packaging history tables')
print(f'PASS: {checks} checks in {time.perf_counter()-start:.3f}s')
cn.close()
