"""Captured Mix quantities must split into whole final packages."""
import unittest
from mix_packing import captured_quantity,packing_error


class MixPacking(unittest.TestCase):
    def test_exact_divisors(self):
        for units in (1,2,3,6):
            self.assertIsNone(packing_error(6,2,[units]))
        for units in (4,5,7,12):
            self.assertIn('exact divisor',packing_error(6,2,[units]))

    def test_product_of_layers(self):
        self.assertIsNone(packing_error(6,3,[3,2]))
        self.assertIn('exact divisor',packing_error(6,3,[2,2]))
        self.assertIsNone(packing_error(6,1,[]))

    def test_captured_not_live(self):
        self.assertEqual(captured_quantity('{"items":[{"ProductID":42,"UnitQuantity":6}]}',42),6)
        self.assertIsNone(captured_quantity('{"items":[]}',42))
        self.assertIsNone(captured_quantity({'items':[{'ProductID':42,'UnitQuantity':6}]*2},42))

    def test_drafts_and_invalid_counts(self):
        self.assertIsNone(packing_error(6,3,[3,None]))
        self.assertIn('captured',packing_error(None,2,[3]))
        for units in ('1.5',0,-2):
            self.assertIn('whole',packing_error(6,2,[units]))


if __name__=='__main__':unittest.main()
