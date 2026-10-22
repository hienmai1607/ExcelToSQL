"""Inline editing reuses real SQL validators; all fixture writes roll back."""
import unittest
import json
from decimal import Decimal
from uuid import uuid4
from fastapi import HTTPException
from auth import AccessContext
from db import get_raw_cursor, reuse_transaction
import inline_master_api as inline
import raw_material_api as raw
import category_api

class InlineMasterContract(unittest.TestCase):
 def setUp(self):
  self.connection=get_raw_cursor();self.cur=self.connection.__enter__();self.addCleanup(self.cleanup)
  self.cur.execute('SET NOCOUNT ON; BEGIN TRANSACTION')
  actor,user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1").fetchone()
  self.ctx=AccessContext(actor,user,frozenset({'Admin'}))
  self.shared=reuse_transaction(self.cur.connection);self.shared.__enter__();self.addCleanup(lambda:self.shared.__exit__(None,None,None))
  result=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command='C',GradeName='Inline-'+uuid4().hex[:12],FinalGrade=True)]),self.ctx)['results'][0]
  self.assertEqual(result['Status'],'OK',result);self.grade=result['NewID']
  result=raw.material_save(raw.RawMaterialBatch(rows=[dict(RowNum=1,Command='C',MaterialName='Inline fixture',UnitOfMeasure='EA',GradeID=self.grade)]),self.ctx)['results'][0]
  self.assertEqual(result['Status'],'OK',result);self.material=result['NewID']
 def cleanup(self):
  try:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  finally:self.connection.__exit__(None,None,None)
 def read(self):return inline.read('raw-materials',str(self.material),self.ctx)
 def body(self,**changes):
  row=self.read()['row']
  return inline.InlineSave(payload={'rows':[dict(RowNum=1,Command='U',ID=row['ID'],RowVersion=row['RowVersion'],MaterialName='Updated inline',UnitOfMeasure='EA',GradeID=self.grade,**changes)]})
 def save(self,body):return inline.save('raw-materials',str(self.material),body,self.ctx)
 def test_unreferenced_edit_uses_normal_sql_and_new_rowversion(self):
  before=self.read();self.assertTrue(before['editable']);self.assertEqual(before['lockedFields'],('GradeID',))
  result=self.save(self.body())['row']
  self.assertEqual(result['MaterialName'],'Updated inline');self.assertNotEqual(before['row']['RowVersion'],result['RowVersion'])
  self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),1)
 def test_reference_does_not_block_opening_but_normal_master_validation_still_applies(self):
  context=inline.read('raw-grades',str(self.grade),self.ctx)
  self.assertTrue(context['editable'])
  row=context['row']
  body=inline.InlineSave(payload={'rows':[dict(RowNum=1,Command='U',ID=self.grade,RowVersion=row['RowVersion'],GradeName=row['GradeName'],FinalGrade=False)]})
  normal=raw.grade_save(raw.RawGradeBatch.model_validate(body.payload),self.ctx)['results'][0]
  self.assertEqual(normal['Status'],'ERROR',normal)
  with self.assertRaises(HTTPException) as error:inline.save('raw-grades',str(self.grade),body,self.ctx)
  self.assertEqual(error.exception.status_code,422);self.assertEqual(error.exception.detail,normal['Message'])
 def test_reference_added_after_opening_follows_normal_master_save_rules(self):
  body=self.body()
  # A material-specific conversion is a live FK, not a captured price snapshot.
  from unit_conversion_api import Conversion,save
  units=[r[0] for r in self.cur.execute("SELECT TOP(2) ID FROM dbo.UoM WHERE Status='Active' ORDER BY ID").fetchall()]
  save(Conversion(FromUoMID=units[0],ToUoMID=units[1],Factor=1,RawMaterialID=self.material),self.ctx)
  result=self.save(body)['row']
  self.assertEqual(result['MaterialName'],'Updated inline')
  self.assertGreater(self.cur.execute('SELECT COUNT(*) FROM dbo.UnitConversion WHERE RawMaterialID=?',self.material).fetchval(),0)
 def test_linked_grade_cannot_be_changed_even_by_admin(self):
  body=self.body();body.payload['rows'][0]['GradeID']=None
  with self.assertRaises(HTTPException) as error:self.save(body)
  self.assertEqual(error.exception.status_code,422);self.assertIn('locked',error.exception.detail)
 def test_stale_rowversion_rejected_before_write(self):
  body=self.body();body.payload['rows'][0]['RowVersion']='AAAAAAAAAAE='
  with self.assertRaises(HTTPException) as error:self.save(body)
  self.assertEqual(error.exception.status_code,409);self.assertIn('changed',error.exception.detail)
 def test_edit_permissions_cannot_be_bypassed_by_inline_route(self):
  ctx=AccessContext(self.ctx.user_id,self.ctx.username,frozenset({'RawMaterial'}),permissions={'raw-materials':'display'})
  with self.assertRaises(HTTPException) as error:inline.read('raw-materials',str(self.material),ctx)
  self.assertEqual(error.exception.status_code,403)
 def test_only_one_update_of_selected_record_is_allowed(self):
  body=self.body();body.payload['rows'][0]['Command']='C'
  with self.assertRaises(HTTPException) as error:self.save(body)
  self.assertEqual(error.exception.status_code,422)
 def test_plain_customer_payload_cannot_override_the_update_command(self):
  body=inline.InlineSave(payload=dict(ID=1,RowVersion='AAAAAAAAAAE=',Command='C'))
  with self.assertRaises(HTTPException) as error:inline.save('customers','1',body,self.ctx)
  self.assertEqual(error.exception.status_code,422)
 def test_packaging_type_context_keeps_all_orders(self):
  from packaging_type_api import PackagingTypeBatch,packaging_type_save
  result=packaging_type_save(PackagingTypeBatch(rows=[dict(RowNum=1,Command='C',PackagingType='Inline-'+uuid4().hex[:12],PackagingOrders=['Primary','Secondary'],FinalComponent=True)]),self.ctx)['results'][0]
  self.assertEqual(result['Status'],'OK',result)
  row=inline.read('packaging-types',str(result['NewID']),self.ctx)['row']
  self.assertEqual(set(row['PackagingOrders']),{'Primary','Secondary'})
  self.assertEqual(row['ParentTypeIDs'],[])
 def test_category_adapter_can_rename_without_referencing_stale_key(self):
  name='Inline-'+uuid4().hex[:12]
  row=category_api.save(category_api.CategorySave(CategoryName=name),self.ctx)['rows'][0]
  context=inline.read('categories',name,self.ctx);self.assertTrue(context['editable'])
  body=inline.InlineSave(payload=dict(ID=row['ID'],RowVersion=row['RowVersion'],CategoryName=name+'-edited',Status='Active'))
  result=inline.save('categories',name,body,self.ctx)['row']
  self.assertEqual(result['CategoryName'],name+'-edited')
 def test_normal_validation_failure_rolls_back_entire_inline_update(self):
  body=self.body();body.payload['rows'][0]['MaterialName']=''
  with self.assertRaises(HTTPException) as error:self.save(body)
  self.assertIn(error.exception.status_code,(409,422))
  self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),0)
 def test_remaining_batch_adapters_use_the_existing_validators_and_keep_values(self):
  currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  cases=[('vendors',dict(VendorName='Inline-'+uuid4().hex[:12],CurrencyID=currency),'VendorName'),
   ('materials',dict(MaterialName='Inline packaging',UnitOfMeasure='EA'),'MaterialName'),
   ('raw-grades',dict(GradeName='Inline-'+uuid4().hex[:12],FinalGrade=True),'GradeName'),
   ('raw-prices',dict(MaterialID=self.material,CurrencyID=currency,BaseUoM='EA',QuantityFrom=0,UnitPrice=2,ExchangeRateToUSD=1,EffectiveFrom='2026-10-23'),'UnitPrice'),
   ('pallets',dict(UnitOfMeasure='MM',Width=1037,Length=1237),'Width'),
   ('packaging-types',dict(PackagingType='Inline-'+uuid4().hex[:12],PackagingOrders=['Primary','Secondary'],FinalComponent=True),'PackagingType')]
  for entity,values,field in cases:
   with self.subTest(entity=entity):
    created=inline.write(entity,{'rows':[dict(RowNum=1,Command='C',**values)]},self.ctx)['results'][0]
    self.assertEqual(created['Status'],'OK',created);key=str(created['NewID'])
    context=inline.read(entity,key,self.ctx);self.assertTrue(context['editable'],context)
    value=str(values[field])+' edited' if isinstance(values[field],str) else values[field]+1
    body=inline.InlineSave(payload={'rows':[dict(RowNum=1,Command='U',ID=created['NewID'],RowVersion=context['row']['RowVersion'],**values)]})
    body.payload['rows'][0][field]=value
    result=inline.save(entity,key,body,self.ctx)['row']
    if isinstance(value,str):self.assertEqual(result[field],value)
    else:self.assertEqual(Decimal(str(result[field])),Decimal(value))
    if entity=='packaging-types':self.assertEqual(set(inline.read(entity,key,self.ctx)['row']['PackagingOrders']),{'Primary','Secondary'})
 def customer(self):
  market,currency=self.cur.execute('SELECT TOP(1) MarketID,CurrencyID FROM dbo.Customer WHERE MarketID IS NOT NULL AND CurrencyID IS NOT NULL').fetchone()
  identity=self.cur.execute('INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,CreatedBy) VALUES(?,?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())','Inline-'+uuid4().hex[:12],market,currency,self.ctx.user_id).fetchval()
  return identity,market,currency
 def test_customer_referenced_by_port_opens_the_same_editor_as_customer_master(self):
  from ports_api import PortSave,save as save_port
  customer,market,currency=self.customer()
  save_port(PortSave(CustomerID=customer,MarketID=market,PortName='Reference parity port'),self.ctx)
  context=inline.read('customers',str(customer),self.ctx)
  self.assertTrue(context['editable'],context.get('reason'))
 def test_referenced_customer_edits_use_the_same_save_validation_as_master(self):
  from ports_api import PortSave,save as save_port
  customer,market,currency=self.customer()
  save_port(PortSave(CustomerID=customer,MarketID=market,PortName='Save parity port'),self.ctx)
  row=inline.read('customers',str(customer),self.ctx)['row']
  values=dict(ID=customer,RowVersion=row['RowVersion'],CustomerName='Master parity '+uuid4().hex[:12],MarketID=market,CurrencyID=currency,Status='Active')
  direct=inline.write('customers',values,self.ctx)['results'][0]
  self.assertEqual(direct['Status'],'OK',direct)
  values['RowVersion']=inline.read('customers',str(customer),self.ctx)['row']['RowVersion']
  values['CustomerName']='Shortcut parity '+uuid4().hex[:12]
  saved=inline.save('customers',str(customer),inline.InlineSave(payload=values),self.ctx)['row']
  self.assertEqual(saved['CustomerName'],values['CustomerName'])
  self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PortOfEntry WHERE CustomerID=?',customer).fetchval(),1)
 def test_invalid_customer_has_the_same_save_time_message_in_both_paths(self):
  customer,market,currency=self.customer();row=inline.read('customers',str(customer),self.ctx)['row']
  values=dict(ID=customer,RowVersion=row['RowVersion'],CustomerName='',MarketID=market,CurrencyID=currency,Status='Active')
  normal=inline.write('customers',values,self.ctx)['results'][0]
  self.assertEqual(normal['Status'],'ERROR',normal)
  with self.assertRaises(HTTPException) as error:inline.save('customers',str(customer),inline.InlineSave(payload=values),self.ctx)
  self.assertEqual(error.exception.status_code,422);self.assertEqual(error.exception.detail,normal['Message'])
 def test_explicit_port_edit_permission_is_not_replaced_by_admin_only_shortcut_rule(self):
  ctx=AccessContext(self.ctx.user_id,self.ctx.username,frozenset({'Opportunity'}),permissions={'ports':'edit'})
  inline.authorize(ctx,'ports')
 def test_customer_and_product_adapters_share_the_outer_transaction(self):
  customer,market,currency=self.customer();row=inline.read('customers',str(customer),self.ctx)['row']
  result=inline.save('customers',str(customer),inline.InlineSave(payload=dict(ID=customer,RowVersion=row['RowVersion'],CustomerName='Edited customer '+uuid4().hex[:12],MarketID=market,CurrencyID=currency,Status='Active')),self.ctx)['row']
  self.assertTrue(result['CustomerName'].startswith('Edited customer'))
  category=self.cur.execute("SELECT TOP(1) CategoryName FROM dbo.ProductCategory WHERE Status='Active'").fetchval()
  values=dict(CustomerID=customer,ProductName='Inline product',Category=category,WeightValue=100,WeightUnit='g',IsMix=False)
  created=inline.write('products',{'rows':[dict(RowNum=1,Command='C',**values)]},self.ctx)['results'][0]
  self.assertEqual(created['Status'],'OK',created);key=str(created['NewID']);row=inline.read('products',key,self.ctx)['row']
  values['ProductName']='Edited product'
  result=inline.save('products',key,inline.InlineSave(payload={'rows':[dict(RowNum=1,Command='U',ID=created['NewID'],RowVersion=row['RowVersion'],**values)]}),self.ctx)['row']
  self.assertEqual(result['ProductName'],'Edited product');self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),1)
 def test_port_and_dimension_special_adapters(self):
  from ports_api import PortSave,save as save_port
  from packaging_dimension_api import DimensionSave,save as save_dimension
  customer,market,currency=self.customer()
  port=save_port(PortSave(CustomerID=customer,MarketID=market,PortName='Inline port'),self.ctx)['rows'][0]
  row=inline.read('ports',str(port['ID']),self.ctx)['row']
  result=inline.save('ports',str(port['ID']),inline.InlineSave(payload=dict(ID=port['ID'],RowVersion=row['RowVersion'],CustomerID=customer,MarketID=market,PortName='Edited port',Status='Active')),self.ctx)['row']
  self.assertEqual(result['PortName'],'Edited port')
  created=inline.write('packaging-types',{'rows':[dict(RowNum=1,Command='C',PackagingType='Inline-'+uuid4().hex[:12],PackagingOrders=['Primary'],FinalComponent=True)]},self.ctx)['results'][0]
  unit=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE Category='Length/Distance' AND Status='Active'").fetchval()
  values=dict(PackagingTypeID=created['NewID'],D1='Length',D1UoMID=unit,Status='Active')
  dimension=save_dimension(DimensionSave(**values),self.ctx)['row'];key=str(dimension['ID']);row=inline.read('packaging-dimensions',key,self.ctx)['row']
  values['D1']='Edited length'
  result=inline.save('packaging-dimensions',key,inline.InlineSave(payload=dict(ID=dimension['ID'],RowVersion=row['RowVersion'],**values)),self.ctx)['row']
  self.assertEqual(result['D1'],'Edited length')
 def test_nested_shared_transaction_always_resets_and_uses_fresh_cursors(self):
  with self.assertRaises(ValueError):
   with reuse_transaction(object()):raise ValueError('Nested context failed')
  with get_raw_cursor() as first:
   with get_raw_cursor() as second:
    self.assertIsNot(first,second);self.assertIs(first.connection,second.connection)
    self.assertEqual(second.execute('SELECT @@TRANCOUNT').fetchval(),1)
  self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),1)
 def test_snapshot_only_price_reference_allows_edit_without_rewriting_capture(self):
  currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  values=dict(MaterialID=self.material,CurrencyID=currency,BaseUoM='EA',QuantityFrom=0,UnitPrice=2,ExchangeRateToUSD=1,EffectiveFrom='2026-10-23')
  created=inline.write('raw-prices',{'rows':[dict(RowNum=1,Command='C',**values)]},self.ctx)['results'][0]
  self.assertEqual(created['Status'],'OK',created);key=str(created['NewID']);price=inline.read('raw-prices',key,self.ctx)['row']
  customer,market,currency=self.customer()
  product=self.cur.execute('INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?,?,100,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())','INLINE-'+uuid4().hex[:12],'Inline snapshot',customer,self.ctx.user_id).fetchval()
  opportunity=self.cur.execute("INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy) VALUES(?,?,'Inline snapshot','2026-10-23','2026-10-24','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",'INLINE-'+uuid4().hex[:12],customer,self.ctx.user_id).fetchval()
  capture=json.dumps({'Inputs':{'Prices':[{'Path':'0/1','PriceID':price['ID'],'PriceVersion':price['RowVersion'],'ExpectedUSDPerLb':'2'}]},'PriceSnapshots':[price]},default=str)
  item=self.cur.execute("INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,TCBCostInfo,CreatedBy) VALUES(?,?,'Inline snapshot',100,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",opportunity,product,capture,self.ctx.user_id).fetchval()
  self.assertTrue(inline.read('raw-prices',key,self.ctx)['editable'])
  values['UnitPrice']=3
  updated=inline.save('raw-prices',key,inline.InlineSave(payload={'rows':[dict(RowNum=1,Command='U',ID=price['ID'],RowVersion=price['RowVersion'],**values)]}),self.ctx)['row']
  self.assertEqual(Decimal(updated['UnitPrice']),Decimal(3))
  self.assertEqual(self.cur.execute('SELECT TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?',item).fetchval(),capture)

if __name__=='__main__':unittest.main()
