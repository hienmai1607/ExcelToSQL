"""Four cumulative layers. Stored per-item slots remain relative for compatibility."""
import json
from packaging_orders import ORDERS


def layer_start(child_counts=()):
    counts=list(child_counts)
    if not counts:return 1
    if any(type(n) is not int or not 1<=n<=3 for n in counts):
        raise ValueError('Mix children may use at most three layers; reserve at least one for the parent.')
    return max(counts)+1


def global_order(local_order,start=1):
    index=ORDERS.index(local_order)+int(start)-1
    if not 0<=index<4:raise ValueError('Child and parent packaging together cannot exceed four layers.')
    return ORDERS[index]


def validate_family(parent_count,child_counts):
    start=layer_start(child_counts)
    if type(parent_count) is not int or parent_count<1 or start+parent_count-1>4:
        raise ValueError('Reserve at least one parent layer; child and parent packaging together cannot exceed four layers.')
    return start


def request_start(cur,item_id):
    return int(cur.execute('SELECT dbo.fn_RequestPackagingLayerStart(?)',item_id).fetchval() or 1)


def validate_saved_families(cur,item_ids,requests=True):
    """Validate the whole affected family, including unchanged parent selections."""
    from fastapi import HTTPException
    data=json.dumps(list(item_ids))
    if requests:
        sql='''WITH Focus AS(
          SELECT DISTINCT COALESCE(oi.ParentItemID,oi.ID) RootID,i.RequestID
          FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
          WHERE i.ID IN(SELECT value FROM OPENJSON(?)))
          SELECT DISTINCT i.ID,COALESCE(i.ResponseLayerCount,i.RequestedLayerCount),
          dbo.fn_RequestPackagingLayerStart(i.ID),i.FirstPMType,i.SecondPMType,i.ThirdPMType,i.FourthPMType,oi.ParentItemID
          FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
          JOIN Focus f ON f.RequestID=i.RequestID AND f.RootID=COALESCE(oi.ParentItemID,oi.ID)'''
    else:
        sql='''WITH Focus AS(SELECT DISTINCT COALESCE(ParentItemID,ID) RootID FROM dbo.OpportunityItem
          WHERE ID IN(SELECT value FROM OPENJSON(?)))
          SELECT i.ID,i.PackagingLayerCount,dbo.fn_OpportunityPackagingLayerStart(i.ID),
          i.PrimaryTypeID,i.SecondaryTypeID,i.TertiaryTypeID,i.QuaternaryTypeID,i.ParentItemID FROM dbo.OpportunityItem i
          JOIN Focus f ON f.RootID=COALESCE(i.ParentItemID,i.ID)'''
    if requests:
        from mix_packing import validate_saved_mix
        validate_saved_mix(cur,item_ids)
    rows=cur.execute(sql,data).fetchall()
    for row in rows:
        identity,count,start,*_=row
        if count<1 or start+count-1>4 or row[7] is not None and count>3:
            raise HTTPException(422,'Child and parent packaging together cannot exceed four layers; reserve at least one parent layer.')
        for index,selected in enumerate(row[3:3+count]):
            if selected is None or selected=='':continue
            order=global_order(ORDERS[index],start)
            column='PackagingType' if requests else 'ID'
            valid=cur.execute('SELECT TOP(1) p.ID FROM dbo.PackagingType p JOIN dbo.PackagingTypeOrder o ON o.PackagingTypeID=p.ID WHERE p.'+column+'=? AND p.ParentTypeID IS NULL AND o.PackagingOrder=?',selected,order).fetchone()
            if not valid:raise HTTPException(422,'Packaging selection for item '+str(identity)+' must support cumulative '+order+'. Reselect its type after changing child layers.')
