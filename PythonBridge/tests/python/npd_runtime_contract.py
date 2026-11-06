"""Read-only HTTP model probes: deliberately invalid values prevent business writes."""
import json,unittest,urllib.request,urllib.error

class RuntimeSchemas(unittest.TestCase):
 def check_route(self,path,payload,fields):
  for attempt in range(12):
   with self.subTest(attempt=attempt):
    req=urllib.request.Request('http://127.0.0.1:8000'+path,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-User-Name':'Admin'})
    try:
     with urllib.request.urlopen(req,timeout=15) as response:result=json.load(response)
     self.fail('Invalid probe unexpectedly accepted')
    except urllib.error.HTTPError as error:
     self.assertEqual(error.code,422)
     errors=json.load(error)['detail'];error.close()
     self.assertIsInstance(errors,list)
     rejected=[entry['loc'] for entry in errors if entry.get('type')=='extra_forbidden' and entry['loc'][-1] in fields]
     self.assertEqual(rejected,[],f'Running API rejects current NPD fields: {rejected}')
 def test_current_ingredient_fields_are_supported(self):
  self.check_route('/api/npd/ingredients',{'Description':'Read-only model probe','GradeNature':'probe','Origin':'','BaseUoMID':0},{'GradeNature'})
 def test_current_sheet_fields_are_supported(self):
  self.check_route('/api/npd/sheets/0/preview',{'RowVersion':'probe','Status':'Draft','Lines':[{'Kind':'Seasoning','IngredientID':1,'RatioPct':-1,'LossPct':0,'DirectPricePerKg':'1','DirectPriceCurrency':'USD','PriceMode':'Direct','DirectVendorID':1,'IngredientNote':'','Note':'probe'}]},{'DirectPricePerKg','DirectPriceCurrency','PriceMode','DirectVendorID','IngredientNote','Note'})

 def test_manager_approval_changes_are_supported(self):
  self.check_route('/api/npd/sheets/0/review',{'RowVersion':'probe','Action':'Approve','Changes':{'RowVersion':'probe','Status':'Final','Lines':[{'Kind':'Raw','GradePath':'0/1','RatioPct':-1}]}},{'Changes'})

if __name__=='__main__':unittest.main()
