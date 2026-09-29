"""Raw Grade integration tests against local test; all schema and data roll back."""
import re,json,uuid,unittest,base64
from raw_material_sql_contract import SQLContracts as BaseSQL,ROOT
import raw_material_api as raw
import product_grades_api as grades
import packaging_master_api as masters
from product_grades import GradeSave
from auth import AccessContext
from fastapi import HTTPException

class RawGrades(BaseSQL):
 def setUp(self):
  super().setUp()
  for _ in range(2):
   for sql in re.split(r"^GO\s*$",(ROOT/"sql/41_raw_grade_master.sql").read_text(),flags=re.M|re.I):
    if sql.strip():
     self.cur.execute(sql)
     while self.cur.nextset():pass
  for sql in re.split(r"^GO\s*$",(ROOT/"sql/43_raw_grade_material_assign.sql").read_text(),flags=re.M|re.I):
   if sql.strip():
    self.cur.execute(sql)
    while self.cur.nextset():pass
  for sql in re.split(r"^GO\s*$",(ROOT/"sql/44_product_grade_parent_validation.sql").read_text(),flags=re.M|re.I):
   if sql.strip():
    self.cur.execute(sql)
    while self.cur.nextset():pass
  self.material=self.save("raw-materials",command="C",changes=dict(MaterialName="Raw Grade material",UnitOfMeasure="EA"))["NewID"]
  self.grade=self.maintain(MaterialID=self.material,GradeName="Grade A")
  self.assertEqual(self.grade["Status"],"OK",self.grade)
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active'").fetchval()
  self.product=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?,?,100,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())","RG-"+uuid.uuid4().hex[:15],"Raw Grade product "+uuid.uuid4().hex,customer,self.ctx.user_id).fetchval()
 def maintain(self,**values):
  return raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="C",**values)]),self.ctx)["results"][0]
 def save_grades(self,grade_id=None):
  token=base64.b64encode(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval()).decode()
  body=GradeSave(ProductRowVersion=token,Status="Active",items=[dict(ParentID="0",ID=1,Grade="untrusted label",RatioPct=100,RawGradeID=grade_id or self.grade["NewID"])])
  return grades.save(body,self.product,self.ctx)

 def test_optional_assignment_group_parent_and_product_selection(self):
  group=self.maintain(GradeName="Group unassigned",MaterialAssign=False,MaterialID=self.material)
  self.assertEqual(group["Status"],"OK",group)
  self.assertEqual(tuple(self.cur.execute("SELECT MaterialID,MaterialAssign FROM dbo.RawGrade WHERE ID=?",group["NewID"]).fetchone()),(None,False))
  child=self.maintain(GradeName="Group child",MaterialAssign=True,MaterialID=self.material,ParentGradeID=group["NewID"])
  self.assertEqual(child["Status"],"OK",child)
  missing=self.maintain(GradeName="Missing assignment",MaterialAssign=True)
  self.assertEqual(missing["Status"],"ERROR",missing)
  self.assertTrue(any(r["ID"]==group["NewID"] for r in grades.raw_grade_lookups(self.ctx)["rows"]))
  self.save_grades(group["NewID"])
  listed=masters.read("raw-grades",1,25,"Group unassigned",None,None,None,None,None,"[]",self.ctx)["rows"]
  self.assertTrue(listed[0]["AssignmentLocked"])
  self.assertFalse(listed[0]["MaterialAssign"])
 def test_assignment_can_clear_unused_but_not_used(self):
  def clear(record,name):
   return raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="U",ID=record["NewID"],RowVersion=record["NewRowVersion"],GradeName=name,MaterialAssign=False,MaterialID=self.material)]),self.ctx)["results"][0]
  unused=self.maintain(GradeName="Unused",MaterialID=self.material)
  self.assertEqual(clear(unused,"Unused")["Status"],"OK")
  self.assertIsNone(self.cur.execute("SELECT MaterialID FROM dbo.RawGrade WHERE ID=?",unused["NewID"]).fetchval())
  self.save_grades()
  denied=clear(self.grade,"Grade A")
  self.assertEqual(denied["Status"],"ERROR",denied)
  self.assertIn("Product versions",denied["Message"])

 def save_child_tree(self,child):
  token=base64.b64encode(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval()).decode()
  body=GradeSave(ProductRowVersion=token,Status="Draft",items=[
   dict(ParentID="0",ID=1,Grade="Root",RatioPct=100,RawGradeID=self.grade["NewID"]),
   dict(ParentID="0/1",ID=1,Grade="Child",RatioPct=100,RawGradeID=child["NewID"])])
  return grades.save(body,self.product,self.ctx)
 def test_product_child_parent_match(self):
  child=self.maintain(GradeName="Matching child",MaterialID=self.material,ParentGradeID=self.grade["NewID"])
  self.save_child_tree(child)
  options=grades.raw_grade_lookups(self.ctx)["rows"]
  self.assertEqual(next(g for g in options if g["ID"]==child["NewID"])["ParentGradeID"],self.grade["NewID"])
 def test_product_child_wrong_parent_rejected(self):
  other=self.maintain(GradeName="Other parent",MaterialAssign=False)
  child=self.maintain(GradeName="Wrong child",MaterialID=self.material,ParentGradeID=other["NewID"])
  with self.assertRaises(HTTPException) as error:self.save_child_tree(child)
  self.assertIn("Each child grade",str(error.exception.detail))
 def test_product_child_without_master_parent_rejected(self):
  child=self.maintain(GradeName="Unrelated root",MaterialAssign=False)
  with self.assertRaises(HTTPException) as error:self.save_child_tree(child)
  self.assertIn("Each child grade",str(error.exception.detail))

 def test_raw_pricing_current_tiers_conversions_and_missing(self):
  currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
  def price(start,end,status="Active",basis="EA",amount=25000,rate=25000):
   return self.cur.execute("""INSERT dbo.RawMaterialPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,
    ExchangeRateToUSD,EffectiveFrom,EffectiveTo,Status,CreatedBy)
    VALUES(?,?,?,0,?,?,DATEADD(day,?,CONVERT(date,SYSUTCDATETIME())),
    DATEADD(day,?,CONVERT(date,SYSUTCDATETIME())),?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
    self.material,currency,basis,amount,rate,start,end,status,self.ctx.user_id).fetchval()
  current=price(0,0)
  price(-5,-1);price(1,5);price(-5,5,"Block")
  missing_rate=price(-1,1,rate=None)
  missing_conversion=price(-1,1,basis="UNKNOWN")
  unit="TEST-"+uuid.uuid4().hex[:10]
  from_id=self.cur.execute("INSERT dbo.UoM(UoMCode,CreatedBy) VALUES(?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",unit,self.ctx.user_id).fetchval()
  to_id=self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode='EA'").fetchval()
  self.cur.execute("INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,RawMaterialID,CreatedBy) VALUES(?,?,10,?,?)",from_id,to_id,self.material,self.ctx.user_id)
  converted=price(-1,1,basis=unit,amount=250000)
  group=self.maintain(GradeName="Pricing group",MaterialAssign=False)
  result=grades.raw_pricing(grades.RawPricingQuery(grade_ids=[self.grade["NewID"],group["NewID"],self.grade["NewID"]]),self.ctx)
  rows=result["rows"];priced={r["PriceID"]:r for r in rows if r["PriceID"]}
  self.assertEqual(set(priced),{current,converted,missing_rate,missing_conversion})
  self.assertEqual(float(priced[current]["UnitUSDPrice"]),1)
  self.assertEqual(float(priced[converted]["BaseUnitUSDPrice"]),1)
  self.assertEqual(priced[missing_rate]["PricingStatus"],"Exchange rate required")
  self.assertIsNone(priced[missing_rate]["UnitUSDPrice"])
  self.assertEqual(priced[missing_conversion]["PricingStatus"],"Conversion required")
  self.assertFalse(any(r["RawGradeID"]==group["NewID"] for r in rows))
  self.assertEqual(grades.raw_pricing(grades.RawPricingQuery(grade_ids=[group["NewID"]]),self.ctx)["rows"],[])
  self.cur.execute("UPDATE dbo.RawMaterialPrice SET Status='Block' WHERE MaterialID=?",self.material)
  result=grades.raw_pricing(grades.RawPricingQuery(grade_ids=[self.grade["NewID"]]),self.ctx)
  self.assertEqual(result["rows"][0]["PricingStatus"],"No current price")
  self.assertIsNone(result["rows"][0]["UnitUSDPrice"])
 def test_raw_pricing_product_role_read_only_and_live_authorization(self):
  username="pricing-"+uuid.uuid4().hex[:12]
  uid=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",username).fetchval()
  self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Product')",uid)
  ctx=AccessContext(uid,username,frozenset({"Product"}))
  query=grades.RawPricingQuery(grade_ids=[self.grade["NewID"]])
  self.assertEqual(grades.raw_pricing(query,ctx)["rows"][0]["RawGradeID"],self.grade["NewID"])
  with self.assertRaises(HTTPException):
   grades.raw_pricing(query,AccessContext(uid,username,frozenset({"RawMaterial"})))
  self.cur.execute("DELETE dbo.UserAccess WHERE UserID=?",uid)
  with self.assertRaises(HTTPException):grades.raw_pricing(query,ctx)
 def test_link_snapshot_history_and_read(self):
  self.save_grades()
  row=self.cur.execute("SELECT Grade,RawGradeID FROM dbo.ProductGradeItem i JOIN dbo.ProductGradeVersion v ON v.ID=i.VersionID WHERE v.ProductID=?",self.product).fetchone()
  self.assertEqual(tuple(row),("Grade A",self.grade["NewID"]))
  changed=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="U",ID=self.grade["NewID"],RowVersion=self.grade["NewRowVersion"],MaterialID=self.material,GradeName="Renamed")]),self.ctx)["results"][0]
  self.assertEqual(changed["Status"],"OK",changed)
  self.assertEqual(self.cur.execute("SELECT Grade FROM dbo.ProductGradeItem WHERE RawGradeID=?",self.grade["NewID"]).fetchval(),"Grade A")
  data=masters.read("raw-grades",1,25,"Renamed",None,None,None,None,None,"[]",self.ctx)
  self.assertTrue(any(r["ID"]==self.grade["NewID"] for r in data["rows"]))
  options=grades.raw_grade_lookups(self.ctx)["rows"]
  self.assertTrue(any(r["ID"]==self.grade["NewID"] and r["MaterialID"]==self.material for r in options))
 def test_parent_lifecycle_and_cycle_rejection(self):
  parent=self.maintain(MaterialID=self.material,GradeName="Parent")
  child=self.maintain(MaterialID=self.material,GradeName="Child",ParentGradeID=parent["NewID"])
  self.assertEqual(child["Status"],"OK",child)
  def update(record,**values):
   return raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="U",ID=record["NewID"],RowVersion=record["NewRowVersion"],MaterialID=self.material,GradeName="Child",**values)]),self.ctx)["results"][0]
  kept=update(child)
  self.assertEqual(kept["Status"],"OK",kept)
  self.assertEqual(self.cur.execute("SELECT ParentGradeID FROM dbo.RawGrade WHERE ID=?",child["NewID"]).fetchval(),parent["NewID"])
  cycle=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="U",ID=parent["NewID"],RowVersion=parent["NewRowVersion"],MaterialID=self.material,GradeName="Parent",ParentGradeID=child["NewID"])]),self.ctx)["results"][0]
  self.assertEqual(cycle["Status"],"ERROR",cycle)
  self.assertIn("descendants",cycle["Message"])
  self_parent=update(kept,ParentGradeID=child["NewID"])
  self.assertEqual(self_parent["Status"],"ERROR",self_parent)
  cleared=update(kept,ParentGradeID=None)
  self.assertEqual(cleared["Status"],"OK",cleared)
  self.assertIsNone(self.cur.execute("SELECT ParentGradeID FROM dbo.RawGrade WHERE ID=?",child["NewID"]).fetchval())
 def test_parent_lookup_and_blocked_parent(self):
  parent=self.maintain(MaterialID=self.material,GradeName="Parent")
  child=self.maintain(MaterialID=self.material,GradeName="Child",ParentGradeID=parent["NewID"])
  view=masters.read("raw-grades",1,25,"Child",None,None,None,None,None,"[]",self.ctx)
  self.assertEqual(view["rows"][0]["ParentGradeName"],"Parent")
  self.assertTrue(any(g["ID"]==parent["NewID"] for g in masters.lookups(self.ctx,"raw-grades")["rawGrades"]))
  self.cur.execute("UPDATE dbo.RawGrade SET Status='Block' WHERE ID=?",parent["NewID"])
  bad=self.maintain(MaterialID=self.material,GradeName="Other child",ParentGradeID=parent["NewID"])
  self.assertEqual(bad["Status"],"ERROR",bad)
  kept=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="U",ID=child["NewID"],RowVersion=child["NewRowVersion"],MaterialID=self.material,GradeName="Child",ParentGradeID=parent["NewID"])]),self.ctx)["results"][0]
  self.assertEqual(kept["Status"],"OK",kept)
 def test_blocked_grade_rejected(self):
  self.cur.execute("UPDATE dbo.RawGrade SET Status='Block' WHERE ID=?",self.grade["NewID"])
  self.assertFalse(any(r["ID"]==self.grade["NewID"] for r in grades.raw_grade_lookups(self.ctx)["rows"]))
  with self.assertRaises(HTTPException):self.save_grades()
 def test_blocked_material_rejected(self):
  self.cur.execute("UPDATE dbo.RawMaterial SET Status='Block' WHERE ID=?",self.material)
  with self.assertRaises(HTTPException):self.save_grades()
 def test_relink_and_stale_rejected(self):
  self.save_grades()
  other=self.save("raw-materials",command="C",changes=dict(MaterialName="Other Raw",UnitOfMeasure="EA"))["NewID"]
  reply=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="U",ID=self.grade["NewID"],RowVersion=self.grade["NewRowVersion"],MaterialID=other,GradeName="Grade A")]),self.ctx)["results"][0]
  self.assertEqual(reply["Status"],"ERROR",reply)
  self.assertIn("Create a new grade",reply["Message"])
  self.cur.execute("UPDATE dbo.RawGrade SET GradeName='Changed' WHERE ID=?",self.grade["NewID"])
  reply=raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="D",ID=self.grade["NewID"],RowVersion=self.grade["NewRowVersion"])]),self.ctx)["results"][0]
  self.assertEqual(reply["Status"],"ERROR",reply)
 def test_product_role_can_lookup_but_not_maintain(self):
  name="RG-"+uuid.uuid4().hex[:15]
  uid=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",name).fetchval()
  self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Product')",uid)
  ctx=AccessContext(uid,name,frozenset({"Product"}))
  self.assertTrue(any(r["ID"]==self.grade["NewID"] for r in grades.raw_grade_lookups(ctx)["rows"]))
  with self.assertRaises(HTTPException):raw.grade_save(raw.RawGradeBatch(rows=[dict(RowNum=1,Command="C",MaterialID=self.material,GradeName="Denied")]),ctx)
 def test_legacy_history_not_guessed(self):
  version=self.cur.execute("INSERT dbo.ProductGradeVersion(ProductID,Version,Status,CreatedBy) VALUES(?,1,'Inactive',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.product,self.ctx.user_id).fetchval()
  self.cur.execute("INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct) VALUES(?,'0',1,'Legacy grade',100)",version)
  saved=grades.read(self.product,self.ctx)["items"][0]
  self.assertEqual(saved["Grade"],"Legacy grade");self.assertIsNone(saved["RawGradeID"])
  token=base64.b64encode(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval()).decode()
  with self.assertRaises(HTTPException):grades.save(GradeSave(ProductRowVersion=token,items=[dict(ParentID="0",ID=1,Grade="Legacy grade",RatioPct=100)]),self.product,self.ctx)

if __name__=="__main__":unittest.main()
