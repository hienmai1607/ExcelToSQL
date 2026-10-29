import {test,expect} from '@playwright/test';
import {mixPackingWay} from '../src/mix-packing';

test('Packing way reconciles child layers with the captured parent quantity',()=>{
 expect(mixPackingWay(6,{ResponseLayerCount:3,UnitsPerCarton:3,UnitsPerTertiary:2})).toBe('(3x2x1)x1');
 expect(mixPackingWay(4,{ResponseLayerCount:2,UnitsPerCarton:2})).toBe('(2x1)x2');
 expect(mixPackingWay(10,{ResponseLayerCount:1})).toBe('(1)x10');
 expect(mixPackingWay('6.0000',{ResponseLayerCount:3,UnitsPerCarton:'3.0000',UnitsPerTertiary:'2.0000'})).toBe('(3x2x1)x1');
});

test('Packing way stays unavailable without an exact, complete response',()=>{
 expect(mixPackingWay(4,{ResponseLayerCount:2,UnitsPerCarton:3})).toBeNull();
 expect(mixPackingWay(6,{ResponseLayerCount:3,UnitsPerCarton:3})).toBeNull();
 expect(mixPackingWay(6,undefined)).toBeNull();
 expect(mixPackingWay(0,{ResponseLayerCount:1})).toBeNull();
 expect(mixPackingWay('2.5',{ResponseLayerCount:1})).toBeNull();
});
