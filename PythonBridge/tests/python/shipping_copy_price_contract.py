"""Current-schema price regression; all fixture writes explicitly roll back."""
import sys,json,unittest,base64
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from db import get_raw_cursor
from packaging_fields import consume
from auth import AccessContext
import packaging_api as api

class ShippingCopyPrice(unittest.TestCase):
 def setUp(self):
  self.connection=get_raw_cursor();self.cur=self.connection.__enter__();self.addCleanup(self.cleanup)
  self.cur.execute("SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION")
  actor,user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.ctx=AccessContext(actor,user,frozenset({"Admin"}));self.actor=actor
  self.currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
 def cleanup(self):
  try:self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.connection.__exit__(None,None,None)
 def material(self,shipping):
  source=self.cur.execute("""SELECT TOP(1) m.PackagingTypeID,m.MaterialDimensionID,m.MaterialDimensionRowVersion,m.MaterialD1,m.MaterialD2,m.MaterialD3,m.UnitOfMeasure
   FROM dbo.PackagingMaterial m JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID
   WHERE t.CopyDim=1 AND t.FinalComponent=1 AND t.Shipping=? AND t.Status='Active'
   AND ((?=0 AND m.MaterialDimensionID IS NULL) OR (?=1 AND m.MaterialDimensionID IS NOT NULL)) ORDER BY m.ID""",shipping,shipping,shipping).fetchone()
  if source is None:self.skipTest("No matching current material for regression")
  identity=self.cur.execute("""INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,PackagingTypeID,MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3,UnitOfMeasure,CreatedBy)
   VALUES(?,?,?,?,?,?,?,?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""","REG-"+uuid4().hex,"Copy regression",*source,self.actor).fetchval()
  return identity,source[-1]
 def price(self,shipping,missing_dimensions=False):
  identity,unit=self.material(shipping)
  if missing_dimensions:self.cur.execute("UPDATE dbo.PackagingMaterial SET MaterialDimensionID=NULL,MaterialDimensionRowVersion=NULL,MaterialD1=NULL,MaterialD2=NULL,MaterialD3=NULL WHERE ID=?",identity)
  def execute(sql,args):
   self.cur.execute(sql,*args);sets=consume(self.cur)
   for rows in sets:
    for r in rows:
     for k,v in list(r.items()):
      if isinstance(v,(bytes,bytearray)):r[k]=base64.b64encode(v).decode()
     v=r.get("MaterialDimensionRowVersion")
     if isinstance(v,str) and v.startswith("0x"):r["MaterialDimensionRowVersion"]=base64.b64encode(bytes.fromhex(v[2:])).decode()
   return sets
  with patch.object(api,"execute",execute):
   result=api.price_save(api.PackagingPriceBatch(rows=[dict(RowNum=1,Command="C",MaterialID=identity,CurrencyID=self.currency,PriceBasis=unit,QuantityFrom=1,UnitPrice=1,EffectiveFrom="2026-10-19")]),self.ctx)
  return result["results"][0]
 def test_nonshipping_single_catalog_keeps_copy_dim_for_own_material(self):
  import pkg_pricing_api as pricing
  type_id=self.cur.execute("""INSERT dbo.PackagingType
   (PackagingType,PackagingOrder,PriceBasis,FinalComponent,CopyDim,Shipping,TareWeight,CreatedBy)
   VALUES(?,'Secondary','Count',1,1,0,0,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""","Single copy "+uuid4().hex,self.actor).fetchval()
  order="Secondary"
  identity=self.cur.execute("""INSERT dbo.PackagingMaterial
   (MaterialCode,MaterialName,PackagingTypeID,UnitOfMeasure,CreatedBy)
   VALUES(?,?,?,'EA',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""","REG-"+uuid4().hex,"Single own material",type_id,self.actor).fetchval()
  root,paths,units,dimensions,prices=pricing.catalog(self.cur,type_id,order)
  self.assertFalse(root["Shipping"]);self.assertTrue(root["CopyDim"])
  self.assertEqual(set(paths),{type_id})
  own=[p for p in prices if p["MaterialID"]==identity]
  self.assertTrue(own);self.assertTrue(all(p["CopyDim"] for p in own))
 def test_nonshipping_single_price_needs_no_physical_dimensions(self):
  self.assertEqual(self.price(False)["Status"],"OK")
 def test_shipping_single_price_uses_material_owned_dimensions(self):
  self.assertEqual(self.price(True)["Status"],"OK")

 def test_shipping_single_without_dimensions_points_to_material_not_pricing(self):
  with self.assertRaisesRegex(Exception,"Packaging Material"):self.price(True,True)
if __name__=="__main__":unittest.main()
