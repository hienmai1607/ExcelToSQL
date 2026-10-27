"""Replay real pricing, gross weight and costing with gram-based replica masters.
Migration 150 is evaluated inside the existing audit transaction and rolled back.
"""
from opportunity_replica_audit import *

class GramsAudit(Audit):
 def convert(self,values):
  values=dict(values)
  unit=str(values.get('UnitOfMeasure') or '')
  if values.get('TareWeight') is not None and str(values.get('TareWeightBasis')).lower()=='kg/'+unit.lower():
   values.update(TareWeight=Decimal(str(values['TareWeight']))*1000,TareWeightBasis='g')
  return values
 def exact_case(self):
  self.cur.execute((Path(__file__).resolve().parents[2]/'sql/150_material_tare_mass_units.sql').read_text(encoding='utf-8'))
  while self.cur.nextset():pass
  self.check(self.cur.execute('SELECT @@TRANCOUNT').fetchval()==1,'tare constraint migration remains within rollback transaction')
  super().exact_case()
 def master(self,entity,model,save,values,table):
  return super().master(entity,model,save,self.convert(values) if table=='PackagingMaterial' else values,table)
 def clone(self,table,identity):
  cloned=super().clone(table,identity)
  if table=='PackagingMaterial' and cloned in self.manifest.get(table,[]):
   original=self.one(table,cloned);values=self.convert(original)
   if values.get('TareWeightBasis')!=original.get('TareWeightBasis'):
    self.cur.execute('UPDATE dbo.PackagingMaterial SET TareWeight=?,TareWeightBasis=? WHERE ID=?',values.get('TareWeight'),values.get('TareWeightBasis'),cloned)
  return cloned

if __name__=='__main__':GramsAudit().run()
