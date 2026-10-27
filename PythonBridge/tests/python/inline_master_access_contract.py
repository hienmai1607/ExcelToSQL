"""Shortcut endpoints must inherit the corresponding master page permission."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from fastapi import HTTPException
from auth import AccessContext
from workspace_access import route_pages,enforce_route
from inline_master_api import TABLES,authorize

class InlineMasterAccess(unittest.TestCase):
 def test_every_supported_shortcut_maps_to_its_master_page(self):
  for entity in TABLES:
   with self.subTest(entity=entity):self.assertEqual(route_pages('/api/inline-masters/'+entity+'/123'),(entity,))
 def test_packaging_price_editor_accepts_its_existing_edit_permission(self):
  ctx=AccessContext(2,'Packaging editor',frozenset({'Packaging'}),permissions={'prices':'edit','requests':'edit'})
  for method in ('GET','POST'):enforce_route(ctx,'/api/inline-masters/prices/123',method)
  authorize(ctx,'prices')
 def test_display_only_does_not_gain_edit_permission(self):
  ctx=AccessContext(2,'Reviewer',frozenset({'PackagingManager'}),permissions={'prices':'display','requests':'edit'})
  enforce_route(ctx,'/api/inline-masters/prices/123','GET')
  with self.assertRaises(HTTPException):enforce_route(ctx,'/api/inline-masters/prices/123','POST')
  with self.assertRaises(HTTPException):authorize(ctx,'prices')
 def test_request_edit_permission_alone_does_not_allow_price_maintenance(self):
  ctx=AccessContext(2,'PIC',frozenset({'Packaging'}),permissions={'requests':'edit','prices':'none'})
  for method in ('GET','POST'):
   with self.assertRaises(HTTPException):enforce_route(ctx,'/api/inline-masters/prices/123',method)
 def test_unknown_shortcut_is_still_blocked(self):
  ctx=AccessContext(2,'Packaging editor',frozenset({'Packaging'}),permissions={'prices':'edit'})
  with self.assertRaises(HTTPException):enforce_route(ctx,'/api/inline-masters/unknown/123','GET')

if __name__=='__main__':unittest.main()
