import {displayValue,exportValue} from '../src/master-config';
import {test,expect} from '@playwright/test';
import {numberDisplay,opportunityDisplay} from '../src/number-format';
test('money uses two decimals without losing large decimal precision',()=>{
 expect(numberDisplay('UnitPrice','12345678901234.1250')).toBe('12,345,678,901,234.13');
 expect(numberDisplay('UnitUSDPrice','1.00000000')).toBe('1.00');
 expect(numberDisplay('PMCost','0')).toBe('0.00');
 expect(numberDisplay('ShelfPrice','-1.235')).toBe('-1.24');
});
test('numbers use at most three decimals and preserve null',()=>{
 expect(numberDisplay('WeightGrams','10.1235')).toBe('10.124');
 expect(numberDisplay('ExchangeRateToUSD','25000.0000000000')).toBe('25,000');
 expect(numberDisplay('QuantityFrom','0.0000')).toBe('0');
 expect(numberDisplay('QuantityTo',null)).toBeNull();
 expect(numberDisplay('AnnualUnit','999.9999')).toBe('1,000');
});
test('codes are not parsed as numbers',()=>{
 expect(numberDisplay('ProductCode','001.23456')).toBe('001.23456');
 expect(numberDisplay('BaseUoM','1000')).toBe('1000');
});

test('grouping uses commas with decimal point and handles negative amounts',()=>{
 expect(numberDisplay('UnitPrice','10000000')).toBe('10,000,000.00');
 expect(numberDisplay('AnnualUnit','10000000.1234')).toBe('10,000,000.123');
 expect(numberDisplay('Cost','-1234567.895')).toBe('-1,234,567.90');
});

test('pricing values include the correct currency without changing raw values',()=>{
 const row={CurrencyCode:'VND',UnitPrice:'25000.0000',UnitUSDPrice:'1.00000000',ExchangeRateToUSD:'25000.0000000000'};
 expect(displayValue(row,'UnitPrice')).toBe('25,000.00 VND');
 expect(displayValue(row,'UnitUSDPrice')).toBe('1.00 USD');
 expect(displayValue(row,'ExchangeRateToUSD')).toBe('25,000 VND / USD');
 expect(displayValue({...row,UnitPrice:null},'UnitPrice')).toBeNull();
 expect(displayValue({...row,CurrencyCode:'USD',ExchangeRateToUSD:'1'},'ExchangeRateToUSD')).toBe('1 USD / USD');
 expect(row.UnitPrice).toBe('25000.0000');
});

test('numeric exports remain undecorated and Opportunity displays currency units',()=>{
 const row={CurrencyCode:'USD',UnitPrice:'12345.6789',UnitUSDPrice:'1.00000000',ExchangeRateToUSD:'25000.0000000000',ExchangeRateToVND:'25000.000000',ShelfPrice:'1000.5000'};
 expect(exportValue(row,'UnitPrice')).toBe('12345.6789');
 expect(exportValue(row,'ExchangeRateToUSD')).toBe('25000.0000000000');
 expect(exportValue(row,'UnitUSDPrice')).toBe('1.00000000');
 expect(opportunityDisplay(row,'ExchangeRateToVND')).toBe('25,000 VND / USD');
 expect(opportunityDisplay(row,'ShelfPrice')).toBe('1,000.50 USD');
 expect(opportunityDisplay({...row,ExchangeRateToVND:null},'ExchangeRateToVND')).toBeNull();
});
