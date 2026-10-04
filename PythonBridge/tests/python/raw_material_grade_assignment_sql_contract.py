"""Rollback-only checks for migration 45's material-owned grade assignment."""
import unittest
import base64
import uuid
from raw_material_sql_contract import SQLContracts
import raw_material_api as raw
import packaging_master_api as masters
import product_grades_api as products
from packaging_api import PriceBatch
from product_grades import GradeSave
from fastapi import HTTPException

class MaterialGradeAssignment(SQLContracts):
 def grade(self,name,parent=None):
  payload=raw.RawGradeBatch(rows=[dict(RowNum=1,Command="C",GradeName=name,ParentGradeID=parent)])
  result=raw.grade_save(payload,self.ctx)["results"][0]
  self.assertEqual(result["Status"],"OK",result)
  return result

 def test_leaf_only_assignment_and_pricing(self):
  root=self.grade("Assignment root")
  leaf=self.grade("Assignment leaf",root["NewID"])
  material=raw.material_save(raw.RawMaterialBatch(rows=[dict(RowNum=1,Command="C",MaterialName="Assigned leaf",UnitOfMeasure="EA",GradeID=leaf["NewID"])]),self.ctx)["results"][0]
  self.assertEqual(material["Status"],"OK",material)
  self.assertEqual(self.cur.execute("SELECT GradeID FROM dbo.RawMaterial WHERE ID=?",material["NewID"]).fetchval(),leaf["NewID"])
  self.assertIsNone(self.cur.execute("SELECT MaterialID FROM dbo.RawGrade WHERE ID=?",leaf["NewID"]).fetchval())
  bad=raw.material_save(raw.RawMaterialBatch(rows=[dict(RowNum=2,Command="C",MaterialName="Bad parent",UnitOfMeasure="EA",GradeID=root["NewID"])]),self.ctx)["results"][0]
  self.assertEqual(bad["Status"],"ERROR",bad)
  self.assertIn("leaf",bad["Message"])
  late_child=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=3,Command="C",GradeName="Late child",ParentGradeID=leaf["NewID"])]),self.ctx)["results"][0]
  self.assertEqual(late_child["Status"],"ERROR",late_child)
  self.assertIn("cannot become a parent",late_child["Message"])
  listed=masters.read(entity="raw-materials",page=1,page_size=500,search="",status=None,material_id=None,currency_id=None,as_of=None,created_by=None,sort="[]",ctx=self.ctx)["rows"]
  self.assertEqual(next(r for r in listed if r["ID"]==material["NewID"])["GradeName"],"Assignment leaf")
  prices=products.raw_pricing(products.RawPricingQuery(grade_ids=[root["NewID"],leaf["NewID"]]),self.ctx)["rows"]
  self.assertEqual([r["RawGradeID"] for r in prices],[leaf["NewID"]])
  self.assertEqual(prices[0]["PricingStatus"],"No current price")
  usd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  price=raw.price_save(PriceBatch(rows=[dict(RowNum=4,Command="C",MaterialID=material["NewID"],CurrencyID=usd,BaseUoM="EA",QuantityFrom=0,UnitPrice=2,EffectiveFrom="2020-01-01")]),self.ctx)["results"][0]
  self.assertEqual(price["Status"],"OK",price)
  current=products.raw_pricing(products.RawPricingQuery(grade_ids=[leaf["NewID"]]),self.ctx)["rows"]
  self.assertEqual(current[0]["PricingStatus"],"Current")
  self.assertEqual(current[0]["MaterialCode"],material["NewMaterialCode"])

 def product_material_fixture(self):
  root=self.grade("Product root")
  leaf=self.grade("Product child",root["NewID"])
  other=self.grade("Other child",root["NewID"])
  material=raw.material_save(raw.RawMaterialBatch(rows=[dict(RowNum=1,Command="C",MaterialName="Selected raw",UnitOfMeasure="EA",GradeID=leaf["NewID"])]),self.ctx)["results"][0]
  self.assertEqual(material["Status"],"OK",material)
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active'").fetchval()
  product=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?,?,100,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())","RG-"+uuid.uuid4().hex[:15],"Material choice",customer,self.ctx.user_id).fetchval()
  def token():return base64.b64encode(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",product).fetchval()).decode()
  def item(grade_id,material_id):
   return [dict(ParentID="0",ID=1,Grade="Root",RatioPct=100,RawGradeID=root["NewID"],RawMaterialID=None),
           dict(ParentID="0/1",ID=1,Grade="Child",RatioPct=100,RawGradeID=grade_id,RawMaterialID=material_id)]
  return root,leaf,other,material,product,token,item

 def test_product_child_material_is_saved_and_checked(self):
  root,leaf,other,material,product,token,item=self.product_material_fixture()
  saved=products.save(GradeSave(ProductRowVersion=token(),Status="Active",items=item(leaf["NewID"],material["NewID"])),product,self.ctx)
  self.assertEqual(saved["Status"],"Active")
  selected=self.cur.execute("SELECT RawMaterialID FROM dbo.ProductGradeItem WHERE VersionID=? AND ParentID='0/1'",saved["ID"]).fetchval()
  self.assertEqual(selected,material["NewID"])
  self.assertEqual(next(i for i in products.read(product,self.ctx)["items"] if i["ParentID"]=="0/1")["RawMaterialID"],material["NewID"])
  with self.assertRaises(HTTPException):
   products.save(GradeSave(ProductRowVersion=token(),items=item(other["NewID"],material["NewID"])),product,self.ctx)

 def test_product_root_material_rejected(self):
  root,leaf,other,material,product,token,item=self.product_material_fixture()
  invalid_root=item(leaf["NewID"],None)
  invalid_root[0]["RawMaterialID"]=material["NewID"]
  with self.assertRaises(HTTPException):
   products.save(GradeSave(ProductRowVersion=token(),items=invalid_root),product,self.ctx)

if __name__=="__main__":unittest.main()
