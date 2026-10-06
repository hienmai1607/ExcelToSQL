"""Mix volume and efficiency: frozen composition, same-request densities, no history writes."""
import json
import unittest
from decimal import Decimal as D
from mix_efficiency import mix_totals
from packaging_efficiency import response_efficiency, response_derived
from packing_way import packing_way
from request_views import item_read
from opportunity_views import sorted_grid
import mix_parent_logistics_contract as foundation
from container_profiles_contract import ProfileFixture


class MixMath(unittest.TestCase):
    def structure(self):
        return dict(items=[dict(ProductID=1, UnitQuantity='2', WeightGrams='150'),
                           dict(ProductID=2, UnitQuantity='1', WeightGrams='450')])

    def children(self):
        return [dict(ItemID=10, ProductID=1, NutDensity='.6'),
                dict(ItemID=11, ProductID=2, NutDensity='.9')]

    def row(self, **extra):
        return dict(IsMixParent=True, ProductMixSnapshot=json.dumps(self.structure()),
                    MixResponseChildren=json.dumps(self.children()), ResponseLayerCount=3,
                    UnitsPerCarton=12, UnitsPerTertiary=5, WeightGrams=750, **extra)

    def test_exact_composition_sums_and_efficiency_ignore_parent_density_and_packing_counts(self):
        totals = mix_totals(self.structure(), self.children())
        self.assertEqual(totals, dict(weight=D(750), volume=D(1000)))
        for density in (None, '.001', '999'):
            row = self.row(NutDensity=density)
            values = response_efficiency(row, packing_way(row), dict(VolumeM3='.002'), None)
            self.assertEqual(D(values['CartonEfficiencyKGM3']), D(375))
            self.assertEqual(D(values['RelativeCartonEfficiencyPct']), D(50))

    def test_missing_invalid_or_duplicate_child_density_does_not_sum_partial_volume(self):
        for invalid in (None, '', '0', '-1', 'NaN', 'Infinity'):
            children = self.children()
            children[1]['NutDensity'] = invalid
            totals = mix_totals(self.structure(), children)
            self.assertEqual(totals['weight'], D(750))
            self.assertIsNone(totals['volume'])
        for children in ([], self.children()[:1], self.children()+self.children()[:1], None):
            self.assertIsNone(mix_totals(self.structure(), children)['volume'])

    def test_missing_density_keeps_weight_efficiency_but_not_relative(self):
        row = self.row()
        row['MixResponseChildren'] = '[]'
        values = response_efficiency(row, packing_way(row), dict(VolumeM3='.002'), None)
        self.assertEqual(D(values['CartonEfficiencyKGM3']), D(375))
        self.assertIsNone(values['RelativeCartonEfficiencyPct'])

    def test_missing_structure_and_bad_weights_are_never_guessed_from_parent(self):
        for snapshot in (None, 'broken', [], {}, dict(items=[]), dict(items=[None]),
                         dict(items=[dict(ProductID=1, UnitQuantity=0, WeightGrams=150)])):
            self.assertEqual(mix_totals(snapshot, self.children()), dict(weight=None, volume=None))
        row = self.row(NutDensity='.5')
        row['ProductMixSnapshot'] = None
        values = response_efficiency(row, packing_way(row), dict(VolumeM3='.002'), None)
        self.assertIsNone(values['CartonEfficiencyKGM3'])
        self.assertIsNone(values['RelativeCartonEfficiencyPct'])

    def test_sum_before_rounding_and_zero_weight(self):
        structure = dict(items=[dict(ProductID=1, UnitQuantity=1, WeightGrams=1),
                                dict(ProductID=2, UnitQuantity=1, WeightGrams=1)])
        totals = mix_totals(structure, [dict(ProductID=n, NutDensity=3) for n in (1, 2)])
        self.assertEqual(totals['volume'].quantize(D('.000001')), D('.666667'))
        structure['items'][0]['WeightGrams'] = 0
        structure['items'][1]['WeightGrams'] = 0
        self.assertEqual(mix_totals(structure, self.children()), dict(weight=D(0), volume=D(0)))

    def test_read_derives_used_volume_and_uses_matching_shipping_geometry(self):
        row = self.row(ThirdPMType='RSC', UsedVolumeML='999')
        row['FinalLayerPricingSnapshot'] = json.dumps(dict(PackagingOrder='Tertiary', PackagingTypeName='RSC',
            Context=dict(Request=dict(ConfirmedLayerCount=3)),
            ParentDimension=dict(Shipping=True, ParentDimensionID=None, OccupiedM2Formula='D1*D2/1000000',
                                 OccupiedM3Formula='D1*D2*D3/1000000000'),
            ParentMeasurements=dict(D1='100', D2='200', D3='100')))
        values = response_derived(row, packing_way(row))
        self.assertEqual(D(values['UsedVolumeML']), D(1000))
        self.assertEqual(D(values['MixNetWeightGrams']), D(750))
        self.assertEqual(D(values['CartonEfficiencyKGM3']), D(375))
        self.assertEqual(D(values['RelativeCartonEfficiencyPct']), D(50))
        row['FinalLayerPricingSnapshot'] = None
        self.assertIsNone(response_derived(row, packing_way(row))['CartonEfficiencyKGM3'])

    def test_normal_product_and_mix_child_keep_original_density_formula(self):
        for extra in ({}, dict(ParentItemID=42, IsMixParent=False)):
            row = dict(ResponseLayerCount=2, WeightGrams=150, UnitsPerCarton=12, NutDensity='.6', **extra)
            values = response_efficiency(row, packing_way(row), dict(VolumeM3='.002'), None)
            self.assertEqual(D(values['CartonEfficiencyKGM3']), D(900))
            self.assertEqual(D(values['RelativeCartonEfficiencyPct']), D(150))


class MixReadsSQL(ProfileFixture, unittest.TestCase):
    batch = foundation.MixLogisticsSQL.batch
    activate = foundation.MixLogisticsSQL.activate
    create_mix = foundation.MixLogisticsSQL.create_mix
    edit = foundation.MixLogisticsSQL.edit
    request = foundation.MixLogisticsSQL.request
    setUp = foundation.MixLogisticsSQL.setUp

    def request_mix(self, children=True):
        created = self.request([self.parent, self.child] if children else [self.parent])
        self.header = created['header']['ID']
        self.root_req = next(r['ID'] for r in created['items'] if r['OpportunityItemID'] == self.parent)
        self.child_req = next((r['ID'] for r in created['items'] if r['OpportunityItemID'] == self.child), None)
        if self.child_req:
            self.req = self.child_req
            self.save(NutDensity='.5')
        return created

    def parent_read(self):
        # The root must calculate correctly while its child is on a different page.
        page = item_read(self.username, self.header, 1, 1, None, None, '[]')
        self.assertEqual(page['rows'][0]['ItemID'], self.root_req)
        return page['rows'][0]

    def test_parent_only_page_uses_all_same_request_children_and_frozen_weights(self):
        self.request_mix()
        row = self.parent_read()
        self.assertTrue(row['IsMixParent'])
        self.assertIsNone(row['NutDensity'])
        self.assertEqual(D(row['UsedVolumeML']), D(25))  # .125 child x 100g / .5g/ml
        children = json.loads(row['MixResponseChildren'])
        self.assertEqual(children[0]['ItemID'], self.child_req)
        self.cur.execute('UPDATE dbo.Product SET WeightGrams=999 WHERE ID=?', self.product)
        self.assertEqual(D(self.parent_read()['UsedVolumeML']), D(25))
        self.req = self.child_req
        self.save(NutDensity='.25')
        self.assertEqual(D(self.parent_read()['UsedVolumeML']), D(50))
        rows = sorted_grid(self.username, 1, 25, '[]', opportunity_number=self.number)['rows']
        parent = next(r for r in rows if r['ItemID'] == self.parent)
        self.assertEqual(D(parent['UsedVolumeML']), D(50))

    def test_child_density_in_a_different_request_cannot_complete_parent_volume(self):
        self.request_mix(children=False)
        child_request = self.request([self.child])
        self.req = child_request['items'][0]['ID']
        self.save(NutDensity='.5')
        self.assertIsNone(self.parent_read()['UsedVolumeML'])

    def test_parent_saves_without_density_and_client_cannot_supply_derived_totals(self):
        import packaging_api as api
        from pydantic import ValidationError
        self.request_mix()
        self.req = self.root_req
        self.save(CartonsPerLayer=10)
        self.assertIsNone(self.parent_read()['NutDensity'])
        for key in ('UsedVolumeML', 'MixNetWeightGrams', 'CartonEfficiencyKGM3', 'RelativeCartonEfficiencyPct'):
            with self.assertRaises(ValidationError):
                api.ResponseRow(RowNum=1, ID=self.root_req, RowVersion='AAAAAAAAAAE=', **{key: 999})

    def test_opportunity_role_cannot_use_unapproved_child_density_even_if_parent_is_approved(self):
        self.request_mix()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?", self.root_req)
        self.cur.execute('DELETE FROM dbo.UserAccess WHERE UserID=?', self.actor)
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')", self.actor)
        row = self.parent_read()
        self.assertIsNone(row['UsedVolumeML'])
        self.assertIsNone(json.loads(row['MixResponseChildren'])[0]['NutDensity'])
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?", self.child_req)
        self.assertEqual(D(self.parent_read()['UsedVolumeML']), D(25))
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Assigned',IsOpen=1 WHERE ID=?", self.root_req)
        hidden = self.parent_read()
        self.assertIsNone(hidden['UsedVolumeML'])
        self.assertIsNone(hidden['MixResponseChildren'])
        self.assertIsNone(hidden['CartonEfficiencyKGM3'])


if __name__ == '__main__':
    unittest.main()
