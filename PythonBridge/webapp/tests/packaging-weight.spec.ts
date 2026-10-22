import {test,expect} from '@playwright/test';
import {mixContentsGross,packagingGross} from '../src/packaging-weight';

test('Mix child gross weights are allocated per smallest product unit, not per carton',()=>{
 const snapshot={items:[{ProductID:1,UnitQuantity:2}]};
 const child={ProductID:1,ApplicableNetWeightGrams:'396.89',ResponseLayerCount:2,UnitsPerCarton:'10',LayerTareJSON:{Primary:{KG:'.01'},Secondary:{KG:'.2'}}};
 const contents=mixContentsGross(snapshot,[child]);
 expect(contents).toBeCloseTo(.85378,10);
 expect(packagingGross('793.78',{},1,{Primary:{KG:'.05'}},contents).Primary).toBeCloseTo(.90378,10);
 const tertiary={...child,ResponseLayerCount:3,UnitsPerTertiary:'5',LayerTareJSON:{...child.LayerTareJSON,Tertiary:{KG:'.5'}}};
 expect(mixContentsGross(snapshot,[tertiary])).toBeCloseTo(.87378,10);
 expect(mixContentsGross(snapshot,[{...tertiary,CartonGrossWeightKG:'21.8445'}])).toBeCloseTo(.87378,10);
});

test('Mix child unknown or invalid counts never become a whole carton or zero',()=>{
 const snapshot={items:[{ProductID:1,UnitQuantity:1}]};
 for(const units of [null,undefined,'',0,-1,1.5,2147483648]){
  expect(mixContentsGross(snapshot,[{ProductID:1,RequestedLayerCount:2,UnitsPerCarton:units,CartonGrossWeightKG:1}])).toBeNull();
 }
 expect(mixContentsGross(snapshot,[{ProductID:1,ResponseLayerCount:2,UnitsPerCarton:10,CartonGrossWeightKG:null}])).toBeNull();
 expect(mixContentsGross(snapshot,[{ProductID:1,ResponseLayerCount:2,UnitsPerCarton:10,CartonGrossWeightKG:0}])).toBe(0);
});
