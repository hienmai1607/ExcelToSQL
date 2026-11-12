"""Desktop rollback contracts for Opportunity-wide delivery dates (migration 158)."""
import json
import re
import sys
import unittest
from datetime import date
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'core'))
from db import get_raw_cursor, reuse_transaction, bytes_to_b64, DB_NAME, DB_SERVER
from auth import AccessContext
from schemas import OpportunityHeaderRow
from packaging_fields import additional
import npd_api as api


def migrate(cur):
    for batch in re.split(r'^GO\s*$', (ROOT / 'sql/158_opportunity_estimate_delivery_date.sql').read_text(encoding='utf-8'), flags=re.M | re.I):
        if batch.strip():
            cur.execute(batch)
            while cur.nextset():
                pass


class DeliveryDate(unittest.TestCase):
    def setUp(self):
        self.assertEqual(DB_NAME, 'test')
        self.assertIn(DB_SERVER.lower(), ('desktop-5bgmjsc', 'localhost', '.'))
        self.connection = get_raw_cursor()
        self.cur = self.connection.__enter__()
        self.addCleanup(lambda: self.connection.__exit__(None, None, None))
        self.cur.execute('BEGIN TRANSACTION')
        self.addCleanup(lambda: self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION'))
        migrate(self.cur)
        self.shared = reuse_transaction(self.cur.connection)
        self.shared.__enter__()
        self.addCleanup(lambda: self.shared.__exit__(None, None, None))
        actor, username = self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
        self.ctx = AccessContext(actor, username, frozenset({'Admin'}))
        self.source = api.one(self.cur, 'SELECT TOP(1) '+api.OPPORTUNITY_SELECT+' '+api.OPPORTUNITY_SOURCE+" WHERE i.Stage='Draft' AND o.Stage='Draft' AND p.IsMix=0 AND i.ProductGradeSnapshot IS NOT NULL AND i.ProductNetWeightGrams>0 AND i.EstPctAwarded>0 AND i.AnnualUnit>0 AND NOT EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID AND IsLinked=1) ORDER BY i.ID DESC")

    def save(self, fields):
        version = self.cur.execute('SELECT RowVersion FROM dbo.Opportunity WHERE ID=?', self.source['OpportunityID']).fetchval()
        self.cur.execute('EXEC dbo.usp_Opportunity_Fields_Save ?,?,?,?,0', self.ctx.username, self.source['OpportunityID'], version, json.dumps(fields))
        while self.cur.nextset():
            pass
        return self.cur.execute('SELECT EstimateDeliveryDate FROM dbo.Opportunity WHERE ID=?', self.source['OpportunityID']).fetchval()

    def test_save_omit_clear_and_audit(self):
        model = OpportunityHeaderRow(RowNum=1, Command='U', EstimateDeliveryDate='2027-02-01')
        self.assertEqual(additional(model, 'Opportunity'), {'EstimateDeliveryDate': '2027-02-01'})
        self.assertEqual(self.save(additional(model, 'Opportunity')), date(2027, 2, 1))
        self.assertEqual(self.save({}), date(2027, 2, 1))
        self.assertIsNone(self.save({'EstimateDeliveryDate': None}))
        self.assertGreaterEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID=? AND FieldName='EstimateDeliveryDate'", self.source['OpportunityID']).fetchval(), 2)

    def test_new_request_captures_header_and_stays_unchanged(self):
        self.save({'EstimateDeliveryDate': '2027-02-01'})
        grade = api.obj(self.source['ProductGradeSnapshot'])
        grade['RequiresRecipeConfirmation'] = True
        grade['RecipeRequirements'] = {'LaunchingDate': '2028-12-31', 'SpecialComments': 'Keep comments'}
        self.cur.execute('UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=? WHERE ID=?', json.dumps(grade), self.source['OpportunityItemID'])
        version = self.cur.execute('SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?', self.source['OpportunityItemID']).fetchval()
        result = api.request_create(api.RecipeRequest(CreationKey=uuid4(), RequestDue=date(2027, 1, 15), Items=[api.RequestLine(OpportunityItemID=self.source['OpportunityItemID'], RowVersion=bytes_to_b64(version))]), self.ctx)
        captured = self.cur.execute('SELECT LaunchingDate,SpecialComments FROM dbo.NPDRecipeRequestItem WHERE RequestID=?', result['row']['ID']).fetchone()
        self.assertEqual(tuple(captured), (date(2027, 2, 1), 'Keep comments'))
        self.save({'EstimateDeliveryDate': '2027-03-01'})
        self.assertEqual(self.cur.execute('SELECT LaunchingDate FROM dbo.NPDRecipeRequestItem WHERE RequestID=?', result['row']['ID']).fetchval(), date(2027, 2, 1))

    def test_rerun_preserves_explicit_header_date(self):
        self.save({'EstimateDeliveryDate': '2027-04-01'})
        migrate(self.cur)
        self.assertEqual(self.cur.execute('SELECT EstimateDeliveryDate FROM dbo.Opportunity WHERE ID=?', self.source['OpportunityID']).fetchval(), date(2027, 4, 1))

    def test_conflicting_legacy_dates_stay_blank(self):
        identity = self.cur.execute('SELECT TOP(1) i.OpportunityID FROM dbo.OpportunityItem i WHERE NOT EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID AND r.IsLinked=1) GROUP BY i.OpportunityID HAVING COUNT(*)>=2 ORDER BY i.OpportunityID DESC').fetchval()
        rows = self.cur.execute('SELECT TOP(2) i.ID,i.ProductGradeSnapshot FROM dbo.OpportunityItem i WHERE i.OpportunityID=? AND NOT EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID AND r.IsLinked=1) ORDER BY i.ID', identity).fetchall()
        for row, value in zip(rows, ['2027-01-01', '2027-02-01']):
            grade = api.obj(row[1])
            grade['RecipeRequirements'] = {'LaunchingDate': value}
            self.cur.execute('UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=? WHERE ID=?', json.dumps(grade), row[0])
        self.cur.execute('UPDATE dbo.Opportunity SET EstimateDeliveryDate=NULL WHERE ID=?', identity)
        sql = (ROOT / 'sql/158_opportunity_estimate_delivery_date.sql').read_text(encoding='utf-8')
        # Exercise the migration's actual backfill statement, even after first deployment.
        self.cur.execute(sql[sql.index(" EXEC(N'"):sql.index("');", sql.index(" EXEC(N'"))+3])
        self.assertIsNone(self.cur.execute('SELECT EstimateDeliveryDate FROM dbo.Opportunity WHERE ID=?', identity).fetchval())


if __name__ == '__main__':
    unittest.main()
