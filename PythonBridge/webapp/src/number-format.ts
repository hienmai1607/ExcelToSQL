// Display only: never use rounded values as save payloads.
import {palletCapacityKeys} from './pallet-capacities';
const money=new Set(['BaseUnitPrice','BaseUnitUSDPrice','UnitPrice','UnitUSDPrice','ShelfPrice','Cost','PMCost']);
const efficiencyNumbers=new Set(['PalletHeightMM','CartonEfficiencyKGM3','RelativeCartonEfficiencyPct','PalletUtilizationPct','PalletHeightEfficiencyPct']);
const numeric=new Set(['Factor','ConversionFactor','QuantityFrom','QuantityTo','WeightGrams','ApplicableNetWeightGrams','WeightOz','WeightValue','AnnualUnit','EstPctAwarded','MixRatioPct','RatioPct','UnitQuantity','ExchangeRateVNDPerUSD','ExchangeRateCustomerCurrencyPerUSD','ExchangeRateToUSD','ExchangeRateToVND','SourceExchangeRateToVND','MaxPalletHeightM','MaxPalletHeightMM','HeightMM','WidthMM','LengthMM','ShelfLifeDays','UnitsPerTertiary','UnitsPerCarton','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','UnitsPerPallet','ResponseMaxPalletHeightMM','CartonsPerContainer','LayersPerContainer','PalletsPerContainer','CartonsPerContainerFloor','ItemCount','Unassigned']);
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
 if(['SupplierD1','SupplierD2','SupplierD3','MaterialD1','MaterialD2','MaterialD3'].includes(key))return decimalDisplay(value,6);
 if(key==='SupplierAreaPerPriceUnit')return decimalDisplay(value,9);
 if(palletCapacityKeys.includes(key))return decimalDisplay(value,0);
 if(['RelativeCartonEfficiencyPct','PalletUtilizationPct','PalletHeightEfficiencyPct'].includes(key))return decimalDisplay(value,2,true);
 if(efficiencyNumbers.has(key))return decimalDisplay(value,6);
 if(['PrimaryPricePerUnit','SecondaryPricePerUnit','TertiaryPricePerUnit'].includes(key))return decimalDisplay(value,9);
 if(['RequestedLayerCount','ResponseLayerCount','NumberOfPrimary','NumberOfSecondary','NoOfPrimaryUnit','NoOfSecondaryUnit','NoOfTertiaryUnit','ThirdPMMOQ','CalculatedCartonsPerContainer'].includes(key))return decimalDisplay(value,0);
 if(['PrimaryNetWeightGrams','SecondaryNetWeightGrams','TertiaryNetWeightGrams','NetWeightPerPalletKG','NetWeightPerContainerKG','NetWeightPerContainerFloorKG'].includes(key))return decimalDisplay(value,3);
 if(key==='NutDensity'||key==='UsedVolumeML')return decimalDisplay(value,6);
 if(key==='TareWeight')return decimalDisplay(value,9);
 if(key==='Width'||key==='Length')return decimalDisplay(value,4);
 if(key==='PalletAreaMM2')return decimalDisplay(value,8);
 if(key==='AnnualUnit'||key==='MixUnitQuantity')return decimalDisplay(value,4);
 if(key==='Factor'||key==='ConversionFactor')return decimalDisplay(value,9);
 if(money.has(key))return decimalDisplay(value,2,true);
 if(numeric.has(key))return decimalDisplay(value,3);
 return value===null||value===undefined||value===''?null:String(value);
}

export function isNumericField(key:string){return ['SupplierDimensionID','SupplierD1','SupplierD2','SupplierD3','SupplierAreaPerPriceUnit'].includes(key)||palletCapacityKeys.includes(key)||efficiencyNumbers.has(key)||['NutDensity','UsedVolumeML','TareWeight','Width','Length','PalletAreaMM2','PrimaryPricePerUnit','SecondaryPricePerUnit','TertiaryPricePerUnit','RequestedLayerCount','ResponseLayerCount','NumberOfPrimary','NumberOfSecondary','NoOfPrimaryUnit','NoOfSecondaryUnit','NoOfTertiaryUnit','ThirdPMMOQ','CalculatedCartonsPerContainer','PrimaryNetWeightGrams','SecondaryNetWeightGrams','TertiaryNetWeightGrams','NetWeightPerPalletKG','NetWeightPerContainerKG','NetWeightPerContainerFloorKG'].includes(key)||money.has(key)||numeric.has(key)}
export function opportunityDisplay(row:Record<string,unknown>,key:string):string|null{
 if(key.startsWith('TCB')&&key.endsWith('PerUnit')){const amount=decimalDisplay(row[key],6);return amount?amount+' '+(key.includes('Customer')?String(row.CustomerCurrencyCode??''):'USD'):null;}
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
