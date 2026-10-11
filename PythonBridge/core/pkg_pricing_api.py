"""Pricing calculator reads/previews; writes join the existing response transaction."""
import base64
import hashlib
import json
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Path
from auth import AccessContext, get_access_context
from db import get_raw_cursor
from dimension_formula import area_formula, conversion_formula, formula_variables
from packaging_efficiency import geometry_metrics
from packaging_api import require, rv
from packaging_fields import consume
from pkg_pricing import Calculation, aggregate, component_cost, rounded
from packaging_orders import decode_orders,ORDERS,RESPONSE_ORDER_FIELDS
from supplier_geometry import supplier_area

router = APIRouter(prefix="/api/packaging/items", tags=["Pkg Pricing Master"])
ItemID = Annotated[int, Path(ge=1, le=2147483647)]
log = logging.getLogger(__name__)


@contextmanager
def api_cursor():
    try:
        with get_raw_cursor() as cur:
            yield cur
    except HTTPException:
        raise
    except ValueError:
        raise
    except Exception as exc:
        message = str(exc)
        if '51102' in message:
            raise HTTPException(403, 'Packaging pricing access is required.') from exc
        if '51101' in message:
            raise HTTPException(401, 'Username is incorrect.') from exc
        if '51108' in message or '1205' in message:
            raise HTTPException(409, 'Request item changed. Refresh the calculator.') from exc
        if '51111' in message:
            raise HTTPException(422, 'Packaging request item was not found or inputs are invalid.') from exc
        log.exception('Packaging pricing read failed')
        raise HTTPException(500, 'Pricing database operation failed; contact support.') from exc


def encode(value):
    if isinstance(value, Decimal):
        return format(value, 'f')
    if isinstance(value, (bytes, bytearray)):
        return base64.b64encode(value).decode("ascii")
    return str(value)


def document(value):
    return json.dumps(value, default=encode, sort_keys=True, separators=(",", ":"))


def is_area_unit(unit):
    return unit['UoMCode'].strip().casefold() in {'m2','m²','m^2','sqm','sq m'} or (unit.get('UoMName') or '').strip().casefold() in {'square meter','square meters','square metre','square metres'}


def select(cur, sql, *params):
    cur.execute(sql, *params)
    return consume(cur)


def authorize(cur, username, item_id, write=False, version=None):
    return select(cur, "EXEC dbo.usp_PkgPricing_ItemAuthorize ?,?,?,?", username, item_id, int(write), version)[0][0]


def pricing_item_kind(cur, item_id):
    """Use the saved Opportunity mix membership, never a client flag or live Master."""
    return select(cur, '''SELECT oi.ParentItemID,CAST(CASE WHEN oi.ParentItemID IS NULL
        AND EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot ms WHERE ms.ParentItemID=oi.ID)
        THEN 1 ELSE 0 END AS BIT) IsMixParent FROM dbo.PackagingConfigurationRequestItem i
        JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID WHERE i.ID=?''', item_id)[0][0]


def catalog(cur, type_id, order, locked=False, mix_parent=False):
    # Shared serializable source locks keep snapshots stable without serializing
    # independent pricing saves behind exclusive/update locks on the masters.
    hint = " WITH(HOLDLOCK)" if locked else ""
    types = decode_orders(select(cur, f"SELECT ID,ParentTypeID,PackagingType,PackagingOrder,PackagingOrdersJSON,PriceBasis,Shipping,FinalComponent,Status,RowVersion FROM dbo.v_PackagingTypeWeb{hint}")[0])
    by_id = {t["ID"]: t for t in types}
    root = by_id.get(type_id)
    if not root or root["ParentTypeID"] is not None or root["Status"] != "Active" or not (any(o in ("Secondary","Tertiary") for o in root["PackagingOrders"]) if mix_parent else order in root["PackagingOrders"]):
        raise HTTPException(422, "Choose an active Secondary/Tertiary Type for the mix parent." if mix_parent else "Choose an active " + order + " Type.")
    paths = {}
    for t in types:
        path, seen, node = [], set(), t
        while node and node["ID"] not in seen and len(path) < 100:
            seen.add(node["ID"])
            path.append(node)
            if node["ID"] == type_id:
                if (len(path) > 1 or root.get('FinalComponent')) and t.get('FinalComponent') and all(n["Status"] == "Active" for n in path):
                    paths[t["ID"]] = path
                break
            node = by_id.get(node["ParentTypeID"])
    ids = list(paths)
    units = select(cur, f"SELECT ID,UoMCode,UoMName,Status,RowVersion FROM dbo.UoM{hint}")[0]
    dimensions = select(cur, f"""SELECT d.ID,d.PackagingTypeID,d.D1Name,d.D2Name,d.D3Name,d.D1UoMID,d.D2UoMID,d.D3UoMID,
        d.SquareMeterFormula,d.VolumeFormula,d.OccupiedM2Formula,d.OccupiedM3Formula,
        d.ConvertFromParentFormula,d.ConvertFromSupplierFormula,d.ConversionOutputUoMID,d.OccupiedFormulaNeedsReview,
        d.FormulaNeedsReview,d.RowVersion,d.ParentDimensionID,t.PackagingType,t.Shipping,t.PriceBasis AS DimensionBasis,
        u1.UoMCode AS D1Unit,u2.UoMCode AS D2Unit,u3.UoMCode AS D3Unit
        FROM dbo.PackagingDimension d{hint} JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
        JOIN dbo.UoM u1 ON u1.ID=d.D1UoMID LEFT JOIN dbo.UoM u2 ON u2.ID=d.D2UoMID LEFT JOIN dbo.UoM u3 ON u3.ID=d.D3UoMID
        WHERE d.Status='Active' AND d.PackagingTypeID IN(SELECT value FROM OPENJSON(?)) ORDER BY d.ID""", document(ids + [type_id]))[0]
    prices = select(cur, f"""SELECT m.ID AS MaterialID,m.MaterialCode,m.MaterialName,m.UnitOfMeasure,m.PackagingTypeID,m.RowVersion AS MaterialRowVersion,
        t.PackagingType,t.PriceBasis AS CalculationBasis,p.ID AS PriceID,p.RowVersion AS PriceRowVersion,p.CurrencyID,c.CurrencyCode,c.RowVersion AS CurrencyRowVersion,
        p.VendorID,v.VendorName,p.PriceBasis AS PriceUoM,p.UnitPrice,p.QuantityFrom AS VendorMOQ,p.QuantityTo,p.ExchangeRateToUSD,p.EffectiveFrom,p.EffectiveTo,
        p.SupplierDimensionID,p.SupplierDimensionRowVersion,p.SupplierD1,p.SupplierD2,p.SupplierD3,p.SupplierAreaPerPriceUnit
        FROM dbo.PackagingMaterial m{hint} JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID
        LEFT JOIN dbo.PackagingPrice p{hint} ON p.MaterialID=m.ID AND p.Status='Active'
         AND p.EffectiveFrom<=CONVERT(DATE,SYSUTCDATETIME()) AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=CONVERT(DATE,SYSUTCDATETIME()))
        LEFT JOIN dbo.Currency c{hint} ON c.ID=p.CurrencyID
        LEFT JOIN dbo.Vendor v{hint} ON v.ID=p.VendorID
        WHERE m.Status='Active' AND m.PackagingTypeID IN(SELECT value FROM OPENJSON(?))
         AND (p.ID IS NULL OR v.ID IS NULL OR v.Status='Active')
        ORDER BY t.PackagingType,m.MaterialName,p.VendorID,p.QuantityFrom,p.ID""", document(ids))[0]
    return root, paths, units, dimensions, prices


def version_matches(raw, supplied):
    return raw is not None and bytes(raw) == rv(supplied)


def parent_geometry(cur, payload, root, dimension_map, unit_map, locked=False, allow_incomplete=False, final_layer=False):
    """The only measurements accepted by the calculator belong to its root type."""
    dimension = dimension_map.get(payload.DimensionID)
    if payload.DimensionID is not None:
        if not dimension or dimension['PackagingTypeID'] != root['ID'] or dimension.get('ParentDimensionID') is not None:
            raise HTTPException(422, 'Choose an active parent dimension definition.')
        if not version_matches(dimension['RowVersion'], payload.DimensionRowVersion):
            raise HTTPException(409, 'Parent dimension definition changed. Refresh the calculator.')
        for key in ('D1', 'D2', 'D3'):
            if dimension[key+'Name'] and dimension[key+'UoMID'] not in unit_map:
                raise HTTPException(422, 'Parent dimension uses a blocked UoM.')
            if getattr(payload,key) is not None and not dimension[key+'Name']:
                raise HTTPException(422, 'Only enter measurements defined on the parent type.')
    elif payload.DimensionRowVersion or any(getattr(payload,k) is not None for k in ('D1','D2','D3')):
        raise HTTPException(422, 'Parent measurements require a dimension definition.')
    for component in payload.components:
        if any(getattr(component,k) is not None for k in ('D1','D2','D3')):
            raise HTTPException(422, 'Enter D1, D2 and D3 once on the parent, not on child components.')
    height, conversion = None, None
    if root['Shipping'] and final_layer:
        if not dimension or (dimension['D3Name'] or '').casefold() != 'height' or payload.D3 is None:
            if not allow_incomplete:
                raise HTTPException(422, 'The last confirmed packaging layer requires the parent D3 Height.')
        else:
            unit = unit_map[dimension['D3UoMID']]
            # HeightMM is physical height, not a volume-formula output.
            code = unit['UoMCode'].strip().casefold()
            factor = {'mm':Decimal(1),'cm':Decimal(10),'m':Decimal(1000)}.get(code)
            if factor is None:
                conversions = select(cur, '''SELECT TOP(1) c.ID,c.Factor,c.RowVersion FROM dbo.UnitConversion c'''+(' WITH(HOLDLOCK)' if locked else '')+'''
                    JOIN dbo.UoM u ON u.ID=c.ToUoMID
                    WHERE c.FromUoMID=? AND LOWER(u.UoMCode)='mm' AND u.Status='Active' AND c.Status='Active'
                     AND c.PackagingMaterialID IS NULL AND c.RawMaterialID IS NULL AND c.VendorID IS NULL ORDER BY c.ID''',unit['ID'])[0]
                if not conversions:
                    raise HTTPException(422, 'Maintain a general conversion from the Height unit to mm.')
                conversion=conversions[0]
                factor=Decimal(conversion['Factor'])
            with localcontext() as context:
                context.prec=50
                height=payload.D3*factor
                if height<=0 or height>=Decimal('1e10') or height!=height.quantize(Decimal('.01')):
                    raise HTTPException(422, 'Shipping Height must be positive, below 10 billion mm, and precise to 0.01 mm.')
    return dimension, height, conversion


def inherited_component(component, payload, price, paths, dimension_map, parent):
    """Child consumption uses parent measurements, never the parent's occupied formulas."""
    modern = any("ConvertFromParentFormula" in d for d in dimension_map.values())
    if modern:
        if parent is None:
            if price['CalculationBasis'] == 'Square meter' or component.DimensionID is not None:
                raise HTTPException(422, 'Choose parent dimensions before calculating child consumption.')
            return component, dimension_map
        candidates = [d for d in dimension_map.values()
            if d.get('ParentDimensionID') == parent['ID'] and d['PackagingTypeID'] == price['PackagingTypeID']]
        selected = next((d for d in candidates if d['ID'] == component.DimensionID), None)
        if component.DimensionID is not None:
            if selected is None:
                raise HTTPException(422, 'Choose a child conversion definition linked to the selected parent.')
            if not version_matches(selected['RowVersion'], component.DimensionRowVersion):
                raise HTTPException(409, 'Child conversion changed. Refresh the calculator.')
        else:
            if len(candidates) > 1:
                raise HTTPException(422, 'Choose Convert from parent definition for '+price['MaterialName']+'.')
            selected = candidates[0] if candidates else None
        if selected is None:
            if price['CalculationBasis'] == 'Square meter':
                raise HTTPException(422, 'Maintain a child Convert from parent formula for '+price['MaterialName']+'.')
            return component, dimension_map
        effective = {**selected, 'FormulaNeedsReview': selected['FormulaNeedsReview'] or parent['FormulaNeedsReview'],
            'ConsumptionDimension': parent}
        child = component.model_copy(update={'DimensionID': selected['ID'], 'DimensionRowVersion': encode(selected['RowVersion']),
            **{k: getattr(payload,k) for k in ('D1','D2','D3')}})
        return child, {**dimension_map, selected['ID']: effective}
    if price['CalculationBasis'] == 'Square meter':
        if parent is None:
            raise HTTPException(422, 'Choose a parent dimension definition for m² per packaging unit.')
        if component.DimensionID is not None and component.DimensionID != parent['ID']:
            raise HTTPException(422, 'Child supplier formulas are selected in Packaging Material Pricing. Clear the old calculator child formula.')
        if component.DimensionRowVersion and not version_matches(parent['RowVersion'], component.DimensionRowVersion):
            raise HTTPException(409, 'Parent formula changed. Refresh the calculator.')
        child = component.model_copy(update={'DimensionID': parent['ID'], 'DimensionRowVersion': encode(parent['RowVersion']),
            **{k: getattr(payload,k) for k in ('D1','D2','D3')}})
        return child, dimension_map
    if component.DimensionID is None and component.DimensionRowVersion is not None:
        raise HTTPException(422, 'Child formula RowVersion requires a formula definition.')
    if parent is None:
        if component.DimensionID is not None or price['CalculationBasis']=='Square meter':
            raise HTTPException(422, 'Choose a parent dimension definition before calculating child geometry.')
        return component, dimension_map
    ancestors=[t['ID'] for t in paths[price['PackagingTypeID']]]
    candidates=[d for d in dimension_map.values() if d.get('ParentDimensionID')==parent['ID'] and d['PackagingTypeID'] in ancestors]
    selected=dimension_map.get(component.DimensionID) if component.DimensionID is not None else None
    if selected is not None:
        if selected['ID']!=parent['ID'] and selected not in candidates:
            raise HTTPException(422, 'Child formula must inherit the selected parent definition.')
        if not version_matches(selected['RowVersion'],component.DimensionRowVersion):
            raise HTTPException(409,'Child formula changed. Refresh the calculator.')
    elif component.DimensionID is not None:
        raise HTTPException(422,'Choose an active child formula.')
    else:
        # The nearest child wins; ambiguous overrides require explicit selection.
        nearest=min((ancestors.index(d['PackagingTypeID']) for d in candidates),default=None)
        choices=[d for d in candidates if ancestors.index(d['PackagingTypeID'])==nearest]
        if len(choices)>1:
            raise HTTPException(422,'Choose a child formula override for '+price['MaterialName']+'.')
        selected=choices[0] if choices else parent
    effective=dict(selected)
    for key in ('D1','D2','D3'):
        effective[key+'Name']=parent[key+'Name']
        effective[key+'UoMID']=parent[key+'UoMID']
        effective[key+'Unit']=parent[key+'Unit']
    for key in ('SquareMeterFormula','VolumeFormula'):
        effective[key]=selected.get(key) or parent.get(key)
    effective['FormulaNeedsReview']=selected['FormulaNeedsReview'] or parent['FormulaNeedsReview']
    child=component.model_copy(update={'DimensionID':selected['ID'],'DimensionRowVersion':encode(selected['RowVersion']),
        **{k:getattr(payload,k) for k in ('D1','D2','D3')}})
    return child,{**dimension_map,selected['ID']:effective}


def output_conversion_lookup(cur,source,target,price,locked=False):
    rows=select(cur,"SELECT c.*,u.RowVersion FROM dbo.fn_UnitConversion(?,?,?,NULL,?) c LEFT JOIN dbo.UnitConversion u"+(" WITH(HOLDLOCK)" if locked else "")+" ON u.ID=c.ID",source,target,price["MaterialID"],price["VendorID"])[0]
    return rows[0] if rows else None


def component_geometry(cur, component, price, paths, unit_map, dimension_map, area_unit, locked=False, allow_incomplete=False):
    # Formula output units are independent of measurement units and vendor Price UoM.
    """One source for live area/conversion details and the final pricing calculation."""
    basis = price['CalculationBasis']
    dimension, area, area_status = None, None, None
    if component.DimensionID is not None:
        dimension = dimension_map.get(component.DimensionID)
        if not dimension or dimension['PackagingTypeID'] not in {t['ID'] for t in paths[price['PackagingTypeID']]}:
            raise HTTPException(422, 'Choose an active dimension definition belonging to the material type or its ancestor.')
        if not version_matches(dimension['RowVersion'], component.DimensionRowVersion):
            raise HTTPException(409, 'Dimension definition changed. Refresh the calculator.')
        measurement_definition = dimension.get('ConsumptionDimension') or dimension
        for key in ('D1', 'D2', 'D3'):
            if measurement_definition[key+'Name'] and measurement_definition[key+'UoMID'] not in unit_map:
                raise HTTPException(422, 'Dimension uses a blocked UoM.')
            if getattr(component, key) is not None and not measurement_definition[key+'Name']:
                raise HTTPException(422, 'Only enter measurements defined in Dimension Master.')
    elif any(getattr(component, key) is not None for key in ('D1', 'D2', 'D3')) or component.DimensionRowVersion is not None:
        raise HTTPException(422, 'Measurements require a Dimension Master definition.')
    modern = dimension is not None and "ConvertFromParentFormula" in dimension
    formula = dimension.get('ConvertFromParentFormula') if modern else dimension.get('SquareMeterFormula') if dimension else None
    if basis == 'Square meter' or (modern and formula):
        try:
            if not dimension or dimension['FormulaNeedsReview'] or not formula or (basis == 'Square meter' and (not area_unit or not is_area_unit(area_unit))):
                raise HTTPException(422, 'Pricing needs a reviewed child Convert from parent formula and matching output UoM.')
            variables = formula_variables(formula, allow_constant=modern)
            missing = [measurement_definition[k+'Name'] or k for k in sorted(variables) if getattr(component, k) is None]
            if missing:
                raise ValueError('Enter a positive measurement for ' + ', '.join(missing) + '.')
            area = (conversion_formula if modern else area_formula)(formula, {k: getattr(component, k) for k in variables})
            if dimension.get("ConversionOutputUoMID") is not None:
                from formula_output_units import output_unit_factor,converted_output
                output_target=area_unit["UoMCode"] if basis=="Square meter" and area_unit else price["UnitOfMeasure"]
                output_factor,output_conversion=output_unit_factor(dimension,unit_map,output_target,lambda source,target: output_conversion_lookup(cur,source,target,price,locked))
                area=converted_output(area,output_factor)
                dimension={**dimension,"FormulaOutputConversion":output_conversion}
        except (ValueError, HTTPException) as exc:
            area=None
            if not allow_incomplete: raise
            area_status = str(exc) if isinstance(exc, ValueError) else exc.detail
    unit_codes = {u['UoMCode'].casefold(): u for u in unit_map.values()}
    target = unit_codes.get(price['UnitOfMeasure'].casefold())
    if basis == 'Square meter':
        target = area_unit if area_unit and is_area_unit(area_unit) else None
    source = unit_codes.get(price['PriceUoM'].casefold())
    conversion, factor, conversion_status = None, None, None
    try:
        if not source or not target:
            raise HTTPException(422, 'Choose active price/base UoMs and maintain their conversion.')
        factor = Decimal(1)
        if source['ID'] != target['ID'] and not (basis == 'Square meter' and is_area_unit(source) and is_area_unit(target)):
            if basis == 'Square meter' or price.get('SupplierDimensionID') is not None:
                supplier = dimension_map.get(price.get('SupplierDimensionID'))
                if not supplier or supplier['PackagingTypeID'] != price['PackagingTypeID'] or supplier.get('ParentDimensionID') is None:
                    raise HTTPException(422, price['MaterialName']+': maintain supplier dimensions for one Price UoM in Packaging Material Pricing.')
                if supplier['RowVersion'] != price.get('SupplierDimensionRowVersion'):
                    raise HTTPException(409, 'Supplier formula changed. Refresh and save Packaging Material Pricing.')
                supplier_parent = dimension_map.get(supplier['ParentDimensionID'])
                if not supplier_parent:
                    raise HTTPException(422, 'Supplier parent dimension is unavailable.')
                effective = dict(supplier)
                if "ConvertFromSupplierFormula" not in supplier:
                    effective['ParentFormulaNeedsReview'] = supplier_parent.get('FormulaNeedsReview')
                    effective['EffectiveSquareMeterFormula'] = supplier.get('SquareMeterFormula') or supplier_parent.get('SquareMeterFormula')
                for key in ('D1','D2','D3'):
                    if supplier[key+'Name'] and supplier[key+'UoMID'] not in unit_map:
                        raise HTTPException(422, 'Supplier dimensions use a blocked UoM.')
                measurements = {k: price.get('Supplier'+k) for k in ('D1','D2','D3')}
                try:
                    factor = supplier_area(effective, measurements)
                    if supplier.get("ConversionOutputUoMID") is not None:
                        from formula_output_units import output_unit_factor,converted_output
                        output_factor,output_conversion=output_unit_factor(supplier,unit_map,target["UoMCode"],lambda source,target: output_conversion_lookup(cur,source,target,price,locked))
                        factor=converted_output(factor,output_factor)
                        effective["FormulaOutputConversion"]=output_conversion
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
                if factor != price.get('SupplierAreaPerPriceUnit'):
                    raise HTTPException(409, 'Supplier conversion changed. Refresh and save Packaging Material Pricing.')
                conversion = dict(Source='Packaging Material Pricing', PriceID=price['PriceID'], Factor=factor,
                    Dimension=effective, Measurements=measurements)
                conversion_status = 'Supplier dimensions from Packaging Material Pricing (one Price UoM).'
            else:
                conversions = select(cur, 'SELECT TOP(1) ID,Factor,RowVersion FROM dbo.UnitConversion'+(' WITH(HOLDLOCK)' if locked else '')+'''
                WHERE FromUoMID=? AND ToUoMID=? AND Status='Active' AND RawMaterialID IS NULL
                 AND (PackagingMaterialID IS NULL OR PackagingMaterialID=?) AND (VendorID IS NULL OR VendorID=?)
                ORDER BY CASE WHEN VendorID IS NOT NULL THEN 0 WHEN PackagingMaterialID IS NOT NULL THEN 1 ELSE 2 END,ID''',
                source['ID'],target['ID'],price['MaterialID'],price['VendorID'])[0]
                if not conversions:
                    raise HTTPException(422, price['MaterialName']+': maintain a conversion from '+source['UoMCode']+' to '+target['UoMCode']+'.')
                conversion = conversions[0]
                factor = conversion['Factor']
    except HTTPException as exc:
        if not allow_incomplete: raise
        factor, conversion_status = None, exc.detail
    return dict(Dimension=dimension,Area=area,Factor=factor,Conversion=conversion,SourceUoM=source,TargetUoM=target,
        AreaStatus=area_status,ConversionStatus=conversion_status)


def pricing_context(cur, item_id, locked=False):
    hint = ' WITH(HOLDLOCK)' if locked else ''
    request = select(cur, f'''SELECT i.RequestID,i.OpportunityItemID,h.OpportunityID,h.RequestNumber,h.OpportunityNumber,
        i.ProductID,i.ProductCode,i.ProductName,i.ItemDescription,i.WeightGrams,i.ShelfLifeDays,
        i.SourceProductRowVersion,i.SnapshotCapturedAt,i.PrimaryTypeID,i.PrimaryTypeName,
        i.SecondaryTypeID,i.SecondaryTypeName,i.NumberOfPrimary,i.Transparency,i.SecondaryTransparency,
        i.RequestedLayerCount,COALESCE(i.ResponseLayerCount,i.RequestedLayerCount) ConfirmedLayerCount,
        i.TertiaryTypeID,i.TertiaryTypeName,i.TertiaryTransparency,i.NumberOfSecondary,(SELECT ParentItemID FROM dbo.OpportunityItem WHERE ID=i.OpportunityItemID) ParentItemID,CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot ms WHERE ms.ParentItemID=i.OpportunityItemID) THEN 1 ELSE 0 END AS BIT) IsMixParent
        FROM dbo.PackagingConfigurationRequestItem i{hint} JOIN dbo.PackagingConfigurationRequest h{hint} ON h.ID=i.RequestID
        WHERE i.ID=?''', item_id)[0][0]
    product = select(cur, 'SELECT ID,ProductCode,ProductName,WeightGrams,ShelfLifeDays,Category,IsMix,Status,RowVersion FROM dbo.Product'+hint+' WHERE ID=?', request['ProductID'])[0][0]
    grade = select(cur, "SELECT TOP(1) ID,Version,Status,RowVersion FROM dbo.ProductGradeVersion"+hint+" WHERE ProductID=? AND Status='Active' ORDER BY Version DESC", request['ProductID'])[0]
    mix = select(cur, f'''SELECT v.ID,v.Version,v.Status,v.RowVersion FROM dbo.OpportunityItem i{hint}
        JOIN dbo.OpportunityMixSnapshot s{hint} ON s.ParentItemID=COALESCE(i.ParentItemID,i.ID)
        JOIN dbo.ProductMixVersion v{hint} ON v.ID=s.MixVersionID WHERE i.ID=?''', request['OpportunityItemID'])[0]
    return dict(Request=request, Product=product, ProductGradeVersion=grade[0] if grade else None, ProductMixVersion=mix[0] if mix else None)


def geometry_details(component, values):
    factor,area=values['Factor'],values['Area']
    return dict(PriceID=component.PriceID,Factor=factor,ReverseFactor=rounded(Decimal(1)/factor,18) if factor else None,
        SourceUoMCode=values['SourceUoM']['UoMCode'] if values['SourceUoM'] else None,
        TargetUoMCode=values['TargetUoM']['UoMCode'] if values['TargetUoM'] else None,
        AreaPerMaterial=area,AreaPerProductUnit=rounded(area*component.Quantity,9,Decimal('1e31')) if area is not None else None,
        AreaStatus=values['AreaStatus'],ConversionStatus=values['ConversionStatus'])


def calculate(cur, ctx, item_id, payload, locked=False, expected_version=None):
    authorize(cur, ctx.username, item_id, locked, expected_version)
    snapshot_context=pricing_context(cur,item_id,locked)
    layers=payload.LayerCount or snapshot_context['Request']['ConfirmedLayerCount']
    if ORDERS.index(payload.PackagingOrder)+1>layers:
        raise HTTPException(422,'Calculator order exceeds the confirmed packaging layers.')
    snapshot_context['Request']['ConfirmedLayerCount']=layers
    root, paths, units, dimensions, prices = catalog(cur, payload.PackagingTypeID, payload.PackagingOrder, locked, mix_parent=bool(snapshot_context['Request'].get('IsMixParent')))
    if not snapshot_context['Request'].get('ParentItemID') and layers >= 2 and ORDERS.index(payload.PackagingOrder)+1 == layers and not root['Shipping']:
        raise HTTPException(422, 'The final packaging layer requires an eligible Shipping type.')
    price_map = {p["PriceID"]: p for p in prices if p["PriceID"] is not None}
    dimension_map = {d["ID"]: d for d in dimensions}
    unit_map = {u["ID"]: u for u in units if u["Status"] == "Active"}
    area_unit = unit_map.get(payload.SquareMeterUoMID)
    parent,height,height_conversion=parent_geometry(cur,payload,root,dimension_map,unit_map,locked,
        final_layer=not snapshot_context['Request'].get('ParentItemID') and ORDERS.index(payload.PackagingOrder)+1==layers)
    rows = []
    with localcontext() as context:
        context.prec = 50
        for component in payload.components:
            p = price_map.get(component.PriceID)
            if p is None:
                raise HTTPException(422, "Selected material/price is no longer active, effective or a child of this type.")
            if not version_matches(p["PriceRowVersion"], component.PriceRowVersion):
                raise HTTPException(409, "Material price changed. Refresh the calculator.")
            basis = p["CalculationBasis"]
            if basis not in ("Count", "Square meter"):
                raise HTTPException(422, "Volume-basis pricing is not supported by this calculator yet.")
            if basis == "Count" and component.Quantity != component.Quantity.to_integral_value():
                raise HTTPException(422, "Count-basis component quantity must be a whole number.")
            effective_component,effective_dimensions=inherited_component(component,payload,p,paths,dimension_map,parent)
            geometry = component_geometry(cur,effective_component,p,paths,unit_map,effective_dimensions,area_unit,locked)
            d, area, factor = geometry['Dimension'], geometry['Area'], geometry['Factor']
            conversion, source, target = geometry['Conversion'], geometry['SourceUoM'], geometry['TargetUoM']
            consumption, price, moq = component_cost(p["UnitPrice"], p["VendorMOQ"], component.Quantity, factor, area)
            rate = Decimal(1) if p["CurrencyCode"].strip().upper() == "USD" else p["ExchangeRateToUSD"]
            usd = rounded(price / rate) if rate is not None and rate > 0 else None
            row = dict(**p, Quantity=component.Quantity, DimensionID=effective_component.DimensionID,
                Measurements={k: getattr(payload, k) for k in ("D1", "D2", "D3")}, Dimension=d,
                Area=area, Factor=factor, Conversion=conversion, SourceUoM=source, TargetUoM=target,
                TypePath=paths[p["PackagingTypeID"]], Consumption=consumption, ProductMOQ=moq,
                ProductUnitPrice=price, ProductUnitUSDPrice=usd)
            row.update(geometry_details(component,geometry))
            rows.append(row)
        hint = ' WITH(HOLDLOCK)' if locked else ''
        currencies = select(cur, "SELECT ID FROM dbo.Currency" + hint + " WHERE CurrencyCode='USD'")[0]
        totals = aggregate(rows, currencies[0]["ID"] if currencies else None)
    result = dict(**totals, PackagingOrder=payload.PackagingOrder, PackagingTypeID=root["ID"],
        PackagingTypeName=root["PackagingType"], AsOfDate=datetime.now(timezone.utc).date(),
        InputJSON=payload.model_dump(exclude={"Fingerprint"}), TypeRowVersion=root["RowVersion"],
        TypeSnapshot=root, Context=snapshot_context, components=rows, ParentDimension=parent,
        ParentMeasurements={k:getattr(payload,k) for k in ('D1','D2','D3')},
        HeightConversion=height_conversion, ParentGeometryMetrics=geometry_metrics(parent,
            {k:getattr(payload,k) for k in ('D1','D2','D3')}),
        FinalLayerHeightMM=height if ORDERS.index(payload.PackagingOrder)+1==layers else None)
    if payload.ReferencePricingMasterID is not None:
        source = select(cur, 'SELECT ID FROM dbo.PkgPricingMaster'+(' WITH(HOLDLOCK)' if locked else '')+' WHERE ID=? AND PackagingOrder=?', payload.ReferencePricingMasterID,payload.PackagingOrder)[0]
        if not source:
            raise HTTPException(422,'Pricing reference was not found in the matching packaging order.')
    result["Fingerprint"] = hashlib.sha256(document(result).encode("utf-8")).hexdigest()
    return json.loads(document(result))


@router.get("/{item_id}/pricing")
def options(item_id: ItemID, packaging_type_id: int = Query(ge=1, le=2147483647), packaging_order: str = Query(pattern="^(Primary|Secondary|Tertiary)$"),
            ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Packaging", "PackagingManager")
    with api_cursor() as cur:
        authorize(cur, ctx.username, item_id); item_kind = pricing_item_kind(cur,item_id)
        root, paths, units, dimensions, prices = catalog(cur, packaging_type_id, packaging_order, mix_parent=item_kind['IsMixParent'])
        saved = select(cur, "SELECT TOP(20) ID,PackagingTypeID,PackagingTypeName,FinalMOQ,UnitPrice,CurrencyCode,UnitUSDPrice,InputJSON,IsCurrent,CreatedAt FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND PackagingOrder=? ORDER BY ID DESC", item_id, packaging_order)[0]
        matching=select(cur,"SELECT TOP(1) ID,CreatedAt FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND PackagingOrder=? AND PackagingTypeID=? ORDER BY IsCurrent DESC,ID DESC",item_id,packaging_order,packaging_type_id)[0]
        previous=matching[0] if matching else None
        snapshots = select(cur, "SELECT SnapshotJSON FROM dbo.PkgPricingComponent WHERE PricingMasterID=? ORDER BY LineNumber", previous['ID'])[0] if previous else []
    return json.loads(document(dict(parentType=root,isMixChild=item_kind['ParentItemID'] is not None,isMixParent=item_kind['IsMixParent'],materials=prices, dimensions=dimensions, uoms=[dict(u,IsSquareMeter=is_area_unit(u)) for u in units if u["Status"] == "Active"],
        types=[dict(t, AncestorIDs=[n["ID"] for n in path]) for path in paths.values() for t in path[:1]],
        saved=saved, componentSnapshot=previous, savedComponents=[json.loads(r["SnapshotJSON"]) for r in snapshots])))


@router.get('/{item_id}/pricing/history')
def history(item_id: ItemID, ctx: AccessContext = Depends(get_access_context)):
    require(ctx, 'Packaging', 'PackagingManager')
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        headers=select(cur,"""SELECT TOP(20) p.ID,p.PackagingOrder,p.PackagingTypeName,p.FinalMOQ,p.UnitPrice,p.CurrencyCode,p.UnitUSDPrice,p.AsOfDate,p.IsCurrent,p.CreatedAt,u.UserName AS CreatedByName,
            p.OpportunityItemID,p.OpportunityID,p.ProductID,p.ProductGradeVersionID,p.ProductMixVersionID,p.SourcePricingMasterID,p.ContextSnapshotJSON
            FROM dbo.PkgPricingMaster p JOIN dbo.Users u ON u.ID=p.CreatedBy WHERE p.RequestItemID=? ORDER BY p.ID DESC""",item_id)[0]
        components=select(cur,'SELECT PricingMasterID,SnapshotJSON FROM dbo.PkgPricingComponent WHERE PricingMasterID IN(SELECT value FROM OPENJSON(?)) ORDER BY PricingMasterID,LineNumber',document([h['ID'] for h in headers]))[0]
    return json.loads(document({'snapshots':[dict(header=h,components=[json.loads(c['SnapshotJSON']) for c in components if c['PricingMasterID']==h['ID']]) for h in headers]}))


@router.get('/{item_id}/pricing/references')
def references(item_id: ItemID, packaging_type_id: int = Query(ge=1,le=2147483647), packaging_order: str = Query(pattern='^(Primary|Secondary|Tertiary)$'), ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging','PackagingManager')
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        catalog(cur,packaging_type_id,packaging_order,mix_parent=pricing_item_kind(cur,item_id)['IsMixParent'])
        rows=select(cur,'''SELECT TOP(100) p.ID,p.PackagingTypeID,p.PackagingTypeName,p.FinalMOQ,p.UnitPrice,p.CurrencyCode,
            p.CreatedAt,p.IsCurrent,i.ProductCode,i.ProductName,h.RequestNumber,h.OpportunityNumber
            FROM dbo.PkgPricingMaster p JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=p.RequestItemID
            JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
            WHERE p.PackagingOrder=? AND p.RequestItemID<>?
            ORDER BY CASE WHEN p.PackagingTypeID=? THEN 0 ELSE 1 END,p.ID DESC''',packaging_order,item_id,packaging_type_id)[0]
    return json.loads(document(dict(references=rows)))


@router.get('/{item_id}/pricing/references/{reference_id}')
def reference(item_id: ItemID, reference_id: ItemID, packaging_type_id: int = Query(ge=1,le=2147483647), packaging_order: str = Query(pattern='^(Primary|Secondary|Tertiary)$'), ctx: AccessContext = Depends(get_access_context)):
    require(ctx,'Packaging','PackagingManager')
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        _,paths,units,dimensions,prices=catalog(cur,packaging_type_id,packaging_order,mix_parent=pricing_item_kind(cur,item_id)['IsMixParent'])
        header=select(cur,'SELECT ID,InputJSON,PackagingTypeName,CreatedAt FROM dbo.PkgPricingMaster WHERE ID=? AND PackagingOrder=?',reference_id,packaging_order)[0]
        if not header:
            raise HTTPException(404,'Pricing reference not found in this packaging order.')
        snapshots=select(cur,'SELECT SnapshotJSON FROM dbo.PkgPricingComponent WHERE PricingMasterID=? ORDER BY LineNumber',reference_id)[0]
    old_input=json.loads(header[0]['InputJSON'])
    parent=next((d for d in dimensions if d['ID']==old_input.get('DimensionID') and d['PackagingTypeID']==packaging_type_id),None)
    parent_changed=bool(old_input.get('DimensionID')) and (parent is None or not version_matches(parent['RowVersion'],old_input.get('DimensionRowVersion')))
    old_lines={c['PriceID']:c for c in old_input['components']}
    lines,warnings,unavailable,previous_components=[],[],[],[]
    if parent_changed:
        warnings.append('Parent dimension definition changed; enter parent measurements again.')
    if any(c.get(k) is not None for c in old_input['components'] for k in ('D1','D2','D3')):
        warnings.append('Older setup has component measurements; enter them once at parent level. Historical snapshots are unchanged.')
    for snapshot in snapshots:
        old=json.loads(snapshot['SnapshotJSON'])
        candidates=[p for p in prices if p['PriceID'] is not None and p['MaterialID']==old['MaterialID'] and p['VendorID']==old['VendorID'] and p['CurrencyID']==old['CurrencyID'] and p['PriceUoM']==old['PriceUoM']]
        exact=next((p for p in candidates if p['PriceID']==old['PriceID']),None)
        price=exact or (candidates[0] if len(candidates)==1 else None)
        if price is None:
            unavailable.append(dict(MaterialCode=old['MaterialCode'],MaterialName=old['MaterialName'],Reason='Not available in this type, or no unambiguous current vendor price.'))
            continue
        previous=old_lines[old['PriceID']]
        previous_components.append(dict(old,CurrentPriceID=price['PriceID']))
        dimension=next((d for d in dimensions if d['ID']==previous.get('DimensionID') and d['PackagingTypeID'] in {t['ID'] for t in paths[price['PackagingTypeID']]}),None)
        changed=previous.get('DimensionID') is not None and (dimension is None or not version_matches(dimension['RowVersion'],previous.get('DimensionRowVersion')))
        if changed: warnings.append(old['MaterialCode']+': dimension definition changed; enter measurements again.')
        lines.append(dict(PriceID=price['PriceID'],PriceRowVersion=encode(price['PriceRowVersion']),Quantity=previous['Quantity'],
            DimensionID=dimension['ID'] if dimension and dimension.get('ParentDimensionID') is not None and not changed else None,
            DimensionRowVersion=encode(dimension['RowVersion']) if dimension and dimension.get('ParentDimensionID') is not None and not changed else None,
            **{k:None for k in ('D1','D2','D3')}))
    area=old_input.get('SquareMeterUoMID')
    if not any(u['ID']==area and u['Status']=='Active' and is_area_unit(u) for u in units): area=None
    return dict(input=dict(PackagingOrder=packaging_order,PackagingTypeID=packaging_type_id,SquareMeterUoMID=area,
        DimensionID=parent['ID'] if parent else None,DimensionRowVersion=encode(parent['RowVersion']) if parent else None,
        **{k:old_input.get(k) if parent and not parent_changed else None for k in ('D1','D2','D3')},
        ReferencePricingMasterID=reference_id,components=lines),warnings=warnings,unavailable=unavailable,
        previousComponents=previous_components,componentSnapshot=dict(ID=reference_id,CreatedAt=header[0]['CreatedAt']))


@router.post("/{item_id}/pricing/preview")
def preview(item_id: ItemID, payload: Calculation, ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Packaging", "PackagingManager")
    try:
        with api_cursor() as cur:
            return {"calculation": calculate(cur, ctx, item_id, payload)}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post('/{item_id}/pricing/geometry')
def geometry_preview(item_id: ItemID, payload: Calculation, ctx: AccessContext = Depends(get_access_context)):
    """Read-only, incomplete-input preview; never saves quotes or applies totals."""
    require(ctx,'Packaging','PackagingManager')
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        root,paths,units,dimensions,prices=catalog(cur,payload.PackagingTypeID,payload.PackagingOrder,mix_parent=pricing_item_kind(cur,item_id)['IsMixParent'])
        price_map={p['PriceID']:p for p in prices if p['PriceID'] is not None}
        unit_map={u['ID']:u for u in units if u['Status']=='Active'}
        dimension_map={d['ID']:d for d in dimensions}
        parent,_,_=parent_geometry(cur,payload,root,dimension_map,unit_map,allow_incomplete=True)
        rows=[]
        with localcontext() as context:
            context.prec=50
            for component in payload.components:
                price=price_map.get(component.PriceID)
                if not price or price['CalculationBasis']!='Square meter':
                    raise HTTPException(422,'Choose a current Square meter material price in a child type.')
                if not version_matches(price['PriceRowVersion'],component.PriceRowVersion):
                    raise HTTPException(409,'Material price changed. Refresh the calculator.')
                effective_component,effective_dimensions=inherited_component(component,payload,price,paths,dimension_map,parent)
                values=component_geometry(cur,effective_component,price,paths,unit_map,effective_dimensions,unit_map.get(payload.SquareMeterUoMID),allow_incomplete=True)
                rows.append(geometry_details(component,values))
    return json.loads(document(dict(components=rows)))


def save_calculations(cur, ctx, row, item_version):
    """Called after the response save while its authorization/lock still holds."""
    for payload in row.PricingCalculations or []:
        try:
            result = calculate(cur, ctx, row.ID, payload, True, item_version)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if not payload.Fingerprint or result["Fingerprint"] != payload.Fingerprint:
            raise HTTPException(409, "Pricing inputs, conversion or master data changed. Recalculate before saving.")
        _,type_field,moq_field=RESPONSE_ORDER_FIELDS[ORDERS.index(payload.PackagingOrder)]
        if getattr(row, type_field) != result["PackagingTypeName"] or getattr(row, moq_field) != Decimal(result["FinalMOQ"]):
            raise HTTPException(422, "Response type and MOQ must match the applied pricing calculation.")
        select(cur, "EXEC dbo.usp_PkgPricing_Save ?,?,?,?", ctx.username, row.ID, item_version, document(result))
    # Mark older snapshots superseded if a response type or MOQ was changed manually.
    cur.execute("""UPDATE p SET IsCurrent=0 FROM dbo.PkgPricingMaster p JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=p.RequestItemID
        WHERE p.RequestItemID=? AND p.IsCurrent=1 AND
         (p.PackagingTypeName<>COALESCE(CASE p.PackagingOrder WHEN 'Primary' THEN i.FirstPMType WHEN 'Secondary' THEN i.SecondPMType ELSE i.ThirdPMType END,'')
          OR p.FinalMOQ<>COALESCE(CASE p.PackagingOrder WHEN 'Primary' THEN i.FirstPMMOQ WHEN 'Secondary' THEN i.SecondPMMOQ ELSE i.ThirdPMMOQ END,-1)
          OR CASE p.PackagingOrder WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END>COALESCE(i.ResponseLayerCount,i.RequestedLayerCount))""", row.ID)
