import unittest
from decimal import Decimal
from pallet_capacity import pallet_capacity

class Capacity(unittest.TestCase):
    def test_gross_limit_includes_base_and_accessories_and_prefers_footprint(self):
        result=pallet_capacity(12,9,20,20,1200)
        self.assertEqual((result['cartons_per_layer'],result['pallet_layers'],result['cartons_per_pallet']),(12,4,48))
        self.assertEqual(result['gross_kg'],980)

    def test_manual_counts_must_satisfy_height_footprint_and_weight(self):
        self.assertEqual(pallet_capacity(12,9,20,20,1200,10,5)['gross_kg'],1020)
        for across,layers in ((13,1),(12,5),(10,10)):
            with self.subTest(across=across,layers=layers),self.assertRaises(ValueError):
                pallet_capacity(12,9,20,20,1200,across,layers)

    def test_horizontal_count_reduces_only_when_one_layer_would_exceed_rating(self):
        self.assertEqual(pallet_capacity(12,9,100,20,1200)['cartons_per_layer'],11)
        self.assertEqual(pallet_capacity(12,9,100,20,1200)['pallet_layers'],1)

    def test_exact_boundary_and_unknown_rating(self):
        self.assertEqual(pallet_capacity(12,9,Decimal('19.66666666666666666666666666'),20,1200,10,6)['cartons_per_pallet'],60)
        for rating in (None,0,-1):
            with self.subTest(rating=rating),self.assertRaises(ValueError):pallet_capacity(12,9,20,20,rating)

    def test_no_carton_fits_is_zero_not_overweight(self):
        result=pallet_capacity(12,9,1300,20,1200)
        self.assertEqual(result['cartons_per_pallet'],0)

if __name__=='__main__':unittest.main()
