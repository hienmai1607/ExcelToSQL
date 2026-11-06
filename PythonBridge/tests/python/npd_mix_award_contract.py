"""Rollback integration: Mix children inherit the parent's estimated award."""
import json
import sys
import unittest
from decimal import Decimal
from pathlib import Path
from datetime import date
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
import npd_api as api
from db import engine,reuse_transaction
from auth import AccessContext
from npd_recipes import awarded_mt,obj


class MixAward(unittest.TestCase):
 def test_parent_award_drives_child_choices_and_captured_recipe_quantity(self):
  connection=engine.raw_connection();cur=connection.cursor()
  self.assertEqual(cur.execute('SELECT DB_NAME()').fetchval(),'test')
  cur.execute('BEGIN TRANSACTION')
  try:
   with reuse_transaction(connection):
    actor=cur.execute("SELECT ID,UserName FROM dbo.Users WHERE UserName='Admin' AND IsActive=1").fetchone()
    ctx=AccessContext(actor[0],actor[1],frozenset({'Admin'}))
    row=api.one(cur,"""SELECT TOP(1) i.ID,i.ParentItemID,i.ProductGradeSnapshot FROM dbo.OpportunityItem i
     JOIN dbo.Opportunity o ON o.ID=i.OpportunityID
     WHERE i.ParentItemID IS NOT NULL AND o.Stage='Draft' AND i.Stage='Draft'
      AND i.ProductNetWeightGrams>0 AND i.AnnualUnit>0
      AND NOT EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID AND r.IsLinked=1)
      AND JSON_QUERY(i.ProductGradeSnapshot,'$.items')<>'[]' ORDER BY i.ID DESC""")
    snapshot=obj(row['ProductGradeSnapshot']);snapshot['RequiresRecipeConfirmation']=True
    cur.execute('UPDATE dbo.OpportunityItem SET EstPctAwarded=NULL,ProductGradeSnapshot=? WHERE ID=?',json.dumps(snapshot),row['ID'])
    cur.execute('UPDATE dbo.OpportunityItem SET EstPctAwarded=60 WHERE ID=?',row['ParentItemID'])
    choice=api.one(cur,'SELECT '+api.OPPORTUNITY_SELECT+' '+api.OPPORTUNITY_SOURCE+' WHERE i.ID=?',row['ID'])
    self.assertEqual(Decimal(str(choice['EstPctAwarded'])),60,'Mix children must use the parent award percentage')
    expected=Decimal(choice['AnnualUnit'])*Decimal('.6')*Decimal(choice['WeightGrams'])/1000000
    self.assertEqual(awarded_mt(choice),expected)
    request=api.request_create(api.RecipeRequest(CreationKey=uuid4(),RequestDue=date(2026,12,20),Items=[dict(OpportunityItemID=row['ID'],RowVersion=choice['RowVersion'])]),ctx)['row']
    item=api.request_items(request['ID'],ctx)['rows'][0]
    self.assertEqual(Decimal(item['EstPctAwarded']),60)
    self.assertEqual(Decimal(item['EstimatedAwardedMT']),expected)
    # Live validation must read the parent again, rather than the captured award.
    cur.execute('UPDATE dbo.OpportunityItem SET EstPctAwarded=55 WHERE ID=?',row['ParentItemID'])
    updated=api.one(cur,'SELECT '+api.OPPORTUNITY_SELECT+' '+api.OPPORTUNITY_SOURCE+' WHERE i.ID=?',row['ID'])
    self.assertEqual(Decimal(updated['EstPctAwarded']),55)
  finally:
   cur.execute('IF @@TRANCOUNT>0 ROLLBACK');cur.close();connection.close()


if __name__=='__main__':unittest.main()
