import {test,expect} from '@playwright/test';
import {balanceFirstGradeRatio} from '../src/grade-ratios';
import type {GradeItem} from '../src/product-grades';
const node=(ParentID:string,ID:number,RatioPct:string):GradeItem=>({ParentID,ID,RatioPct,Grade:'Grade '+ID,RawGradeID:ID});
test('first ratio balances exact decimals within its own sibling group',()=>{
 const rows=[node('0',1,'60'),node('0',2,'35.25'),node('0',3,'4.5'),node('0/1',1,'70'),node('0/1',2,'30')];
 const balanced=balanceFirstGradeRatio(rows,'0');
 expect(balanced.map(i=>i.RatioPct)).toEqual(['60.25','35.25','4.5','70','30']);
 expect(rows[0].RatioPct).toBe('60');
 const nested=balanceFirstGradeRatio(balanced.map(i=>i.ParentID==='0/1'&&i.ID===2?{...i,RatioPct:'22.22'}:i),'0/1');
 expect(nested.map(i=>i.RatioPct)).toEqual(['60.25','35.25','4.5','77.78','22.22']);
});
test('removing siblings restores remainder and over-allocation remains invalid',()=>{
 expect(balanceFirstGradeRatio([node('0',4,'20')],'0')[0].RatioPct).toBe('100');
 const invalid=balanceFirstGradeRatio([node('0',1,'50'),node('0',2,'70'),node('0',3,'40')],'0');
 expect(invalid[0].RatioPct).toBe('-10');
 expect(balanceFirstGradeRatio([node('0',1,'60'),node('0',2,'abc')],'0')[0].RatioPct).toBe('60');
});
