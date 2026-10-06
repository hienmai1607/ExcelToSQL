"""Same-config groups must save atomically through the existing response engine."""
import json
from fastapi import HTTPException


def validate_group_batch(cursor, rows):
    by_id = {row.ID: row for row in rows}
    cursor.execute("""
        SELECT DISTINCT root.ID,root.SameConfig,root.RequestID,root.OpportunityItemID
        FROM dbo.PackagingConfigurationRequestItem i
        JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
        JOIN dbo.PackagingConfigurationRequestItem root
          ON root.RequestID=i.RequestID AND root.OpportunityItemID=COALESCE(oi.ParentItemID,oi.ID)
        WHERE i.ID IN(SELECT value FROM OPENJSON(?))
        ORDER BY root.ID""", json.dumps(list(by_id)))
    roots = list(cursor.fetchall())
    for root_id, enabled, request_id, opportunity_item in roots:
        incoming = by_id.get(root_id)
        if incoming and 'SameConfig' in incoming.model_fields_set:
            enabled = incoming.SameConfig
        if not enabled:
            continue
        cursor.execute("""
            SELECT i.ID,i.ResponseLayerCount,i.RequestedLayerCount,i.FirstPMType,
                   i.SecondPMType,i.ThirdPMType,i.UnitsPerCarton,i.UnitsPerTertiary
            FROM dbo.PackagingConfigurationRequestItem i
            JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
            WHERE i.RequestID=? AND oi.ParentItemID=?
            ORDER BY oi.MixChildNumber,i.ID""", request_id, opportunity_item)
        children = list(cursor.fetchall())
        if root_id not in by_id or any(child[0] not in by_id for child in children):
            raise HTTPException(409, 'Save the Same config Mix parent and all child responses together. Refresh the request.')
        configurations = []
        for child in children:
            row = by_id[child[0]]
            def value(field, original):
                return getattr(row, field) if field in row.model_fields_set else original
            count = value('ResponseLayerCount', child[1]) or child[2]
            configurations.append((
                count, value('FirstPMType', child[3]),
                value('SecondPMType', child[4]) if count >= 2 else None,
                value('ThirdPMType', child[5]) if count >= 3 else None,
                value('UnitsPerCarton', child[6]) if count >= 2 else None,
                value('UnitsPerTertiary', child[7]) if count >= 3 else None))
        if configurations and any(config != configurations[0] for config in configurations):
            raise HTTPException(422, 'Same config children must use the first child packaging settings. Nut Density remains independent.')
