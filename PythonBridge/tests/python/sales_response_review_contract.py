"""Desktop rollback checks for manager -> Sales acceptance/return boundaries."""
import re
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
sys.path.insert(0,str(Path(__file__).parent))
import npd_desktop_contract as fixture
import npd_api as npd
import sales_response_review as sales
from db import bytes_to_b64
from auth import AccessContext
from fastapi import HTTPException
from uuid import uuid4


class SalesReview(unittest.TestCase):
    setUpSource=fixture.Desktop.setUp
    tearDown=fixture.Desktop.tearDown
    setup_recipe=fixture.Desktop.setup_recipe
    row=fixture.Desktop.row

    def setUp(self):
        self.setUpSource()
        for batch in re.split(r'^GO\s*$',(ROOT/'sql/159_sales_response_review.sql').read_text(),flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                while self.cur.nextset():pass

    def approve_recipe(self):
        self.setup_recipe()
        row=npd.sheet_review(self.sheet['ID'],npd.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
        return npd.sheet_review(row['ID'],npd.Review(RowVersion=row['RowVersion'],Action='Approve'),self.admin)['row']

    def decision(self,kind,row,action='Accept',ctx=None,comment=None,versions=None):
        return sales.decide(kind,row['ID'],sales.Decision(Action=action,RowVersion=row['RowVersion'],GroupVersions=versions,Comment=comment),ctx or self.admin)

    def test_recipe_manager_approval_waits_for_sales(self):
        row=self.approve_recipe()
        self.assertEqual(row['ApprovalStatus'],'Approved')
        self.assertEqual(row['SalesReviewStatus'],'Pending')
        self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
        request=self.row('NPDRecipeRequestItem',row['RequestItemID'])
        self.assertTrue(request['IsOpen']);self.assertIsNone(request['ActiveSheetID'])
        self.decision('recipe',row)
        self.assertFalse(self.row('NPDRecipeRequestItem',row['RequestItemID'])['IsOpen'])
        self.assertEqual(npd.obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])['NPDRecipe']['SheetID'],row['ID'])
        self.assertEqual(self.row('NPDRecipeSheet',row['ID'])['SalesReviewStatus'],'Accepted')

    def test_migration_rerun_does_not_auto_accept_new_manager_approval(self):
        row=self.approve_recipe()
        for batch in re.split(r'^GO\s*$',(ROOT/'sql/159_sales_response_review.sql').read_text(),flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                while self.cur.nextset():pass
        self.assertEqual(self.row('NPDRecipeSheet',row['ID'])['SalesReviewStatus'],'Pending')
        self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)

    def test_recipe_return_edit_resubmit_manager_approve_accept(self):
        row=self.approve_recipe();self.decision('recipe',row,'Return',comment='Please revise seasoning.')
        self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
        returned=npd.sheet_row(self.cur,row['ID']);self.assertEqual(returned['ApprovalStatus'],'Returned')
        saved=npd.sheet_save(row['ID'],npd.SheetSave(RowVersion=returned['RowVersion'],Status='Price Ready',Lines=self.saved['lines']),self.admin)['row']
        pending=npd.sheet_review(row['ID'],npd.Review(RowVersion=saved['RowVersion'],Action='Submit'),self.admin)['row']
        approved=npd.sheet_review(row['ID'],npd.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)['row']
        self.assertEqual(approved['SalesReviewStatus'],'Pending')
        self.decision('recipe',approved)
        self.assertEqual(self.row('NPDRecipeRequestItem',row['RequestItemID'])['ActiveSheetID'],row['ID'])

    def test_only_request_creator_or_admin_can_review(self):
        row=self.approve_recipe()
        actor,name=self.cur.execute('SELECT TOP(1) ID,UserName FROM dbo.Users WHERE IsActive=1 AND ID<>? ORDER BY ID',self.admin.user_id).fetchone()
        other=AccessContext(actor,name,frozenset({'Opportunity'}))
        with self.assertRaises(HTTPException) as caught:self.decision('recipe',row,ctx=other)
        self.assertEqual(caught.exception.status_code,403)
        self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)

    def test_stale_recipe_decision_does_not_publish(self):
        row=self.approve_recipe()
        with self.assertRaises(HTTPException) as caught:self.decision('recipe',{**row,'RowVersion':bytes_to_b64(bytes(8))})
        self.assertEqual(caught.exception.status_code,409)
        self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)

    def test_replacement_recipe_keeps_previous_accepted_results_until_sales_accepts(self):
        first=self.approve_recipe();self.decision('recipe',first)
        published=self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo']
        item=self.row('NPDRecipeRequestItem',first['RequestItemID'])
        replacement=npd.sheet_create(item['ID'],npd.NewSheet(CreationKey=uuid4(),RowVersion=item['RowVersion']),self.admin)['row']
        replacement=npd.sheet_save(replacement['ID'],npd.SheetSave(RowVersion=replacement['RowVersion'],Status='Price Ready',Lines=self.saved['lines']),self.admin)['row']
        replacement=npd.sheet_review(replacement['ID'],npd.Review(RowVersion=replacement['RowVersion'],Action='Submit'),self.admin)['row']
        replacement=npd.sheet_review(replacement['ID'],npd.Review(RowVersion=replacement['RowVersion'],Action='Approve'),self.admin)['row']
        self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],published)
        self.assertEqual(self.row('NPDRecipeRequestItem',item['ID'])['ActiveSheetID'],first['ID'])
        self.decision('recipe',replacement,'Return',comment='Please revise this replacement.')
        self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],published)
        self.assertEqual(self.row('NPDRecipeRequestItem',item['ID'])['ActiveSheetID'],first['ID'])

    def test_original_request_creator_can_accept_recipe(self):
        row=self.approve_recipe()
        creator=AccessContext(self.admin.user_id,self.admin.username,frozenset({'Opportunity'}),{'opportunities':'edit'})
        self.decision('recipe',row,ctx=creator)
        self.assertEqual(self.row('NPDRecipeSheet',row['ID'])['SalesReviewedBy'],creator.user_id)
        self.assertEqual(self.row('NPDRecipeSheet',row['ID'])['ApprovedBy'],self.admin.user_id)

    def test_display_only_creator_cannot_accept_recipe(self):
        row=self.approve_recipe()
        reader=AccessContext(self.admin.user_id,self.admin.username,frozenset({'Opportunity'}),{'opportunities':'display'})
        result=sales.review_list(self.source['OpportunityID'],reader)
        self.assertFalse(next(r for r in result['recipe'] if r['ID']==row['ID'])['CanReview'])
        with self.assertRaises(HTTPException) as caught:self.decision('recipe',row,ctx=reader)
        self.assertEqual(caught.exception.status_code,403)

    def packaging(self):
        root=self.cur.execute('''SELECT TOP(1) i.ID FROM dbo.PackagingConfigurationRequestItem i
          JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID JOIN dbo.Opportunity o ON o.ID=oi.OpportunityID
          WHERE oi.ParentItemID IS NULL AND i.Stage='Approved' AND o.Stage='Draft'
          AND EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem member JOIN dbo.OpportunityItem child ON child.ID=member.OpportunityItemID WHERE member.RequestID=i.RequestID AND child.ParentItemID=oi.ID)
          AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem active JOIN dbo.PackagingConfigurationRequestItem member ON member.RequestID=i.RequestID AND active.OpportunityItemID=member.OpportunityItemID WHERE active.IsOpen=1)
          ORDER BY i.ID DESC''').fetchval()
        self.assertIsNotNone(root)
        rows=sales.packaging_family(self.cur,root)
        self.assertGreater(len(rows),1,'Exercise a complete Mix family.')
        for row in rows:self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Pending Review',IsOpen=1 WHERE ID=?",row['ID'])
        for row in sales.packaging_family(self.cur,root):
            self.cur.execute('EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,?,?',self.admin.username,row['ID'],npd.rv(row['RowVersion'],True),'Approved','Manager verified.')
            while self.cur.nextset():pass
        rows=sales.packaging_family(self.cur,root)
        self.assertTrue(all(r['Stage']=='Awaiting Sales' and r['IsOpen'] for r in rows))
        return next(r for r in rows if r['ID']==root),rows

    def test_packaging_manager_waits_and_accepts_entire_mix_family(self):
        root,rows=self.packaging()
        for row in rows:
            self.assertNotEqual(self.cur.execute('SELECT PackagingRequestItemID FROM dbo.v_OpportunityItemPackaging WHERE OpportunityItemID=?',row['OpportunityItemID']).fetchval(),row['ID'])
        versions={r['ID']:r['RowVersion'] for r in rows}
        self.decision('packaging',root,versions=versions)
        for row in sales.packaging_family(self.cur,root['ID']):
            self.assertEqual(row['Stage'],'Approved');self.assertFalse(row['IsOpen'])
            self.assertEqual(self.cur.execute('SELECT PackagingRequestItemID FROM dbo.v_OpportunityItemPackaging WHERE OpportunityItemID=?',row['OpportunityItemID']).fetchval(),row['ID'])

    def test_packaging_return_preserves_pic_and_reopens_family(self):
        root,rows=self.packaging();versions={r['ID']:r['RowVersion'] for r in rows}
        self.decision('packaging',root,'Return',comment='Check outer carton.',versions=versions)
        after=sales.packaging_family(self.cur,root['ID'])
        self.assertTrue(all(r['Stage']=='Returned' and r['IsOpen'] for r in after))
        self.assertEqual([r['PICUserID'] for r in rows],[r['PICUserID'] for r in after])
        # The PIC must resubmit and the manager must approve again before Sales can accept.
        for target in ('Pending Review','Approved'):
            for member in sales.packaging_family(self.cur,root['ID']):
                self.cur.execute('EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,?,?',self.admin.username,member['ID'],npd.rv(member['RowVersion'],True),target,'Revised and reviewed.')
                while self.cur.nextset():pass
        revised=sales.packaging_family(self.cur,root['ID'])
        self.decision('packaging',next(r for r in revised if r['ID']==root['ID']),versions={r['ID']:r['RowVersion'] for r in revised})
        self.assertTrue(all(r['Stage']=='Approved' and not r['IsOpen'] for r in sales.packaging_family(self.cur,root['ID'])))

    def test_packaging_stale_child_cannot_accept_partial_family(self):
        root,rows=self.packaging();versions={r['ID']:r['RowVersion'] for r in rows}
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET UpdatedAt=SYSUTCDATETIME() WHERE ID=?',rows[-1]['ID'])
        with self.assertRaises(HTTPException) as caught:self.decision('packaging',root,versions=versions)
        self.assertEqual(caught.exception.status_code,409)
        self.assertTrue(all(r['Stage']=='Approved' for r in sales.packaging_family(self.cur,root['ID'])))


if __name__=='__main__':unittest.main()
