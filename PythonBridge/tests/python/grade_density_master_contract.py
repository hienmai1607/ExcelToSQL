"""Rollback-only Grade Density Master contracts."""
import json
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from pydantic import ValidationError
from auth import AccessContext
from db import bytes_to_b64
from grade_density import grade_combination
import grade_density_api as api
import packaging_field_foundation_contract as foundation

class GradeDensityMasterSQL(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    request=foundation.PackagingFoundation.request
    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        self.cur.execute((foundation.ROOT/'sql/121_grade_density_master.sql').read_text(encoding='utf-8'))
        while self.cur.nextset():pass
        self.ctx=AccessContext(self.actor,self.username,frozenset({'Admin'}))
        self.response=self.request()
        snapshot={'items':[dict(ParentID='0',ID=1,RawGradeID=None,RawMaterialID=None,Grade='Density master fixture',RatioPct='100')]}
        self.signature,self.document=grade_combination(snapshot)
        request_id=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.response).fetchval()
        product=self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID)
            VALUES('D-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),'Density master product',100,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.customer).fetchval()
        item=self.cur.execute("""INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy)
            VALUES(?,?,'Density fixture',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.opp,product,self.actor).fetchval()
        self.response=self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,
            ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy,ProductGradeSnapshot,NutDensity)
            SELECT ?,oi.ID,p.ID,p.ProductCode,p.ProductName,oi.ItemDescription,oi.AnnualUnit,oi.RowVersion,'Assigned',1,?,?,.55
            FROM dbo.OpportunityItem oi JOIN dbo.Product p ON p.ID=oi.ProductID WHERE oi.ID=?;
            SELECT CONVERT(INT,SCOPE_IDENTITY())""",request_id,self.actor,json.dumps(snapshot),item).fetchval()
    def create(self,density='.61'):
        return api.save_record(self.cur,api.DensitySave(CombinationHash=self.signature,NutDensity=density),self.ctx)['ID']
    def edit(self,identity,density,version=None,signature=None):
        token=version or bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.NutGradeDensity WHERE ID=?',identity).fetchval())
        return api.save_record(self.cur,api.DensitySave(ID=identity,RowVersion=token,CombinationHash=signature or self.signature,NutDensity=density),self.ctx)
    def test_create_and_edit_history_without_retroactive_response_changes(self):
        identity=self.create()
        self.edit(identity,'.62')
        self.assertEqual(str(self.cur.execute('SELECT NutDensity FROM dbo.NutGradeDensity WHERE ID=?',identity).fetchval()),'0.620000')
        self.assertEqual(str(self.cur.execute('SELECT NutDensity FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.response).fetchval()),'0.550000')
        history=self.cur.execute('SELECT OldDensity,NewDensity,ResponseItemID FROM dbo.NutGradeDensityHistory WHERE DensityID=? ORDER BY ID',identity).fetchall()
        self.assertEqual(len(history),2);self.assertTrue(all(r[2] is None for r in history))
    def test_duplicate_stale_and_fabricated_combination_are_rejected(self):
        identity=self.create()
        with self.assertRaises(HTTPException) as error:self.create()
        self.assertEqual(error.exception.status_code,409)
        with self.assertRaises(HTTPException) as error:self.edit(identity,'.7','AAAAAAAAAAA=')
        self.assertEqual(error.exception.status_code,409)
        with self.assertRaises(HTTPException) as error:self.edit(identity,'.7',signature='0'*64)
        self.assertEqual(error.exception.status_code,422)
        with self.assertRaises(HTTPException) as error:api.save_record(self.cur,api.DensitySave(CombinationHash='0'*64,NutDensity='.7'),self.ctx)
        self.assertEqual(error.exception.status_code,422)
    def test_list_filter_sort_and_export_use_shared_master_contract(self):
        from packaging_fields import consume
        from shared_master_views import SharedExport
        identity=self.create()
        def execute(sql,params):
            self.cur.execute(sql,*params);return consume(self.cur)
        with patch.object(api,'execute',side_effect=execute):
            result=api.read(page=1,page_size=25,search='Density master fixture',sort='[{"column":"NutDensity","direction":"desc"}]',ctx=self.ctx)
        self.assertTrue(any(r['ID']==identity for r in result['rows']))
        exported=api.export(SharedExport(columns=['Combination','NutDensity'],rows=[['Fixture','0.61']]),self.ctx)
        self.assertEqual(exported.media_type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    def test_existing_grade_combinations_are_available(self):
        self.assertEqual(api.combinations(self.cur)[self.signature],self.document)
    def test_precision_and_permissions(self):
        for value in ('0','-1','.1234567','NaN'):
            with self.subTest(value=value),self.assertRaises(ValidationError):api.DensitySave(CombinationHash=self.signature,NutDensity=value)
        viewer=AccessContext(self.actor,self.username,frozenset({'PackagingManager'}))
        api.access(viewer)
        with self.assertRaises(HTTPException):api.access(viewer,True)
        writer=AccessContext(self.actor,self.username,frozenset({'Packaging'}))
        api.access(writer,True)
        with self.assertRaises(HTTPException):api.access(AccessContext(self.actor,self.username,frozenset({'Opportunity'})),True)
    def test_repeatable_migration_and_persisted_layout(self):
        self.cur.execute((foundation.ROOT/'sql/121_grade_density_master.sql').read_text(encoding='utf-8'))
        while self.cur.nextset():pass
        from preferences_api import Settings
        settings=Settings(shared_masters={'grade-densities':dict(columns=['Combination','NutDensity'],filters=['search'],sort=[dict(column='NutDensity',direction='desc')],page_size=25)})
        self.assertIn('grade-densities',settings.shared_masters)
