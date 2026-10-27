import unittest
from decimal import Decimal
from packaging_layers import layer_start,global_order,validate_family
from packing_way import packing_way

class LayerModel(unittest.TestCase):
    def test_mix_offsets_follow_deepest_child_not_sum_of_children(self):
        self.assertEqual(validate_family(2,[2,1]),3)
        self.assertEqual(global_order('Primary',3),'Tertiary')
        self.assertEqual(global_order('Secondary',3),'Quaternary')
        self.assertEqual(validate_family(3,[1,1]),2)
        self.assertEqual(validate_family(1,[3,2]),4)

    def test_parent_always_has_a_layer_and_total_cannot_exceed_four(self):
        for parent,children in [(0,[2]),(3,[2]),(1,[4]),(4,[1])]:
            with self.subTest(parent=parent,children=children),self.assertRaises(ValueError):validate_family(parent,children)

    def test_saved_family_rejects_over_budget_and_stale_parent_type(self):
        from packaging_layers import validate_saved_families
        from fastapi import HTTPException
        class Cursor:
            def __init__(self,row):self.row=row
            def execute(self,*args):return self
            def fetchall(self):return [self.row]
            def fetchone(self):return None
        for row in [(1,3,3,None,None,None,None,None),(2,4,1,None,None,None,None,1),(1,1,4,'Wrong type',None,None,None,None)]:
            with self.subTest(row=row),self.assertRaises(HTTPException) as error:
                validate_saved_families(Cursor(row),[row[0]])
            self.assertEqual(error.exception.status_code,422)

    def test_standalone_four_layer_net_gross_and_unit_factors(self):
        row=dict(WeightGrams=100,ResponseLayerCount=4,UnitsPerCarton=10,UnitsPerTertiary=5,UnitsPerQuaternary=2,
                 CartonsPerLayer=2,LayersPerPallet=3,LayerTareJSON={order:{'KG':'0'} for order in ('Primary','Secondary','Tertiary','Quaternary')})
        result=packing_way(row)
        self.assertEqual(Decimal(result['QuaternaryNetWeightGrams']),10000)
        self.assertEqual(Decimal(result['CartonGrossWeightKG']),10)
        self.assertEqual(Decimal(result['UnitsPerPallet']),600)

if __name__=='__main__':unittest.main()
