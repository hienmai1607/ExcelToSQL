"""Rollback-only business deletion contracts. No live records are removed."""
import json
import unittest
from contextlib import contextmanager
from unittest.mock import patch,MagicMock
from auth import AccessContext
from fastapi import HTTPException
from db import bytes_to_b64
import business_deletion_api as api
import packaging_field_foundation_contract as foundation

class BusinessDeletionBoundary(unittest.TestCase):
    def test_failure_rolls_back_and_sanitizes_database_errors(self):
        cursor=MagicMock()
        @contextmanager
        def connection():yield cursor
        ctx=AccessContext(1,'Tester',frozenset({'Admin'}))
        with patch.object(api,'get_raw_cursor',connection),patch.object(api,'delete_record',side_effect=RuntimeError('private connection detail')):
            with self.assertRaises(HTTPException) as error:api.delete('vendors',api.DeleteRecord(ID=1,RowVersion='AAAAAAAAAAE='),ctx)
        self.assertEqual(error.exception.status_code,409)
        self.assertNotIn('private',error.exception.detail)
        commands=[call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn('IF @@TRANCOUNT>0 ROLLBACK',commands)
        self.assertNotIn('COMMIT',commands)

    def test_success_commits_once(self):
        cursor=MagicMock()
        @contextmanager
        def connection():yield cursor
        ctx=AccessContext(1,'Tester',frozenset({'Admin'}))
        with patch.object(api,'get_raw_cursor',connection),patch.object(api,'delete_record',return_value={'deleted':True,'ID':1}):
            self.assertEqual(api.delete('vendors',api.DeleteRecord(ID=1,RowVersion='AAAAAAAAAAE='),ctx),{'deleted':True,'ID':1})
        commands=[call.args[0] for call in cursor.execute.call_args_list]
        self.assertEqual(commands.count('COMMIT'),1)

    def test_legacy_scopes_do_not_bypass_module_permissions(self):
        target=api.TARGETS['materials']
        self.assertFalse(api.editable(AccessContext(1,'User',frozenset({'Customer'})),target))
        self.assertFalse(api.editable(AccessContext(1,'User',frozenset({'PackagingManager'})),target))
        self.assertTrue(api.editable(AccessContext(1,'User',frozenset({'Packaging'})),target))
        self.assertFalse(api.editable(AccessContext(1,'User',frozenset({'Packaging'}),{'materials':'display'}),target))

class BusinessDeletionSQL(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    request=foundation.PackagingFoundation.request
    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        self.cur.execute((foundation.ROOT/'sql/120_business_deletion_audit.sql').read_text(encoding='utf-8'))
        while self.cur.nextset():pass
        self.ctx=AccessContext(self.actor,self.username,frozenset({'Admin'}))
    def insert_vendor(self,name='Deletion fixture'):
        return self.cur.execute("""INSERT dbo.Vendor(VendorName,CreatedBy)
          VALUES(?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",name,self.actor).fetchval()
    def body(self,entity,identity):
        version=self.cur.execute('SELECT RowVersion FROM dbo.'+api.quote(api.TARGETS[entity].table)+' WHERE ID=?',identity).fetchval()
        return api.DeleteRecord(ID=identity,RowVersion=bytes_to_b64(version))
    def remove(self,entity,identity,ctx=None,body=None):
        return api.delete_record(self.cur,entity,body or self.body(entity,identity),ctx or self.ctx)
    def availability(self,entity,rows,ctx=None):
        @contextmanager
        def connection():yield self.cur
        with patch.object(api,'get_raw_cursor',connection):
            return api.eligibility(entity,api.EligibilityBatch(rows=rows),ctx or self.ctx)['rows']

    def test_availability_matches_rules_without_deleting_or_auditing(self):
        unused=self.insert_vendor()
        body=self.body('vendors',unused)
        before=self.cur.execute('SELECT COUNT(*) FROM dbo.BusinessDeletionAudit').fetchval()
        self.assertTrue(self.availability('vendors',[body])[0]['available'])
        self.assertFalse(self.availability('products',[self.body('products',self.product)])[0]['available'])
        self.assertFalse(self.availability('opportunities',[self.body('opportunities',self.opp)])[0]['available'])
        stale=body.model_copy(update={'RowVersion':'AAAAAAAAAAA='})
        self.assertFalse(self.availability('vendors',[stale])[0]['available'])
        ctx=AccessContext(self.actor,self.username,frozenset({'PackagingManager'}),{'vendors':'display'})
        self.assertFalse(self.availability('vendors',[body],ctx)[0]['available'])
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.BusinessDeletionAudit').fetchval(),before)
        self.assertEqual(self.body('vendors',unused).RowVersion,body.RowVersion)

    def test_batch_json_reference_cache_blocks_later_rows_too(self):
        first=self.insert_vendor();second=self.insert_vendor('Other deletion fixture')
        self.cur.execute('UPDATE dbo.Product SET LossProcesses=? WHERE ID=?',json.dumps({'VendorID':second}),self.product)
        result=self.availability('vendors',[self.body('vendors',first),self.body('vendors',second)])
        self.assertEqual([r['available'] for r in result],[True,False])

    def test_availability_is_advisory_delete_rechecks_new_references(self):
        identity=self.insert_vendor();body=self.body('vendors',identity)
        self.assertTrue(self.availability('vendors',[body])[0]['available'])
        self.cur.execute('UPDATE dbo.Product SET LossProcesses=? WHERE ID=?',json.dumps({'VendorID':identity}),self.product)
        with self.assertRaises(HTTPException):self.remove('vendors',identity,body=body)

    def test_unused_master_delete_is_audited(self):
        identity=self.insert_vendor()
        result=self.remove('vendors',identity)
        self.assertEqual(result,{'deleted':True,'ID':identity})
        self.assertIsNone(self.cur.execute('SELECT ID FROM dbo.Vendor WHERE ID=?',identity).fetchone())
        audit=self.cur.execute("SELECT RecordLabel,DeletedBy FROM dbo.BusinessDeletionAudit WHERE EntityKey='vendors' AND RecordID=?",identity).fetchone()
        self.assertEqual(tuple(audit),('Deletion fixture',self.actor))
    def test_admin_masters_and_immutable_tables_are_never_targets(self):
        for entity in ('users','roles','markets','currencies','containers','uoms','categories','ports','loss-processes','ContainerLoadPlan','Vendor; DROP TABLE dbo.Users'):
            with self.subTest(entity=entity),self.assertRaises(HTTPException) as error:
                api.delete_record(self.cur,entity,api.DeleteRecord(ID=1,RowVersion='AAAAAAAAAAE='),self.ctx)
            self.assertEqual(error.exception.status_code,404)
    def test_display_access_cannot_delete(self):
        identity=self.insert_vendor()
        ctx=AccessContext(self.actor,self.username,frozenset({'Packaging'}),{'vendors':'display'})
        with self.assertRaises(HTTPException) as error:self.remove('vendors',identity,ctx)
        self.assertEqual(error.exception.status_code,403)
    def test_stale_version_preserves_record(self):
        identity=self.insert_vendor();body=self.body('vendors',identity)
        self.cur.execute("UPDATE dbo.Vendor SET VendorName='Changed' WHERE ID=?",identity)
        with self.assertRaises(HTTPException) as error:self.remove('vendors',identity,body=body)
        self.assertEqual(error.exception.status_code,409)
        self.assertIsNotNone(self.cur.execute('SELECT ID FROM dbo.Vendor WHERE ID=?',identity).fetchone())
    def test_foreign_references_are_blocked_even_when_unprocessed(self):
        with self.assertRaises(HTTPException) as error:self.remove('products',self.product)
        self.assertEqual(error.exception.status_code,409)
        self.assertIn('OpportunityItem',error.exception.detail)
    def test_parent_cannot_delete_connected_transactions(self):
        with self.assertRaises(HTTPException) as error:self.remove('opportunities',self.opp)
        self.assertEqual(error.exception.status_code,409)
        self.assertIsNotNone(self.cur.execute('SELECT ID FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchone())
    def test_processed_transaction_is_protected(self):
        self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=?",self.item)
        with self.assertRaises(HTTPException) as error:self.remove('opportunity-items',self.item)
        self.assertEqual(error.exception.status_code,409)
    def test_reverted_draft_retains_processing_protection(self):
        self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=?",self.item)
        self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='Draft' WHERE ID=?",self.item)
        with self.assertRaises(HTTPException) as error:self.remove('opportunity-items',self.item)
        self.assertEqual(error.exception.status_code,409)
        self.assertIn('history',error.exception.detail)

    def test_transaction_creator_is_enforced(self):
        ctx=AccessContext(self.actor+999,self.username,frozenset({'Opportunity'}),{'opportunities':'edit'})
        # Independent ownership check, before reference checking.
        self.cur.execute('SELECT * FROM dbo.Opportunity WHERE ID=?',self.opp);row=api.row_dict(self.cur)
        with self.assertRaises(HTTPException) as error:api.assert_unprocessed(self.cur,api.TARGETS['opportunities'],row,ctx)
        self.assertEqual(error.exception.status_code,403)
    def test_saved_json_reference_blocks_deletion(self):
        identity=self.insert_vendor()
        self.cur.execute('UPDATE dbo.Product SET LossProcesses=? WHERE ID=?',json.dumps({'nested':[{'VendorID':identity}]}),self.product)
        with self.assertRaises(HTTPException) as error:self.remove('vendors',identity)
        self.assertEqual(error.exception.status_code,409)
        self.assertIn('saved business data',error.exception.detail)
    def test_unused_draft_item_then_header_can_be_deleted(self):
        self.remove('opportunity-items',self.item)
        self.remove('opportunities',self.opp)
        self.assertIsNone(self.cur.execute('SELECT ID FROM dbo.Opportunity WHERE ID=?',self.opp).fetchone())
    def test_type_order_attribute_is_removed_without_business_cascade(self):
        identity=self.cur.execute("""INSERT dbo.PackagingType(PackagingType,PackagingOrder,PriceBasis,TareWeight,FinalComponent,CopyDim,Shipping,CreatedBy)
            VALUES('Deletion type fixture','Primary','Count',0,1,0,0,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor).fetchval()
        if not self.cur.execute('SELECT 1 FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=?',identity).fetchone():
            self.cur.execute("INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder) VALUES(?,'Primary')",identity)
        self.remove('packaging-types',identity)
        self.assertIsNone(self.cur.execute('SELECT 1 FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=?',identity).fetchone())

    def test_assigned_response_cannot_be_deleted(self):
        item=self.request()
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=? WHERE ID=?',self.actor,item)
        with self.assertRaises(HTTPException) as error:self.remove('request-items',item)
        self.assertEqual(error.exception.status_code,409)

    def test_unassigned_request_line_and_empty_header_can_be_deleted(self):
        item=self.request()
        request=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',item).fetchval()
        self.remove('request-items',item)
        self.remove('requests',request)
        self.assertIsNone(self.cur.execute('SELECT ID FROM dbo.PackagingConfigurationRequest WHERE ID=?',request).fetchone())

    def test_request_header_read_supplies_concurrency_token(self):
        from request_views import header_read
        from packaging_fields import consume
        self.request()
        def execute(sql,params):
            self.cur.execute(sql,*params)
            return consume(self.cur)
        with patch('packaging_api.execute',side_effect=execute):
            result=header_read(self.username,1,25,'FND-',None,'[]')
        self.assertTrue(any(r['RequestNumber'] and r.get('HeaderRowVersion') for r in result['rows']))

    def test_audit_migration_is_repeatable(self):
        self.cur.execute((foundation.ROOT/'sql/120_business_deletion_audit.sql').read_text(encoding='utf-8'))
        while self.cur.nextset():pass
        self.assertIsNotNone(self.cur.execute("SELECT OBJECT_ID('dbo.BusinessDeletionAudit')").fetchval())

    def test_admin_general_conversion_is_excluded(self):
        target=api.TARGETS['conversions']
        with self.assertRaises(HTTPException) as error:api.assert_unprocessed(self.cur,target,{'ID':1},self.ctx)
        self.assertEqual(error.exception.status_code,403)
    def test_json_embedded_objects_and_numeric_strings(self):
        self.assertTrue(api.json_reference([{'NutsGrade':[['Almonds',7]],'Ratio':'1'}],api.TARGETS['raw-grades'],7))
        self.assertTrue(api.json_reference({'Dimension':{'ID':7,'D1Name':'Length'}},api.TARGETS['packaging-dimensions'],7))
        self.assertTrue(api.json_reference([{'PriceID':'7'}],api.TARGETS['prices'],7))
        self.assertTrue(api.json_reference({'SnapshotJSON':json.dumps({'VendorID':'7.0'})},api.TARGETS['vendors'],7))
        self.assertFalse(api.json_reference({'VendorID':True},api.TARGETS['vendors'],1))
        self.assertFalse(api.json_reference({'VendorID':17},api.TARGETS['vendors'],7))
