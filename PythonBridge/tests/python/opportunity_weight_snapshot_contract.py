"""Opportunity weight snapshots and description-free saves; fixtures always roll back."""
import re
import unittest
from decimal import Decimal as D
from pathlib import Path
import request_layer_details_contract as base
from opportunity_views import sorted_grid
from opportunity_excel_api import document_rows
from db import bytes_to_b64

ROOT=Path(__file__).resolve().parents[2]


class WeightSnapshots(unittest.TestCase):
    cleanup=base.LayerDetails.cleanup
    apply=base.LayerDetails.apply
    apply_details=base.LayerDetails.apply_details
    batch=base.LayerDetails.batch
    edit=base.LayerDetails.edit
    request=base.LayerDetails.request
    activate=base.LayerDetails.activate
    create_mix=base.LayerDetails.create_mix
    save_fields=base.LayerDetails.save_fields

    def setUp(self):
        base.foundation.WebRequirementSections.setUp(self)
        self.apply_details()
        self.apply_snapshot()

    def apply_snapshot(self):
        for sql in re.split(r'^GO\s*$',(ROOT/'sql/82_opportunity_product_weight_snapshot.sql').read_text(encoding='utf-8'),flags=re.M|re.I):
            if sql.strip():
                self.cur.execute(sql)
                while self.cur.nextset():pass
        self.cur.execute('SET XACT_ABORT OFF')

    def snapshot(self,item=None):
        return tuple(self.cur.execute('SELECT ProductNetWeightGrams,ProductWeightSnapshotCapturedAt,RowVersion FROM dbo.OpportunityItem WHERE ID=?',item or self.item).fetchone())

    def test_master_changes_do_not_change_opportunity_or_export_weight(self):
        before=self.snapshot()
        self.cur.execute('UPDATE dbo.Product SET WeightGrams=999 WHERE ID=?',self.product)
        self.assertEqual(self.snapshot(),before)
        rows=sorted_grid(self.username,1,25,'[]',self.number)['rows']
        self.assertEqual(D(next(r for r in rows if r['ItemID']==self.item)['WeightGrams']),D(100))
        self.assertEqual(D(next(r for r in document_rows(self.ctx,self.opp) if r['ItemID']==self.item)['WeightGrams']),D(100))

    def test_unrelated_edit_preserves_weight_and_capture_time(self):
        before=self.snapshot()
        result=self.batch(self.edit(self.item,ProductID=self.product,AnnualUnit=120))
        self.assertEqual(result['item_results'][0]['Status'],'OK',result)
        self.assertEqual(self.snapshot()[:2],before[:2])
        self.assertEqual(self.cur.execute('SELECT ItemDescription FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchval(),'Foundation line')
        self.assertEqual(bytes_to_b64(self.snapshot()[2]),result['item_results'][0]['NewRowVersion'])

    def test_new_items_require_no_description_and_capture_server_master(self):
        product=self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID)
            VALUES('W-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),'New snapshot product',150.25,?,?);
            SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.customer).fetchval()
        result=self.batch(dict(RowNum=2,Command='C',OpportunityNumber=self.number,
            ProductID=product,AnnualUnit=10))
        self.assertEqual(result['item_results'][0]['Status'],'OK',result)
        item=result['item_results'][0]['NewID']
        self.assertEqual(self.snapshot(item)[0],D('150.25'))
        label=self.cur.execute('SELECT ItemDescription FROM dbo.OpportunityItem WHERE ID=?',item).fetchval()
        master=self.cur.execute('SELECT ProductName FROM dbo.Product WHERE ID=?',product).fetchval()
        self.assertEqual(label,master)

    def test_selecting_different_product_recaptures_its_weight(self):
        other=self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID)
            VALUES('W-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),'Other product',450.50,?,?);
            SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.customer).fetchval()
        result=self.batch(self.edit(self.item,ProductID=other,AnnualUnit=100))
        self.assertEqual(result['item_results'][0]['Status'],'OK',result)
        self.assertEqual(self.snapshot()[0],D('450.50'))

    def test_snapshot_cannot_be_edited_directly(self):
        with self.assertRaisesRegex(Exception,'read-only snapshot'):
            self.cur.execute('UPDATE dbo.OpportunityItem SET ProductNetWeightGrams=1 WHERE ID=?',self.item)

    def test_request_creation_inherits_opportunity_not_current_master_weight(self):
        self.save_fields(PrimaryTypeID=self.types['Primary'],SecondaryTypeID=self.types['Secondary'])
        self.cur.execute('UPDATE dbo.Product SET WeightGrams=999 WHERE ID=?',self.product)
        created=self.request([self.item])
        self.assertEqual(self.cur.execute('SELECT WeightGrams FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',created['items'][0]['ID']).fetchval(),D(100))

    def test_mix_parent_and_children_capture_their_own_products(self):
        self.create_mix()
        self.assertEqual(self.snapshot(self.parent)[0],D('12.50'))
        self.assertEqual(self.snapshot(self.child)[0],D(100))
        self.cur.execute('UPDATE dbo.Product SET WeightGrams=999 WHERE ID=?',self.product)
        self.assertEqual(self.snapshot(self.child)[0],D(100))

    def test_migration_rerun_preserves_snapshots_and_request_history(self):
        self.save_fields(PrimaryTypeID=self.types['Primary'],SecondaryTypeID=self.types['Secondary'])
        self.request([self.item])
        before=list(self.cur.execute('SELECT ID,ProductNetWeightGrams,ProductWeightSnapshotCapturedAt,RowVersion FROM dbo.OpportunityItem ORDER BY ID'))
        requests=list(self.cur.execute('SELECT ID,WeightGrams,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID'))
        self.cur.execute('UPDATE dbo.Product SET WeightGrams=999 WHERE ID=?',self.product)
        self.apply_snapshot()
        self.assertEqual(list(self.cur.execute('SELECT ID,ProductNetWeightGrams,ProductWeightSnapshotCapturedAt,RowVersion FROM dbo.OpportunityItem ORDER BY ID')),before)
        self.assertEqual(list(self.cur.execute('SELECT ID,WeightGrams,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID')),requests)


if __name__=='__main__':unittest.main()
