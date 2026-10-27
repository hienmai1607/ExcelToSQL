"""Validate final child packages against the parent's immutable composition."""
import json
from decimal import Decimal,InvalidOperation
from fastapi import HTTPException


def captured_quantity(snapshot,product_id):
    try:
        data=json.loads(snapshot) if isinstance(snapshot,str) else snapshot
        matches=[r for r in data['items'] if str(r['ProductID'])==str(product_id)]
        if len(matches)!=1:return None
        return Decimal(str(matches[0].get('UnitQuantity',matches[0].get('MixUnitQuantity'))))
    except (TypeError,KeyError,ValueError,InvalidOperation):return None


def packing_error(quantity,layers,factors):
    active=list(factors)[:int(layers)-1]
    if any(v is None or v=='' for v in active):return None # Allow an incomplete draft.
    try:
        count=1
        for value in active:
            n=Decimal(str(value))
            if not n.is_finite() or n<1 or n!=n.to_integral_value():return 'Use positive whole child packing quantities.'
            count*=int(n)
        q=Decimal(str(quantity))
        if not q.is_finite() or q<1 or q!=q.to_integral_value():raise ValueError()
    except (ValueError,TypeError,InvalidOperation):return 'The parent needs a valid captured smallest-unit quantity for this child.'
    if int(q)%count:return 'Child final-package units must be an exact divisor of the parent captured quantity ('+str(q)+').'
    return None


def validate_saved_mix(cur,item_ids):
    rows=cur.execute('''WITH Focus AS(
      SELECT DISTINCT COALESCE(oi.ParentItemID,oi.ID) RootID,i.RequestID
      FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
      WHERE i.ID IN(SELECT value FROM OPENJSON(?)))
      SELECT child.ID,COALESCE(child.ResponseLayerCount,child.RequestedLayerCount),
        child.UnitsPerCarton,child.UnitsPerTertiary,child.UnitsPerQuaternary,oi.ProductID,parent.ProductMixSnapshot
      FROM dbo.PackagingConfigurationRequestItem child
      JOIN dbo.OpportunityItem oi ON oi.ID=child.OpportunityItemID
      JOIN Focus f ON f.RequestID=child.RequestID AND f.RootID=oi.ParentItemID
      LEFT JOIN dbo.PackagingConfigurationRequestItem parent ON parent.RequestID=child.RequestID AND parent.OpportunityItemID=oi.ParentItemID
      ''',json.dumps(list(item_ids))).fetchall()
    for identity,layers,primary,secondary,tertiary,product,snapshot in rows:
        issue=packing_error(captured_quantity(snapshot,product),layers,[primary,secondary,tertiary])
        if issue:raise HTTPException(422,'Mix child '+str(identity)+': '+issue)
