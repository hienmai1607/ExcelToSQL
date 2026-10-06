"""Same config scope, persistence and atomic groups; SQL fixtures roll back."""
import json
import unittest
from unittest.mock import Mock
from fastapi import HTTPException
from pydantic import ValidationError
from packaging_fields import ResponseFields, consume
from mix_parent_logistics_contract import MixLogisticsSQL
from mix_same_config import validate_group_batch
from request_views import item_read

class GroupValidation(unittest.TestCase):
    def test_boolean_contract(self):
        for value in ('true','false',1,0):
            with self.assertRaises(ValidationError): ResponseFields(SameConfig=value)
        self.assertTrue(ResponseFields(SameConfig=True).SameConfig)
    def rows(self,**first):
        from packaging_api import ResponseRow
        return [ResponseRow(RowNum=1,ID=1,RowVersion='AAAAAAAAAAE=',SameConfig=True),
          ResponseRow(RowNum=2,ID=2,RowVersion='AAAAAAAAAAE=',**first),
          ResponseRow(RowNum=3,ID=3,RowVersion='AAAAAAAAAAE=')]
    def cursor(self):
        cursor=Mock()
        cursor.fetchall.side_effect=[[(1,True,9,10)],
          [(2,1,1,'Film',None,None,None,None),(3,1,1,'Film',None,None,None,None)]]
        return cursor
    def test_complete_group_and_independent_densities(self):
        validate_group_batch(self.cursor(),self.rows(NutDensity='.5'))
    def test_partial_and_different_settings_are_rejected(self):
        with self.assertRaises(HTTPException): validate_group_batch(self.cursor(),self.rows()[:2])
        with self.assertRaises(HTTPException): validate_group_batch(self.cursor(),self.rows(FirstPMType='Jar'))
    def test_disabling_allows_independent_editing(self):
        rows=self.rows();rows[0].SameConfig=False
        validate_group_batch(self.cursor(),rows[:1])

class SameConfigSQL(MixLogisticsSQL):
    def setUp(self):
        super().setUp()
        self.migrate('87_mix_packaging_type_orders.sql')
        self.migrate('88_mix_same_config.sql')
    def fields(self,id,**values):
        version=self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',id).fetchval()
        self.cur.execute('EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0',
          self.username,id,version,json.dumps(values))
        return consume(self.cur)
    def test_flag_persists_only_on_parent_and_reader_links_children(self):
        request=self.request([self.parent,self.child])
        rows=item_read(self.username,request['header']['ID'],1,25,None,None,'[]')['rows']
        parent=next(r for r in rows if r['OpportunityItemID']==self.parent)
        child=next(r for r in rows if r['OpportunityItemID']==self.child)
        self.assertFalse(parent['SameConfig'])
        self.fields(parent['ItemID'],SameConfig=True)
        rows=item_read(self.username,request['header']['ID'],1,25,None,None,'[]')['rows']
        self.assertTrue(next(r for r in rows if r['OpportunityItemID']==self.parent)['SameConfig'])
        self.assertTrue(next(r for r in rows if r['OpportunityItemID']==self.child)['MixSameConfig'])
        count=self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName='SameConfig'",parent['ItemID']).fetchval()
        self.assertGreater(count,0)
        with self.assertRaisesRegex(Exception,'only to a Mix'): self.fields(child['ItemID'],SameConfig=True)
    def test_normal_product_cannot_set_flag(self):
        req=self.req
        with self.assertRaisesRegex(Exception,'only to a Mix'): self.fields(req,SameConfig=True)
    def test_api_requires_complete_linked_group(self):
        from packaging_api import response_save,ResponseBatch
        from db import bytes_to_b64
        request=self.request([self.parent,self.child])
        rows=item_read(self.username,request['header']['ID'],1,25,None,None,'[]')['rows']
        parent=next(r for r in rows if r['OpportunityItemID']==self.parent)
        child=next(r for r in rows if r['OpportunityItemID']==self.child)
        self.fields(parent['ItemID'],SameConfig=True)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Assigned',PICUserID=?,IsOpen=1 WHERE ID IN(?,?)",self.actor,parent['ItemID'],child['ItemID'])
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',child['ItemID']).fetchval())
        with self.assertRaises(HTTPException) as error:
            response_save(ResponseBatch(rows=[dict(RowNum=1,ID=child['ItemID'],RowVersion=version,NutDensity='.6')]),self.ctx)
        self.assertIn('together',error.exception.detail)
    def test_group_conflict_rolls_back_parent_flag_and_all_child_data(self):
        from packaging_api import response_save,ResponseBatch
        from db import bytes_to_b64
        request=self.request([self.parent,self.child])
        rows=item_read(self.username,request['header']['ID'],1,25,None,None,'[]')['rows']
        parent=next(r for r in rows if r['OpportunityItemID']==self.parent)
        child=next(r for r in rows if r['OpportunityItemID']==self.child)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Assigned',PICUserID=?,IsOpen=1 WHERE ID IN(?,?)",self.actor,parent['ItemID'],child['ItemID'])
        before=list(self.cur.execute('SELECT ID,SameConfig,NutDensity,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID IN(?,?) ORDER BY ID',parent['ItemID'],child['ItemID']))
        parent_version=bytes_to_b64(next(r[3] for r in before if r[0]==parent['ItemID']))
        try:
            result=response_save(ResponseBatch(rows=[dict(RowNum=1,ID=parent['ItemID'],RowVersion=parent_version,SameConfig=True),
                dict(RowNum=2,ID=child['ItemID'],RowVersion='AAAAAAAAAAE=',NutDensity='.6')]),self.ctx)
            self.assertTrue(any(r['Status']=='ERROR' for r in result['results']))
        except HTTPException:
            pass
        after=list(self.cur.execute('SELECT ID,SameConfig,NutDensity,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID IN(?,?) ORDER BY ID',parent['ItemID'],child['ItemID']))
        if after:
            self.assertEqual(before,after)
        else:
            # SQL XACT_ABORT may also roll back fixture creation in our outer test transaction.
            self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),0)
    def test_migration_rerun_preserves_history(self):
        before=list(self.cur.execute('SELECT ID,SameConfig,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID'))
        self.migrate('88_mix_same_config.sql');self.migrate('88_mix_same_config.sql')
        self.assertEqual(before,list(self.cur.execute('SELECT ID,SameConfig,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID')))

if __name__=='__main__': unittest.main()
