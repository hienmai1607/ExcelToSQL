"""Pure derived values and immutable, permission-guarded geometry reads."""
import json
import unittest
from decimal import Decimal as D
from unittest.mock import patch
from packaging_efficiency import geometry_metrics, saved_geometry, response_efficiency, response_derived, captured_layer_dimensions, EFFICIENCY_FIELDS
import request_views
import opportunity_views


class Efficiency(unittest.TestCase):
    def row(self, **extra):
        return dict(ResponseLayerCount=3,ThirdPMType='RSC',HeightMM='250',
            ResponseMaxPalletHeightMM=1900,CartonsPerLayer=10,NutDensity='.5',**extra)

    def packing(self):
        return dict(TertiaryNetWeightGrams='10000',LayersPerPallet=7)

    def snapshot(self, **extra):
        return {**dict(PackagingOrder='Tertiary',PackagingTypeName='RSC',
            Context={'Request':{'ConfirmedLayerCount':3}},
            ParentDimension={'SquareMeterFormula':'D1*D2','VolumeFormula':'D1*D2*D3'},
            ParentMeasurements={'D1':'3','D2':'5','D3':'2'}),**extra}

    def test_example_and_all_efficiency_formulas(self):
        geometry=saved_geometry(self.row(),self.snapshot())
        self.assertEqual(geometry,{'AreaM2':D(15),'VolumeM3':D(30)})
        values=response_efficiency(self.row(),self.packing(),geometry,'1000000')
        self.assertEqual(values['PalletHeightMM'],'1900')
        self.assertAlmostEqual(D(values['CartonEfficiencyKGM3']),D(1)/3,places=27)
        self.assertAlmostEqual(D(values['RelativeCartonEfficiencyPct']),D(1)/3/D('.5')/1000*100,places=27)
        self.assertEqual(D(values['PalletUtilizationPct']),D(15000))
        self.assertEqual(values['PalletHeightEfficiencyPct'],'100')

    def test_missing_zero_negative_and_nonfinite_denominators_stay_blank(self):
        for invalid in (None,'','0','-1','NaN','Infinity'):
            with self.subTest(value=invalid):
                values=response_efficiency(self.row(),self.packing(),{'AreaM2':invalid,'VolumeM3':invalid},invalid)
                self.assertIsNone(values['CartonEfficiencyKGM3'])
                self.assertIsNone(values['RelativeCartonEfficiencyPct'])
                self.assertIsNone(values['PalletUtilizationPct'])

    def test_relative_efficiency_ratio_is_converted_to_percentage(self):
        values=response_efficiency({**self.row(),'ResponseLayerCount':1},
            {'PrimaryNetWeightGrams':'224954'},{'VolumeM3':1},None)
        self.assertEqual(D(values['RelativeCartonEfficiencyPct']),D('44.9908'))

    def test_missing_weight_does_not_guess_zero_but_zero_weight_is_valid(self):
        values=response_efficiency(self.row(),{}, {'VolumeM3':D(30)},None)
        self.assertIsNone(values['CartonEfficiencyKGM3'])
        values=response_efficiency(self.row(),{'TertiaryNetWeightGrams':0},{'VolumeM3':30},None)
        self.assertEqual(values['CartonEfficiencyKGM3'],'0')

    def test_geometry_uses_parent_not_sum_of_child_material_areas(self):
        snapshot=self.snapshot(components=[{'Area':'999','Quantity':10}])
        self.assertEqual(saved_geometry(self.row(),snapshot)['AreaM2'],D(15))

    def test_geometry_missing_inputs_formulas_or_review_keeps_independent_results(self):
        definition={'SquareMeterFormula':'D1*D2','VolumeFormula':'D1*D2*D3'}
        values=geometry_metrics(definition,{'D1':D(3),'D2':D(5)})
        self.assertEqual(values,{'AreaM2':D(15),'VolumeM3':None})
        self.assertEqual(geometry_metrics({**definition,'FormulaNeedsReview':True},{'D1':3,'D2':5,'D3':2}),{'AreaM2':None,'VolumeM3':None})
        self.assertIsNone(geometry_metrics({'VolumeFormula':'D1/0'},{'D1':3})['VolumeM3'])

    def test_snapshot_must_match_final_order_type_and_confirmed_layers(self):
        for snapshot in (
            self.snapshot(PackagingOrder='Secondary'),self.snapshot(PackagingTypeName='Other'),
            self.snapshot(Context={'Request':{'ConfirmedLayerCount':2}}),{},'broken'):
            with self.subTest(snapshot=snapshot):
                self.assertEqual(saved_geometry(self.row(),snapshot),{'AreaM2':None,'VolumeM3':None})

    def test_zero_layers_produces_pallet_base_height(self):
        values=response_efficiency(self.row(),{**self.packing(),'LayersPerPallet':0},{},None)
        self.assertEqual(values['PalletHeightMM'],'150')

    def test_read_removes_internal_snapshot_and_preserves_immutable_formula(self):
        row={**self.row(),'FinalLayerPricingSnapshot':json.dumps(self.snapshot()),'EfficiencyPalletAreaMM2':'1000000'}
        values=response_derived(row,self.packing())
        self.assertNotIn('FinalLayerPricingSnapshot',row)
        self.assertNotIn('EfficiencyPalletAreaMM2',row)
        self.assertEqual(D(values['FinalLayerVolumeM3']),D(30))

    def test_unapproved_response_metrics_are_hidden_in_both_entities(self):
        request={**self.row(), 'PackingWayVisible':0,'FinalLayerPricingSnapshot':json.dumps(self.snapshot()),'EfficiencyPalletAreaMM2':'1000000'}
        request['TertiaryLayerPricingSnapshot']=json.dumps(self.snapshot())
        with patch('packaging_api.execute',return_value=[[request],[{'Total':1}]]) as query:
            row=request_views.item_read('Sales',1,1,25,None,None,'[]')['rows'][0]
            for key in EFFICIENCY_FIELDS:
                self.assertIsNone(row[key])
            self.assertNotIn('FinalLayerPricingSnapshot',row)
            self.assertNotIn('TertiaryLayerPricingSnapshot',row)
            self.assertIsNone(row['LayerDimensionCaptures'])
            self.assertIn("CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN tertiary_pricing.SnapshotJSON END TertiaryLayerPricingSnapshot",query.call_args.args[0])
            self.assertIn("CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN efficiency_pallet.PalletAreaMM2",query.call_args.args[0])
        opportunity={**self.row(),'PackingWayVisible':0,'PackingRequestedLayers':3,
            'FinalLayerPricingSnapshot':json.dumps(self.snapshot()),'EfficiencyPalletAreaMM2':'1000000'}
        opportunity['TertiaryLayerPricingSnapshot']=json.dumps(self.snapshot())
        with patch.object(opportunity_views,'execute',return_value=[[opportunity],[{'Total':1}]]) as query:
            row=opportunity_views.sorted_grid('Sales',1,25,'[]')['rows'][0]
            for key in EFFICIENCY_FIELDS:
                self.assertIsNone(row[key])
            self.assertNotIn('FinalLayerPricingSnapshot',row)
            self.assertNotIn('TertiaryLayerPricingSnapshot',row)
            self.assertIsNone(row['LayerDimensionCaptures'])
            self.assertIn("CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN tertiary_pricing.SnapshotJSON END TertiaryLayerPricingSnapshot",query.call_args.args[0])
            self.assertIn("CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN efficiency_pallet.PalletAreaMM2",query.call_args.args[0])


    def dimension_snapshot(self, order='Tertiary', name='RSC', **extra):
        return self.snapshot(**{**dict(PackagingOrder=order,PackagingTypeName=name,
            ParentDimension={'D1Name':'Length','D1Unit':'mm','D2Name':'Width','D2Unit':'cm',
                             'D3Name':'Height','D3Unit':'mm'}),**extra})

    def test_captured_dimensions_keep_names_units_and_values_for_every_layer(self):
        row=self.row(FirstPMType='Pillow',SecondPMType='Carton')
        snapshots={order:json.dumps(self.dimension_snapshot(order,name))
            for order,name in [('Primary','Pillow'),('Secondary','Carton'),('Tertiary','RSC')]}
        captures=captured_layer_dimensions(row,snapshots)
        self.assertEqual(set(captures),{'Primary','Secondary','Tertiary'})
        self.assertEqual(captures['Secondary'],dict(PackagingTypeName='Carton',LayerCount=3,Dimensions=[
            dict(Name='Length',Unit='mm',Value='3'),dict(Name='Width',Unit='cm',Value='5'),
            dict(Name='Height',Unit='mm',Value='2')]))
        raw={**row,**{order+'LayerPricingSnapshot':value for order,value in snapshots.items()}}
        self.assertEqual(response_derived(raw,self.packing())['LayerDimensionCaptures'],captures)
        for order in snapshots:
            self.assertNotIn(order+'LayerPricingSnapshot',raw)

    def test_optional_d3_and_legacy_child_dimensions_are_not_guessed(self):
        snapshot=self.dimension_snapshot(ParentMeasurements={'D1':'100','D2':'200','D3':None})
        capture=captured_layer_dimensions(self.row(),{'Tertiary':snapshot})['Tertiary']
        self.assertEqual(len(capture['Dimensions']),2)
        self.assertEqual(capture['Dimensions'][0]['Value'],'100')
        for measurements in ({},None,{'D1':'NaN','D2':'0','D3':'-1'}):
            self.assertEqual(captured_layer_dimensions(self.row(),{'Tertiary':
                self.dimension_snapshot(ParentMeasurements=measurements,components=[
                    {'Measurements':{'D1':'999','D2':'999','D3':'999'}}])}),{})

    def test_captured_dimensions_require_matching_order_type_and_layer_count(self):
        for snapshot in (self.dimension_snapshot('Primary'),self.dimension_snapshot(name='Other'),
                self.dimension_snapshot(Context={'Request':{'ConfirmedLayerCount':2}}),
                'broken',[],{},self.dimension_snapshot(ParentDimension='invalid')):
            self.assertEqual(captured_layer_dimensions(self.row(),{'Tertiary':snapshot}),{})
        self.assertEqual(captured_layer_dimensions({**self.row(),'ResponseLayerCount':2},
            {'Tertiary':self.dimension_snapshot()}),{})


if __name__=='__main__':
    unittest.main()
