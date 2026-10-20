"""Current-schema, rollback-only Origin persistence and workbook contracts."""
import re,sys,unittest,io,zipfile
from pathlib import Path
from unittest.mock import patch
from pydantic import ValidationError
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from db import get_raw_cursor,bytes_to_b64
from auth import AccessContext
from packaging_fields import consume
from raw_material_api import RawMaterialBatch,RawMaterialRow,material_save
from master_models import MasterLayout,check_layout
import packaging_master_excel_api as excel
from excel_template_version import TEMPLATE_VERSIONS
ROOT=Path(__file__).resolve().parents[2]

class RawMaterialOrigin(unittest.TestCase):
 def setUp(self):
  self.context=get_raw_cursor();self.cur=self.context.__enter__();self.addCleanup(self.cleanup)
  self.cur.execute("SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION")
  for sql in ([] if self.cur.execute("SELECT COL_LENGTH('dbo.RawMaterial','Origin')").fetchval() else re.split(r'^GO *$',(ROOT/'sql/131_raw_material_origin.sql').read_text(),flags=re.M|re.I)):
   if sql.strip():
    self.cur.execute(sql)
    while self.cur.nextset():pass
  actor,user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.ctx=AccessContext(actor,user,frozenset({'Admin'}))
  self.unit=self.cur.execute("SELECT TOP(1) UoMCode FROM dbo.UoM WHERE Status='Active' ORDER BY ID").fetchval()
 def cleanup(self):
  try:self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.context.__exit__(None,None,None)
 def save(self,**values):
  def execute(sql,params):
   self.cur.execute(sql,*params);return consume(self.cur)
  with patch('packaging_api.execute',execute):
   return material_save(RawMaterialBatch(rows=[dict(RowNum=1,**values)]),self.ctx)['results'][0]
 def create(self):
  result=self.save(Command='C',MaterialName='Origin regression',UnitOfMeasure=self.unit,Origin='Vietnam',Description='Historical free text')
  self.assertEqual(result['Status'],'OK',result)
  return result['NewID']
 def values(self,identity):
  return self.cur.execute("SELECT Origin,Description,RowVersion FROM dbo.RawMaterial WHERE ID=?",identity).fetchone()
 def test_create_update_and_clear_origin_preserve_retired_description(self):
  identity=self.create();row=self.values(identity);self.assertEqual(row[0],'Vietnam')
  result=self.save(Command='U',ID=identity,RowVersion=bytes_to_b64(row[2]),MaterialName='Origin regression',UnitOfMeasure=self.unit,Origin='Thailand')
  self.assertEqual(result['Status'],'OK',result);row=self.values(identity)
  self.assertEqual(tuple(row[:2]),('Thailand','Historical free text'))
  result=self.save(Command='U',ID=identity,RowVersion=bytes_to_b64(row[2]),MaterialName='Origin regression',UnitOfMeasure=self.unit,Origin=None)
  self.assertEqual(result['Status'],'OK',result);self.assertEqual(tuple(self.values(identity)[:2]),(None,'Historical free text'))
 def test_unrelated_save_keeps_origin_and_stale_save_rejects(self):
  identity=self.create();row=self.values(identity)
  result=self.save(Command='U',ID=identity,RowVersion=bytes_to_b64(row[2]),MaterialName='Changed label',UnitOfMeasure=self.unit)
  self.assertEqual(result['Status'],'OK',result);self.assertEqual(tuple(self.values(identity)[:2]),('Vietnam','Historical free text'))
  result=self.save(Command='U',ID=identity,RowVersion=bytes_to_b64(row[2]),MaterialName='Stale label',UnitOfMeasure=self.unit,Origin='Wrong')
  self.assertEqual(result['Status'],'ERROR');self.assertEqual(self.values(identity)[0],'Vietnam')
 def test_layout_and_workbook_retire_description_and_offer_origin(self):
  layout=check_layout('raw-materials',MasterLayout(columns=['Description','Origin'],filters=[],sort=[dict(column='Description',direction='asc')],column_widths={'Description':200}))
  self.assertNotIn('Description',layout.columns);self.assertIn('Origin',layout.columns);self.assertEqual(layout.sort,[])
  blob=excel.build('raw-materials',excel.View(layout=layout),dict(rows=[],total=0),'http://localhost:8000')
  with zipfile.ZipFile(io.BytesIO(blob)) as archive:
   sheet=archive.read('xl/worksheets/sheet1.xml').decode()
   self.assertIn('Origin',sheet);self.assertNotIn('Description',sheet)
  with self.assertRaises(ValidationError):excel.Batch.model_validate(dict(rows=[],template_version='master-4'))
  self.assertEqual(TEMPLATE_VERSIONS['masters'],'master-5')
 def test_origin_length_and_sparse_flags(self):
  with self.assertRaises(ValidationError):RawMaterialRow(RowNum=1,Command='C',Origin='x'*201)
  self.assertFalse(RawMaterialRow(RowNum=1,Command='U').OriginSet)
  self.assertTrue(RawMaterialRow(RowNum=1,Command='U',Origin=None).OriginSet)
if __name__=='__main__':unittest.main()
