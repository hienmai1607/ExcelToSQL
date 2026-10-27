"""Diameter shipping envelopes and actual saved-response geometry parsing; no writes."""
import sys
import unittest
from pathlib import Path
from decimal import Decimal as D
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from shipping_geometry import shipping_envelope
from load_planning_api import response_dimensions


class ShippingGeometry(unittest.TestCase):
 def test_diameter_fills_both_missing_footprint_axes(self):
  for name in ('dia','diameter'):
   self.assertEqual(shipping_envelope({name:D(150),'height':D(500)}),dict(length=D(150),width=D(150),height=D(500)))
 def test_explicit_rectangle_is_not_overwritten(self):
  self.assertEqual(shipping_envelope(dict(length=200,width=100,height=500,dia=150)),dict(length=200,width=100,height=500))
  self.assertNotIn('width',shipping_envelope(dict(length=200,dia=150,height=500)))
 def test_unknown_width_is_not_guessed(self):
  self.assertNotIn('width',shipping_envelope(dict(length=200,height=500)))
 def test_saved_bucket_uses_first_dia_slot_not_legacy_dummy_d2(self):
  dimensions=[dict(Name='Dia',Unit='mm',Value='150'),dict(Name='Dia',Unit='mm',Value='1'),dict(Name='Height',Unit='mm',Value='500')]
  with patch('load_planning_api.select',side_effect=[[[dict(ResponseLayerCount=1)]],[[]]]),patch('packaging_efficiency.captured_layer_dimensions',return_value={'Primary':{'Dimensions':dimensions}}):
   self.assertEqual(response_dimensions(None,1),dict(length='150',width='150',height='500'))


if __name__=='__main__':unittest.main()
