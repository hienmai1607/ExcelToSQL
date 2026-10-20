"""Multiple-parent packaging contracts. Every SQL/schema fixture rolls back."""
import json
import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from pydantic import ValidationError
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
from db import get_raw_cursor
from packaging_type_api import PackagingTypeRow
from pkg_pricing_api import catalog
from packaging_orders import decode_orders
import packaging_master_excel_api as excel
from auth import AccessContext

class MultiParentSQL(unittest.TestCase):
 def setUp(self):
  self.handle=get_raw_cursor();self.cur=self.handle.__enter__()
  self.cur.execute("SET NOCOUNT ON;SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION")
  self.cur.execute((ROOT/'sql/128_packaging_type_multiple_parents.sql').read_text())
  while self.cur.nextset():pass
  self.actor=self.cur.execute("SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchval()
  self.prefix='multi-'+uuid.uuid4().hex[:12]
  self.a=self.create('A',FinalComponent=False)
  self.b=self.create('B',FinalComponent=False)
  self.child=self.create('Seal',ParentTypeIDs=[self.a,self.b],FinalComponent=True)
 def tearDown(self):
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
  self.handle.__exit__(None,None,None)
 def save(self,**values):
  self.cur.execute('EXEC dbo.usp_PackagingType_Batch ?,?',json.dumps([dict(RowNum=1,**values)]),self.actor)
  return dict(zip([c[0] for c in self.cur.description],self.cur.fetchone()))
 def create(self,name,**values):
  result=self.save(Command='C',PackagingType=self.prefix+name,PackagingOrders=['Primary'],**values)
  self.assertEqual(result['Status'],'OK',result)
  return result['NewID']
 def update(self,id,**values):
  rv=bytes(self.cur.execute('SELECT RowVersion FROM dbo.PackagingType WHERE ID=?',id).fetchval()).hex()
  return self.save(Command='U',ID=id,RowVersionHex='0x'+rv,PackagingType=self.prefix+'Seal',**values)
 def test_both_parents_share_one_component_in_catalog_and_lookup(self):
  for root in [self.a,self.b]:
   _,paths,_,_,_=catalog(self.cur,root,'Primary')
   self.assertIn(self.child,paths)
   self.assertEqual([n['ID'] for n in paths[self.child]],[self.child,root])
   self.assertTrue(self.cur.execute('SELECT HasChildren FROM dbo.v_PackagingTypeWeb WHERE ID=?',root).fetchval())
  row=self.cur.execute('SELECT ParentTypeIDsJSON,ParentTypes,CopyDim FROM dbo.v_PackagingTypeWeb WHERE ID=?',self.child).fetchone()
  self.assertEqual(set(json.loads(row[0])),{self.a,self.b})
  self.assertFalse(row[2])
 def test_partial_update_preserves_links_and_stale_update_is_rejected(self):
  rv=bytes(self.cur.execute('SELECT RowVersion FROM dbo.PackagingType WHERE ID=?',self.child).fetchval()).hex()
  result=self.update(self.child,Status='Block')
  self.assertEqual(result['Status'],'OK',result)
  self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.v_PackagingTypeEdges WHERE PackagingTypeID=?',self.child).fetchval(),2)
  stale=self.save(Command='U',ID=self.child,RowVersionHex='0x'+rv,PackagingType=self.prefix+'Seal',ParentTypeIDs=[self.a])
  self.assertEqual(stale['Status'],'ERROR')
 def test_duplicate_cycle_and_single_parent_rejected_atomically(self):
  for parents in ([self.a,self.a],[self.child],[999999999]):
   result=self.update(self.child,ParentTypeIDs=parents)
   self.assertEqual(result['Status'],'ERROR',result)
   self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.v_PackagingTypeEdges WHERE PackagingTypeID=?',self.child).fetchval(),2)
  intermediate=self.create('intermediate',ParentTypeIDs=[self.a],FinalComponent=False)
  rv=bytes(self.cur.execute('SELECT RowVersion FROM dbo.PackagingType WHERE ID=?',self.a).fetchval()).hex()
  result=self.save(Command='U',ID=self.a,RowVersionHex='0x'+rv,PackagingType=self.prefix+'A',ParentTypeIDs=[intermediate])
  self.assertEqual(result['Status'],'ERROR')
 def test_parent_used_by_shared_child_cannot_become_single(self):
  rv=bytes(self.cur.execute('SELECT RowVersion FROM dbo.PackagingType WHERE ID=?',self.b).fetchval()).hex()
  result=self.save(Command='U',ID=self.b,RowVersionHex='0x'+rv,PackagingType=self.prefix+'B',FinalComponent=True)
  self.assertEqual(result['Status'],'ERROR',result)
 def definition(self,typeid,parent=None):
  unit=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE Status='Active' AND UoMCode='mm'").fetchval()
  rv=self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',parent).fetchval() if parent else None
  self.cur.execute("EXEC dbo.usp_PackagingDimension_SaveV2 @Username=?,@PackagingTypeID=?,@D1=N'Length',@D1UoMID=?,@ParentDimensionID=?,@ParentDimensionRowVersion=?,@ConvertFromParentFormula=?",self.actor,typeid,unit,parent,rv,'1' if parent else None)
  return dict(zip([c[0] for c in self.cur.description],self.cur.fetchone()))['ID']
 def test_dimensions_use_selected_parent_and_prevent_removing_used_link(self):
  da=self.definition(self.a);db=self.definition(self.b)
  dc=self.definition(self.child,db)
  self.assertEqual(self.cur.execute('SELECT RootTypeID FROM dbo.v_PackagingDimensionWeb WHERE ID=?',dc).fetchval(),self.b)
  result=self.update(self.child,ParentTypeIDs=[self.a])
  self.assertEqual(result['Status'],'ERROR',result)
  self.assertTrue(self.cur.execute('SELECT dbo.fn_PackagingTypeUnder(?,?)',self.child,self.b).fetchval())
  self.assertEqual(self.cur.execute('SELECT ParentDimensionID FROM dbo.PackagingDimension WHERE ID=?',dc).fetchval(),db)
 def test_removing_unused_link_does_not_duplicate_or_delete_type(self):
  result=self.update(self.child,ParentTypeIDs=[self.b])
  self.assertEqual(result['Status'],'OK',result)
  self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PackagingType WHERE ID=?',self.child).fetchval(),1)
  self.assertEqual(self.cur.execute('SELECT ParentTypeID FROM dbo.PackagingType WHERE ID=?',self.child).fetchval(),self.b)
  self.assertNotIn(self.child,catalog(self.cur,self.a,'Primary')[1])
  self.assertIn(self.child,catalog(self.cur,self.b,'Primary')[1])
 def test_diamond_links_do_not_duplicate_components_or_hide_ancestor_dimensions(self):
  left=self.create('Left',ParentTypeIDs=[self.a],FinalComponent=False)
  right=self.create('Right',ParentTypeIDs=[self.a],FinalComponent=False)
  result=self.update(self.child,ParentTypeIDs=[left,right])
  self.assertEqual(result['Status'],'OK',result)
  paths=catalog(self.cur,self.a,'Primary')[1]
  self.assertEqual(set(n['ID'] for n in paths[self.child]),{self.child,left,right,self.a})
  self.assertEqual(len(paths[self.child]),4)
 def test_migration_is_idempotent(self):
  self.cur.execute((ROOT/'sql/128_packaging_type_multiple_parents.sql').read_text())
  while self.cur.nextset():pass
  self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.v_PackagingTypeEdges WHERE PackagingTypeID=?',self.child).fetchval(),2)

class MultiParentInput(unittest.TestCase):
 def test_api_array_and_legacy_compatibility(self):
  item=PackagingTypeRow(RowNum=1,Command='C',PackagingType='Seal',ParentTypeIDs=[2,3],FinalComponent=True)
  self.assertEqual(item.ParentTypeID,2);self.assertFalse(item.CopyDim)
  legacy=PackagingTypeRow(RowNum=1,Command='C',PackagingType='Seal',ParentTypeID=2,FinalComponent=True)
  self.assertEqual(legacy.ParentTypeID,2)
 def test_api_rejects_duplicate_self_shipping_and_invalid_arrays(self):
  for values in ({'ParentTypeIDs':[2,2]},{'ParentTypeIDs':[2], 'Shipping':True},{'ParentTypeIDs':[True]},{'ParentTypeIDs':None}):
   with self.subTest(values=values),self.assertRaises(ValidationError):
    PackagingTypeRow(RowNum=1,Command='C',PackagingType='Seal',**values)
 def test_previous_master_template_is_rejected(self):
  with self.assertRaisesRegex(ValidationError,"Download a fresh"):
   excel.Batch.model_validate(dict(template_version='master-3',rows=[]))
 def test_decode_preserves_legacy_and_explicit_links(self):
  rows=decode_orders([dict(ParentTypeID=1,ParentTypeIDsJSON='[1,2]',PackagingOrder='Primary'),dict(ParentTypeID=None,PackagingOrder='Primary')])
  self.assertEqual(rows[0]['ParentTypeIDs'],[1,2]);self.assertEqual(rows[1]['ParentTypeIDs'],[])
 def test_excel_accepts_multiple_parent_names_and_preserves_existing_links(self):
  ctx=AccessContext(1,'test',frozenset({'Admin'}))
  edit=type('Edit',(),dict(row=3,id=None,version=None,command='C',changes={'PackagingType':'Seal','ParentType':'Jar A; Jar B','FinalComponent':True}))()
  with patch.object(excel,'execute',side_effect=[[[{'ID':2}]],[[{'ID':3}]]]):
   data=excel.prepare('packaging-types',edit,{},ctx)
  self.assertEqual(data.rows[0].ParentTypeIDs,[2,3])
  edit=type('Edit',(),dict(row=3,id=1,command='U',version='AAAAAAAAAAE=',changes={'Status':'Block'}))()
  data=excel.prepare('packaging-types',edit,{'RowVersion':'AAAAAAAAAAE=','ParentTypeID':2,'ParentTypeIDsJSON':'[2,3]','PackagingType':'Seal','FinalComponent':True},ctx)
  self.assertEqual(data.rows[0].ParentTypeIDs,[2,3])

if __name__=='__main__':unittest.main()
