import type {Row} from './api';
import {decimalDisplay} from './number-format';

// Labels use Length first. The stored choice value is separate from its display.
export function palletDimensionLabel(pallet:Row){
 if(pallet.PalletSizeLabel)return String(pallet.PalletSizeLabel);
 const factor=Number(pallet.FactorToMM);
 const length=Number(pallet.LengthMM??(pallet.Length!=null&&factor>0?Number(pallet.Length)*factor:NaN));
 const width=Number(pallet.WidthMM??(pallet.Width!=null&&factor>0?Number(pallet.Width)*factor:NaN));
 const stored=String(pallet.PalletSize??'').match(/^\s*([\d,.]+)\s*[x×]\s*([\d,.]+)\s*mm\s*$/i);
 if(!(length>0&&width>0)&&stored)return stored[1].replaceAll(',','')+' × '+stored[2].replaceAll(',','')+' mm';
 return Number.isFinite(length)&&length>0&&Number.isFinite(width)&&width>0
  ?(decimalDisplay(length,6)||'').replaceAll(',','')+' × '+(decimalDisplay(width,6)||'').replaceAll(',','')+' mm'
  :String(pallet.PalletSize??'');
}
