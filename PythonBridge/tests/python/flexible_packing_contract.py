"""Reusable mixed-rotation packing, bounds and PCR-33162 regression."""
import sys
import unittest
from decimal import Decimal
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
from load_planning import footprint,PlanInput,plan
from rectangle_packing import layout, _solve
from functools import lru_cache

class FlexiblePacking(unittest.TestCase):
 def check(self,places,L,W,l,w):
  for i,a in enumerate(places):
   x,y,dx,dy=(Decimal(str(a[k])) for k in ('x','y','length','width'))
   self.assertGreaterEqual(x,0);self.assertGreaterEqual(y,0)
   self.assertLessEqual(x+dx,Decimal(str(L)));self.assertLessEqual(y+dy,Decimal(str(W)))
   self.assertIn((dx,dy),[(Decimal(str(l)),Decimal(str(w))),(Decimal(str(w)),Decimal(str(l)))])
   for b in places[i+1:]:
    X,Y,D,E=(Decimal(str(b[k])) for k in ('x','y','length','width'))
    self.assertTrue(x+dx<=X or X+D<=x or y+dy<=Y or Y+E<=y)
 def test_pcr33162_finds_twenty_without_overlap(self):
  places=footprint(1118,1118,296,195)
  self.assertEqual(len(places),20)
  self.check(places,1118,1118,296,195)
 def test_pattern_is_not_hardcoded_to_this_request_or_units(self):
  for factor in [Decimal('.1'),Decimal('1'),Decimal('2')]:
   L=1118*factor;l=296*factor;w=195*factor
   for a,b in [(l,w),(w,l)]:
    places=footprint(L,L,a,b)
    self.assertEqual(len(places),20)
    self.check(places,L,L,a,b)
 def test_response_twenty_now_previews_and_eighteen_is_still_respected(self):
  inputs=dict(carton=dict(length=296,width=195,height=147),carton_kg=Decimal('5.41'),
   pallet=dict(length=1118,width=1118,height=150),pallet_kg=Decimal('19.96'),
   max_pallet_height=900,double_stack=True,stackable=True,
   container=dict(length=5898,width=2352,height=2393),payload_kg=28200)
  for count in [18,20]:
   result=plan(PlanInput(**inputs,cartons_per_layer=count))
   self.assertEqual(result['cartons_per_layer'],count)
   self.assertEqual(result['pallet_layers'],5)
   self.assertEqual(result['cartons_per_pallet'],count*5)
   self.assertEqual(result['loaded_unit_height'],885)
   self.assertEqual(result['pallet_layer_capacity'],20)
   self.assertEqual(result['pallet_layer_upper_bound'],20)
   self.assertTrue(result['pallet_layout_optimal'])
 def test_twenty_one_is_rejected_using_a_proven_bound(self):
  p=PlanInput(carton=dict(length=296,width=195,height=147),pallet=dict(length=1118,width=1118,height=150),
   max_pallet_height=900,cartons_per_layer=21,container=dict(length=5898,width=2352,height=2393))
  with self.assertRaisesRegex(ValueError,'proven.*20'):plan(p)
 def test_rotation_disabled_is_respected(self):
  places=footprint(1118,1118,296,195,False)
  self.assertEqual(len(places),15)
  self.assertTrue(all(p['length']==296 and p['width']==195 for p in places))

class IndependentOracle(unittest.TestCase):
 def test_small_integer_layouts_and_upper_bounds_against_exhaustive_oracle(self):
  def exact(L,W,l,w):
   candidates=[[] for _ in range(L*W)]
   for a,b in set([(l,w),(w,l)]):
    for y in range(W-b+1):
     for x in range(L-a+1):
      mask=sum(1<<(j*L+i) for j in range(y,y+b) for i in range(x,x+a))
      for k in range(L*W):
       if mask>>k&1:candidates[k].append(mask)
   full=(1<<(L*W))-1
   @lru_cache(None)
   def visit(used):
    if used==full:return 0
    empty=full^used;k=(empty&-empty).bit_length()-1
    best=visit(used|1<<k)
    for mask in candidates[k]:
     if not mask&used:best=max(best,1+visit(used|mask))
    return best
   return visit(0)
  for L in range(3,8):
   for W in range(3,7):
    for l,w in [(3,2),(4,3)]:
     with self.subTest(L=L,W=W,l=l,w=w):
      fit=layout(L,W,l,w);maximum=exact(L,W,l,w)
      self.assertLessEqual(len(fit.rectangles),maximum)
      self.assertGreaterEqual(fit.upper_bound,maximum)
      if fit.optimal:self.assertEqual(len(fit.rectangles),maximum)
 def test_cached_coordinates_cannot_be_mutated_by_callers(self):
  first=footprint(1118,1118,296,195);first[0]['x']=-1
  self.assertGreaterEqual(footprint(1118,1118,296,195)[0]['x'],0)

if __name__=='__main__':unittest.main()
