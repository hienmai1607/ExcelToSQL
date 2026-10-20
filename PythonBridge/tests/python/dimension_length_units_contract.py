"""Length-only physical dimension units; fixtures and schema changes roll back."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
import packaging_multiple_parents_contract as parents
import packaging_dimension_api as api
from auth import AccessContext
from fastapi import HTTPException

class DimensionLengthSQL(unittest.TestCase):
 save=parents.MultiParentSQL.save
 create=parents.MultiParentSQL.create
 tearDown=parents.MultiParentSQL.tearDown
 def setUp(self):
  parents.MultiParentSQL.setUp(self)
  self.cur.execute((ROOT/'sql/129_dimension_length_units.sql').read_text())
  while self.cur.nextset():pass
 def definition(self,code,status='Active'):
  unit=self.cur.execute('SELECT ID FROM dbo.UoM WHERE UoMCode=?',code).fetchval()
  self.cur.execute("EXEC dbo.usp_PackagingDimension_SaveV2 @Username=?,@PackagingTypeID=?,@D1=N'Length',@D1UoMID=?,@Status=?",self.actor,self.a,unit,status)
  return dict(zip([c[0] for c in self.cur.description],self.cur.fetchone()))
 def test_length_unit_is_accepted(self):
  self.assertTrue(self.definition('mm')['ID'])
 def test_count_is_rejected(self):
  with self.assertRaisesRegex(Exception,'Length/Distance'):self.definition('EA')
 def test_mass_is_rejected(self):
  with self.assertRaisesRegex(Exception,'Length/Distance'):self.definition('g')
 def test_blocked_legacy_definition_is_preserved(self):
  self.assertTrue(self.definition('g','Block')['ID'])
 def test_migration_is_idempotent(self):
  self.cur.execute((ROOT/'sql/129_dimension_length_units.sql').read_text())
  while self.cur.nextset():pass
  self.assertTrue(self.definition('mm')['ID'])

class PreviewUnits(unittest.TestCase):
 def test_preview_rejects_non_length_measurements(self):
  body=api.FormulaRoleTest(PackagingTypeID=1,D1='Length',D1UoMID=2,FormulaRole='OccupiedM2Formula',OccupiedM2Formula='D1',TestD1=1)
  with patch.object(api,'execute',return_value=[[dict(ID=2,Status='Active',Category='Weight/Mass')],[dict(ParentTypeID=None,RootTypeID=1,Shipping=True,Status='Active',PriceBasis='Count')]]):
   with self.assertRaises(HTTPException) as result:api.preview_formula(body,AccessContext(1,'test',frozenset({'Admin'})))
  self.assertIn('Length/Distance',result.exception.detail)
 def test_formula_output_can_still_be_count(self):
  body=api.FormulaRoleTest(PackagingTypeID=2,D1='Length',D1UoMID=2,ConversionOutputUoMID=3,FormulaRole='ConvertFromSupplierFormula',ConvertFromSupplierFormula='1')
  with patch.object(api,'execute',return_value=[[dict(ID=2,Status='Active',Category='Length/Distance'),dict(ID=3,Status='Active',Category='Unit/Count',UoMCode='EA')],[dict(ParentTypeID=1,RootTypeID=1,Shipping=False,Status='Active',PriceBasis='Count')]]):
   result=api.preview_formula(body,AccessContext(1,'test',frozenset({'Admin'})))
  self.assertEqual(result['OutputUnit'],'EA')
  self.assertEqual(result['CalculationStatus'],'Ready')

if __name__=='__main__':unittest.main()
