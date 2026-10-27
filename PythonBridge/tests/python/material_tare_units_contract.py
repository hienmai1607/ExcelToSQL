"""New mass-unit bases and legacy snapshot compatibility; SQL changes roll back."""
import sys
import unittest
from decimal import Decimal as D
from pathlib import Path
from contextlib import ExitStack
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from packaging_weight import material_tare,tare_basis_label
from packaging_api import PackagingMaterialRow,MaterialBatch,material_save
from pydantic import ValidationError
import db
from auth import AccessContext

class TareUnits(unittest.TestCase):
 def test_count_grams_and_kg_are_equivalent(self):
  self.assertEqual(material_tare('600','g',2,base_uom='EA'),D('1.2'))
  self.assertEqual(material_tare('.6','kg',2,base_uom='EA'),D('1.2'))
 def test_square_meter_grams_and_kg_are_equivalent(self):
  self.assertEqual(material_tare('600','g',2,D('.5'),'m2'),D('.6'))
  self.assertEqual(material_tare('.6','kg',2,D('.5'),'m2'),D('.6'))
  self.assertIsNone(material_tare(600,'g',1,base_uom='m2'))
 def test_explicit_consumption_in_other_base_units(self):
  self.assertEqual(material_tare(10,'g',1,base_uom='LM',base_quantity='2.5'),D('.025'))
 def test_legacy_semantics_are_preserved(self):
  self.assertEqual(material_tare('.6','kg/EA',2,D('.5'),'m2'),D('1.2'))
  self.assertEqual(material_tare('.6','kg/m2',2,D('.5'),'EA'),D('.6'))
 def test_zero_missing_labels_and_validation(self):
  self.assertEqual(material_tare(0,'g',2,base_uom='EA'),0)
  self.assertIsNone(material_tare(None,'g',2,base_uom='EA'))
  for unit in ('g','kg'):self.assertEqual(tare_basis_label(unit,'ROLL'),unit+'/ROLL')
  self.assertEqual(tare_basis_label('kg/EA','m2'),'kg/EA')
  for value in ('g','kg','kg/EA','kg/m2'):PackagingMaterialRow(RowNum=1,Command='C',TareWeight=1,TareWeightBasis=value)
  with self.assertRaises(ValidationError):PackagingMaterialRow(RowNum=1,Command='C',TareWeightBasis='lb')

class TareUnitsSQL(unittest.TestCase):
 def setUp(self):
  if db.DB_NAME!='test' or db.DB_SERVER.lower() not in ('desktop-5bgmjsc','localhost','.'):
   self.skipTest('Desktop test only')
  self.stack=ExitStack();self.addCleanup(self.stack.close)
  self.cur=self.stack.enter_context(db.get_raw_cursor())
  self.before=[tuple(r) for r in self.cur.execute("SELECT name,definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.PackagingMaterial') ORDER BY name").fetchall()]
  self.cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
  self.stack.callback(lambda:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
  self.stack.enter_context(db.reuse_transaction(self.cur.connection))
  self.created=[]
  source=(Path(__file__).resolve().parents[2]/'sql/150_material_tare_mass_units.sql').read_text(encoding='utf-8')
  for _ in range(2):
   self.cur.execute(source)
   while self.cur.nextset():pass
  self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),1)
  identity,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
  self.ctx=AccessContext(identity,name,frozenset({'Admin'}))
 def tearDown(self):
  if not hasattr(self,'created'):return
  self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  self.assertEqual([tuple(r) for r in self.cur.execute("SELECT name,definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.PackagingMaterial') ORDER BY name").fetchall()],self.before)
  for identity in self.created:self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PackagingMaterial WHERE ID=?',identity).fetchval(),0)
 def test_api_saves_and_reopens_mass_bases_for_material_base_uom(self):
  for uom,basis in [('EA','g'),('m2','kg')]:
   reply=material_save(MaterialBatch(rows=[dict(RowNum=1,Command='C',MaterialName='Tare units '+uuid4().hex[:8],UnitOfMeasure=uom,TareWeight=600,TareWeightBasis=basis)]),self.ctx)['results'][0]
   self.assertEqual(reply['Status'],'OK',reply);self.created.append(reply['NewID'])
   row=self.cur.execute('SELECT TareWeight,TareWeightBasis,UnitOfMeasure FROM dbo.PackagingMaterial WHERE ID=?',reply['NewID']).fetchone()
   self.assertEqual(tuple(row),(D(600),basis,uom))

class PendingTareMigration(unittest.TestCase):
 def test_pending_migration_returns_clear_validation_before_any_write(self):
  from fastapi import HTTPException
  if db.DB_NAME!='test':self.skipTest('Desktop test only')
  with db.get_raw_cursor() as cur,ExitStack() as stack:
   cur.execute('SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
   stack.callback(lambda:cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
   stack.enter_context(db.reuse_transaction(cur.connection))
   if cur.execute("SELECT OBJECT_ID('dbo.CK_PackagingMaterial_TareMassUnit')").fetchval():
    cur.execute('ALTER TABLE dbo.PackagingMaterial DROP CONSTRAINT CK_PackagingMaterial_TareMassUnit')
   identity,name=cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
   label='Pending tare '+uuid4().hex
   with self.assertRaises(HTTPException) as error:
    material_save(MaterialBatch(rows=[dict(RowNum=1,Command='C',MaterialName=label,UnitOfMeasure='m2',TareWeight=83.34,TareWeightBasis='g')]),AccessContext(identity,name,frozenset({'Admin'})))
   self.assertEqual(error.exception.status_code,422)
   self.assertIn('migration 150',error.exception.detail)
   self.assertEqual(cur.execute('SELECT COUNT(*) FROM dbo.PackagingMaterial WHERE MaterialName=?',label).fetchval(),0)

if __name__=='__main__':unittest.main()
