import unittest
from pydantic import ValidationError
from packaging_fields import ContainerLoadProfile
from container_loading import published_options,proposed_types,container_results,validate_requested_proposal


class Proposals(unittest.TestCase):
 def row(self):
  return dict(ConfigurationRequest='Floor load',ResponseLayerCount=1,WeightGrams=100,SelectedContainerType='20DC',CartonsPerContainerFloor=20,ContainerLoadProfiles={'20DC':{'CartonsPerContainerFloor':20,'Proposal':False},'40DC':{'CartonsPerContainerFloor':40,'Proposal':True}},ContainerPlansJSON=[])

 def test_flags_are_strict(self):
  for value in (True,False):self.assertEqual(ContainerLoadProfile(Proposal=value).Proposal,value)
  for value in (None,0,1,'true','false'):
   with self.assertRaises(ValidationError):ContainerLoadProfile(Proposal=value)
  self.assertNotIn('Proposal',ContainerLoadProfile(CartonsPerContainer=10).model_dump(exclude_unset=True))

 def test_only_proposals_are_published(self):
  row=published_options(self.row())
  self.assertEqual(row['ProposedContainerTypes'],['40DC'])
  self.assertIsNone(row['CartonsPerContainerFloor'])
  self.assertEqual(set(container_results(row)),{'40DC'})
  self.assertEqual(container_results(row)['40DC']['CalculatedCartonsPerContainer'],'40')

 def test_all_unchecked_is_not_legacy(self):
  row=self.row();row['ContainerLoadProfiles']['40DC']['Proposal']=False
  result=published_options(row)
  self.assertEqual(result['ProposedContainerTypes'],[])
  self.assertEqual(container_results(result),{})

 def test_legacy_and_plan_filtering(self):
  legacy={'ContainerLoadProfiles':{'20DC':{'CartonsPerContainerFloor':20}}}
  self.assertIsNone(proposed_types(legacy));self.assertEqual(published_options(legacy),legacy)
  row=self.row();row['ContainerPlansJSON']=[{'Code':'20DC'},{'Code':'40DC'}]
  self.assertEqual(published_options(row)['ContainerPlansJSON'],[{'Code':'40DC'}])

 def test_requested_type_is_mandatory_but_alternatives_are_allowed(self):
  validate_requested_proposal({'40DC':{'Proposal':True},'20RC':{'Proposal':True}},'40DC')
  with self.assertRaises(ValueError):validate_requested_proposal({'40DC':{'Proposal':False},'20RC':{'Proposal':True}},'40DC')
  validate_requested_proposal({'20RC':{'Proposal':True},'40HC':{'Proposal':True}},'Reefer','20FT')
  with self.assertRaises(ValueError):validate_requested_proposal({'40HC':{'Proposal':True}},'Reefer','20FT')


if __name__=='__main__':unittest.main()
