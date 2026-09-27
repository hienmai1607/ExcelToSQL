// Display only: never use rounded values as save payloads.
const money=new Set(['UnitPrice','UnitUSDPrice','ShelfPrice','Cost','PMCost']);
const numeric=new Set(['QuantityFrom','QuantityTo','WeightGrams','WeightOz','WeightValue','AnnualUnit','EstPctAwarded','MixRatioPct','RatioPct','UnitQuantity','ExchangeRateVNDPerUSD','ExchangeRateCustomerCurrencyPerUSD','ExchangeRateToUSD','ExchangeRateToVND','SourceExchangeRateToVND','MaxPalletHeightM','HeightMM','WidthMM','LengthMM','ShelfLifeDays','UnitsPerCarton','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer','ItemCount','Unassigned']);
export function decimalDisplay(value:unknown,places:number,fixed=false):string|null{
 if(value===null||value===undefined||value==='')return null;
 const raw=String(value),match=/^(-?)(\d+)(?:\.(\d*))?$/.exec(raw);
 if(!match)return raw;
 const [,sign,whole,fraction='']=match;
 const scale=10n**BigInt(places);
 let amount=BigInt(whole)*scale+BigInt((fraction+'0'.repeat(places)).slice(0,places)||'0');
 if(Number(fraction[places]||0)>=5)amount++;
 const tail=(amount%scale).toString().padStart(places,'0');
 const decimal=fixed?tail:tail.replace(/0+$/,'');
 return (sign&&amount!==0n?'-':'')+(amount/scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+(decimal?'.'+decimal:'');
}
export function numberDisplay(key:string,value:unknown):string|null{
 if(money.has(key))return decimalDisplay(value,2,true);
 if(numeric.has(key))return decimalDisplay(value,3);
 return value===null||value===undefined||value===''?null:String(value);
}

export function isNumericField(key:string){return money.has(key)||numeric.has(key)}
export function opportunityDisplay(row:Record<string,unknown>,key:string):string|null{
 const value=numberDisplay(key,row[key]);
 if(value===null)return null;
 const currency=String(row.CustomerCurrencyCode??row.CurrencyCode??'').trim();
 if(key==='ExchangeRateVNDPerUSD')return value+' VND / USD';
 if(key==='ExchangeRateCustomerCurrencyPerUSD'&&currency)return value+' '+currency+' / USD';
 if(key==='ExchangeRateToVND'&&currency)return value+' VND / '+currency;
 if(key==='ShelfPrice'&&currency)return value+' '+currency;
 if(key==='PMCost')return value+' '+String(row.PMCostCurrencyCode||'VND');
 return value;
}
