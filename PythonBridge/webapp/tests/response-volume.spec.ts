import {test,expect} from '@playwright/test';
import {usedVolumeDisplay} from '../src/response-volume';

test('volume preview divides exact decimal net weight by density and rounds to six places',()=>{
 for(const [weight,density,expected] of [
  ['150.00','0.6','250'],['1','3','0.333333'],['2','3','0.666667'],
  ['0.10','0.05','2'],['10','0.000001','10,000,000'],['0','0.5','0']
 ])expect(usedVolumeDisplay(weight,density)).toBe(expected);
});
test('missing weight or invalid density never displays a misleading zero or infinity',()=>{
 for(const weight of [null,undefined,'','bad','-1'])expect(usedVolumeDisplay(weight,'0.6')).toBe('');
 for(const density of ['','0','-1','0.0000001','bad','NaN','Infinity'])expect(usedVolumeDisplay(150,density)).toBe('');
});
