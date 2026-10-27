"""Manager response edits and family approval share the response transaction."""
from fastapi import HTTPException
from db import bytes_to_b64


def complete_review_families(cur, ctx, rows, review_ids, results):
    from packaging_api import Transition
    from request_groups import perform_group
    supplied = {r.ID: r for r in rows}
    completed = set()
    for identity in review_ids:
        root = cur.execute("""SELECT root.ID,root.RequestID,root.OpportunityItemID
            FROM dbo.PackagingConfigurationRequestItem i
            JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
            JOIN dbo.PackagingConfigurationRequestItem root ON root.RequestID=i.RequestID
             AND root.OpportunityItemID=COALESCE(oi.ParentItemID,oi.ID) WHERE i.ID=?""",identity).fetchone()
        if not root:
            raise HTTPException(422,"The complete packaging family is required.")
        if root[0] in completed:
            continue
        members = cur.execute("""SELECT i.ID,i.RowVersion FROM dbo.PackagingConfigurationRequestItem i WITH(UPDLOCK,HOLDLOCK)
            JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
            WHERE i.RequestID=? AND (oi.ID=? OR oi.ParentItemID=?) ORDER BY i.ID""",root[1],root[2],root[2]).fetchall()
        if any(r[0] not in supplied for r in members):
            raise HTTPException(409,"Save and confirm the complete submitted parent/child family together.")
        notes = list(dict.fromkeys(supplied[r[0]].ReviewNote.strip() for r in members if supplied[r[0]].ReviewNote and supplied[r[0]].ReviewNote.strip()))
        note = "\n".join(notes) or None
        if note and len(note)>1000:
            raise HTTPException(422,"The combined family review note must not exceed 1000 characters.")
        versions = {r[0]:bytes_to_b64(r[1]) for r in members}
        reply = perform_group(root[0],Transition(ExpectedRowVersion=versions[root[0]],
            ExpectedGroupVersions=versions,TargetStage="Approved",Comment=note),ctx,cursor=cur)
        final = {r["ID"]:r for r in reply["results"]}
        for result in results:
            if result["NewID"] in final:
                result["NewRowVersion"] = final[result["NewID"]]["RowVersion"]
                result["Stage"] = "Approved"
        completed.add(root[0])
