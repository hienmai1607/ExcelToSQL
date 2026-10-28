"""Self-contained bundle checks and rollback-only desktop rerun verification."""
import hashlib
import re
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
NAMES=('148_shipment_incoterms_warehouse_cost.sql', '149_approved_packaging_feedback.sql', '150_material_tare_mass_units.sql', '151_unpriced_pallet_material_choices.sql','152_tcb_quaternary_loss_assignment.sql')
BUNDLE=ROOT/'sql/deploy/upgrade_148_to_152_vm.sql'

def sections():
 source=BUNDLE.read_text(encoding='utf-8-sig')
 blocks=[]
 for name in NAMES:
  section=source.split('-- BEGIN MIGRATION '+name+'\n',1)[1].split('-- END MIGRATION '+name,1)[0]
  blocks.append(section.split('GO\n',1)[1].rstrip().removesuffix('GO').rstrip())
 return source,blocks

def execute(cursor,source):
 for block in re.split(r'^\s*GO\s*$',source,flags=re.M|re.I):
  if block.strip():
   cursor.execute(block)
   while cursor.nextset():pass

class BundleContract(unittest.TestCase):
 def test_ordered_exact_sources(self):
  source,blocks=sections()
  self.assertEqual(re.findall(r'-- BEGIN MIGRATION (\S+)',source),list(NAMES))
  for name,block in zip(NAMES,blocks):self.assertEqual(block.strip(),(ROOT/'sql'/name).read_text(encoding='utf-8-sig').strip(),name)

 def test_standalone_target_and_transaction_guards(self):
  source,_=sections()
  self.assertTrue(source.startswith(':on error exit\n'))
  executable=re.sub(r'/\*.*?\*/|--[^\n]*','',source,flags=re.S)
  self.assertFalse(re.search(r'^\s*(?:USE\s|:r\s)',executable,re.M|re.I))
  self.assertFalse(re.search(r'\b(?:TRUNCATE\s+TABLE|DROP\s+TABLE|DROP\s+DATABASE|DELETE\s+FROM)\b',source,re.I))
  for marker in ('DB_NAME() IN','compatibility_level','Apply migrations through 147','NOT atomic','IF @@TRANCOUNT<>0','existing business rows and snapshots are unchanged'):
   self.assertIn(marker,source)
  self.assertFalse(re.search(r'(?m)^\s*DELETE\s',source,re.I))

 def test_final_verification_covers_five_migrations(self):
  source,_=sections();verify=source.split('-- VERIFY UPGRADE\n',1)[1]
  for marker in ('(148)','(149)','CK_PackagingMaterial_TareMassUnit','(151)','(152)','is_not_trusted=0','IF @@TRANCOUNT<>0'):
   self.assertIn(marker,verify)

class BundleSQL(unittest.TestCase):
 def test_twice_rerun_preserves_business_data(self):
  import db
  self.assertEqual(db.DB_NAME,'test','Desktop test only; never run this on the VM')
  self.assertIn(db.DB_SERVER.lower(),('desktop-5bgmjsc','localhost','.'))
  source,blocks=sections()
  preflight=source.split('-- BEGIN MIGRATION ',1)[0].replace(':on error exit\n','',1)
  verification=source.split('-- VERIFY UPGRADE\n',1)[1]
  tables=('Opportunity','OpportunityItem','Customer','Product','RawGrade','RawMaterial','RawMaterialPrice','PackagingType','PackagingTypeOrder','PackagingDimension','PackagingMaterial','PackagingPrice','LossProcessMaster','GradeProcessLossMaster','PackagingConfigurationRequest','PackagingConfigurationRequestItem','PkgPricingMaster','PalletPricingSnapshot','ContainerLoadPlan','ResponseContainerLoadPlan','OpportunityMixSnapshot','PackagingLayerMigrationArchive')
  with db.get_raw_cursor() as cursor:
   execute(cursor,preflight)
   def snapshot(table):
    keys=[r[0] for r in cursor.execute('''SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(?) AND i.is_primary_key=1 ORDER BY ic.key_ordinal''','dbo.'+table).fetchall()]
    self.assertTrue(keys,table+' must have deterministic primary-key ordering')
    order=','.join('['+key.replace(']',']]')+']' for key in keys)
    rows=cursor.execute('SELECT * FROM dbo.['+table+'] ORDER BY '+order+' FOR JSON PATH,INCLUDE_NULL_VALUES').fetchall()
    return hashlib.sha256(''.join(str(r[0]) for r in rows).encode('utf-8')).hexdigest()
   before={table:snapshot(table) for table in tables}
   try:
    cursor.execute('BEGIN TRANSACTION')
    for _ in range(2):
     for block in blocks:execute(cursor,block)
     self.assertEqual(cursor.execute('SELECT @@TRANCOUNT').fetchval(),1)
     for table in tables:self.assertEqual(before[table],snapshot(table),table)
   finally:cursor.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION')
   execute(cursor,verification)
   for table in tables:self.assertEqual(before[table],snapshot(table),table+' after rollback')

if __name__=='__main__':unittest.main()
