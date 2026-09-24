"""Local test database only; schema and test records roll back after every test."""
import re
import unittest
from packaging_field_foundation_contract import PackagingFoundation, ROOT

class Changes(unittest.TestCase):
    setUpBase = PackagingFoundation.setUp
    cleanup = PackagingFoundation.cleanup
    request = PackagingFoundation.request

    def setUp(self):
        self.setUpBase()
        for filename in ("23_packaging_field_writes.sql", "24_packaging_request_change_log.sql"):
            for batch in re.split(r"^GO\s*$",(ROOT/"sql"/filename).read_text(encoding="utf-8"),flags=re.M|re.I):
                if batch.strip():
                    self.cur.execute(batch)
                    while self.cur.nextset(): pass
        self.reqitem=self.request()
        self.req=self.cur.execute("SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchval()

    def logs(self, field):
        return self.cur.execute("SELECT OldValue,NewValue,Source,ChangedBy FROM dbo.PackagingRequestChangeLog WHERE RequestID=? AND FieldName=? ORDER BY ID",self.req,field).fetchall()

    def drain(self):
        while self.cur.nextset(): pass

    def test_noop_null_zero_and_delete(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMMOQ=0 WHERE ID=?",self.reqitem)
        self.assertEqual(tuple(self.logs("FirstPMMOQ")[-1])[:3],(None,"0.0000","Database"))
        count=len(self.logs("FirstPMMOQ"))
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMMOQ=FirstPMMOQ WHERE ID=?",self.reqitem)
        self.assertEqual(len(self.logs("FirstPMMOQ")),count)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMMOQ=NULL WHERE ID=?",self.reqitem)
        self.assertEqual(tuple(self.logs("FirstPMMOQ")[-1])[:2],("0.0000",None))
        self.cur.execute("DELETE dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem)
        self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND Action='Delete'",self.reqitem).fetchval(),0)

    def test_assignment_actor_and_context_restored(self):
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchval()
        self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?",self.username,self.reqitem,self.actor,version)
        self.drain()
        change=self.logs("PICUserID")[-1]
        self.assertIn(self.username,change.NewValue)
        self.assertEqual((change.Source,change.ChangedBy),("User",self.username))
        self.assertEqual(self.cur.execute("SELECT CASE WHEN SESSION_CONTEXT(N'PackagingChangeUser') IS NULL THEN 1 ELSE 0 END").fetchval(),1)

    def test_cancel_and_automatic_header_status(self):
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchval()
        self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,'Canceled',?",self.username,self.reqitem,version,"No longer needed")
        self.drain()
        self.assertEqual(tuple(self.logs("Stage")[-1]),("Assigned","Canceled","User",self.username))
        self.assertEqual(tuple(self.logs("RequestStatus")[-1]),("Open","Canceled","System",self.username))
        reason=self.cur.execute("SELECT TOP(1) Reason FROM dbo.PackagingRequestChangeLog WHERE RequestID=? AND FieldName='Stage' ORDER BY ID DESC",self.req).fetchval()
        self.assertEqual(reason,"No longer needed")

    def test_sales_cannot_read_response_history_or_reason(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ResponseNotes='Private draft' WHERE ID=?",self.reqitem)
        # Fixtures/scopes below exist only in this rollback transaction.
        self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES('audit-sales-contract',1)")
        user=self.cur.execute("SELECT ID FROM dbo.Users WHERE UserName='audit-sales-contract'").fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')",user)
        self.cur.execute("EXEC dbo.usp_PackagingRequestChangeLog_Read 'audit-sales-contract',?,1,500",self.req)
        rows=self.cur.fetchall()
        self.assertTrue(rows)
        self.assertFalse(any(r.FieldName=='ResponseNotes' for r in rows))
        self.assertTrue(all(r.Reason is None for r in rows))
        self.drain()

    def test_field_paging_and_rollback(self):
        self.cur.execute("EXEC dbo.usp_PackagingRequestChangeLog_Read ?,?,1,1,'Item',NULL,'Stage'",self.username,self.req)
        self.assertEqual(len(self.cur.fetchall()),1)
        self.cur.nextset()
        self.assertEqual(self.cur.fetchval(),1)
        self.drain()
        self.cur.execute("SAVE TRANSACTION audit_test")
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequest SET RequestNotes='Rollback note' WHERE ID=?",self.req)
        self.cur.execute("ROLLBACK TRANSACTION audit_test")
        self.assertFalse(any(r.NewValue=='Rollback note' for r in self.logs("RequestNotes")))

    def test_extended_response_is_attributed(self):
        version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchval()
        self.cur.execute('EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0',self.username,self.reqitem,version,'{"FirstPMType":"Film","FirstPMMOQ":0}')
        self.drain()
        self.assertEqual(tuple(self.logs("FirstPMType")[-1]),(None,"Film","User",self.username))

    def test_error_restores_context_and_does_not_log(self):
        import pyodbc
        count=self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE RequestID=?",self.req).fetchval()
        # Bad target fails before SQL starts/rolls back the caller's fixture transaction.
        with self.assertRaisesRegex(pyodbc.Error,"51129"):
            self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,0x0000000000000000,'Invalid',NULL",self.username,self.reqitem)
        # XACT_ABORT rolls back the outer transaction, including the temporary schema.
        self.assertEqual(self.cur.execute("SELECT @@TRANCOUNT").fetchval(),0)
        self.assertEqual(self.cur.execute("SELECT CASE WHEN SESSION_CONTEXT(N'PackagingChangeUser') IS NULL THEN 1 ELSE 0 END").fetchval(),1)

    def test_repeatable_migration_and_denied_user(self):
        import pyodbc
        for batch in re.split(r"^GO\s*$",(ROOT/"sql/24_packaging_request_change_log.sql").read_text(encoding="utf-8"),flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                self.drain()
        with self.assertRaisesRegex(pyodbc.Error,"51101"):
            self.cur.execute("EXEC dbo.usp_PackagingRequestChangeLog_Read 'no-such-audit-user',?",self.req)

if __name__=="__main__": unittest.main()
