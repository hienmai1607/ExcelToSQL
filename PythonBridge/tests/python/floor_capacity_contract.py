import unittest
from load_planning import Dimensions
from floor_capacity_api import propose_floor,validate_manual_count


class FloorCapacity(unittest.TestCase):
    def propose(self,**changes):
        spec=dict(length=600,width=400,height=400,payload_kg=20)
        spec.update(changes)
        return propose_floor([dict(ID=1,Code='TEST',Specifications=spec)],Dimensions(length=200,width=200,height=200),2)[0]

    def test_payload_and_geometry(self):
        row=self.propose()
        self.assertEqual(row['Result']['geometric_units'],12)
        self.assertEqual(row['Result']['cartons'],10)
        self.assertEqual(row['Result']['gross_kg'],20)
        self.assertEqual(len(row['Result']['container_layer']),6)

    def test_manual_override(self):
        row=self.propose()
        for n in (1,5,10):validate_manual_count(n,row)
        for n in (0,-1,1.5,11):
            with self.assertRaises(ValueError):validate_manual_count(n,row)

    def test_doors_and_clearance(self):
        self.assertEqual(self.propose(door_height=100)['Result']['cartons'],0)
        self.assertEqual(self.propose(clearance_length=200)['Result']['cartons'],8)

    def test_missing_payload_not_guessed(self):
        row=self.propose(payload_kg=None)
        self.assertIn('payload',row['error'])
        with self.assertRaises(ValueError):validate_manual_count(1,row)


if __name__=='__main__':unittest.main()
