"""Unified container count inputs; legacy storage is retained for old snapshots."""
import json
from fastapi import HTTPException
from container_loading import loading_profiles

def prepare_loading_fields(cursor,row,fields):
 cursor.execute("""SELECT i.ConfigurationRequest,oi.ParentItemID,i.SelectedContainerType,
 i.ContainerLoadProfiles,i.CartonsPerContainer,i.CartonsPerContainerFloor,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=i.OpportunityItemID) THEN 1 ELSE 0 END
 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
 WHERE i.ID=?""",row.ID)
 original=cursor.fetchone()
 if original is None:return fields
 mode,child,selected,stored,manual,legacy,mix_parent=original
 if mix_parent and "ApplicableNetWeightGrams" in fields:
  raise HTTPException(422,"Mix parent Applicable Net weight is calculated from its children.")
 fields=dict(fields)
 profiles=loading_profiles(fields.get("ContainerLoadProfiles"))
 if child is not None:return fields
 selected=fields.get("SelectedContainerType",selected)
 manual_mode=mode in ("Floor load","Both")
 for kind,profile in profiles.items():
  if "CartonsPerContainer" in profile:
   value=profile.pop("CartonsPerContainer")
   if value is not None and not manual_mode:
    raise HTTPException(422,"Carton / Container is calculated for Pallet loading.")
   profile["CartonsPerContainerFloor"]=value
 if manual_mode:
  profile=profiles.get(selected,{})
  previous=loading_profiles(stored).get(selected,{})
  current=fields.get("CartonsPerContainer",profile.get("CartonsPerContainerFloor",previous.get("CartonsPerContainerFloor",legacy or manual)))
  if current is None or int(current)<=0:
   raise HTTPException(422,"Carton / Container is required for Floor load and Both.")
  if "CartonsPerContainer" in fields and profile.get("CartonsPerContainerFloor") is not None and int(profile["CartonsPerContainerFloor"])!=int(current):
   raise HTTPException(422,"Carton / Container must match the selected container profile.")
  fields["CartonsPerContainer"]=current
  fields["CartonsPerContainerFloor"]=current
  if selected:
   profiles.setdefault(selected,{})["CartonsPerContainerFloor"]=current
 elif "CartonsPerContainer" in fields and fields["CartonsPerContainer"] is not None:
  raise HTTPException(422,"Carton / Container is calculated for Pallet loading.")
 if profiles:fields["ContainerLoadProfiles"]=profiles
 return fields
