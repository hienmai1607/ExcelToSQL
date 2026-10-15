"""Deterministic, bounded rectangular loading plans in millimetres.

Mixed orientation strips in both axes; a feasible plan, not a proof of optimality.
Returned coordinates are the sole source of counts and 3D placement.
"""
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Dimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    length: Decimal = Field(gt=0, le=20000, max_digits=9, decimal_places=3)
    width: Decimal = Field(gt=0, le=20000, max_digits=9, decimal_places=3)
    height: Decimal = Field(gt=0, le=20000, max_digits=9, decimal_places=3)

class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["pallet", "floor"] = "pallet"
    weight_source: Literal["manual", "response"] = "manual"
    carton: Dimensions
    carton_kg: Decimal | None = Field(None, gt=0, le=100000, allow_inf_nan=False)
    pallet: Dimensions | None = None
    pallet_kg: Decimal | None = Field(None, ge=0, le=100000, allow_inf_nan=False)
    max_pallet_height: Decimal | None = Field(None, gt=0, le=20000, decimal_places=3)
    pallet_payload_kg: Decimal | None = Field(None, gt=0, le=100000, allow_inf_nan=False)
    cartons_per_layer: int | None = Field(None, gt=0, le=20000)
    container: Dimensions
    payload_kg: Decimal | None = Field(None, gt=0, le=1000000, allow_inf_nan=False)
    door_width: Decimal | None = Field(None, gt=0, le=20000, decimal_places=3)
    door_height: Decimal | None = Field(None, gt=0, le=20000, decimal_places=3)
    clearance_length: Decimal = Field(Decimal(0), ge=0, le=20000, decimal_places=3)
    clearance_width: Decimal = Field(Decimal(0), ge=0, le=20000, decimal_places=3)
    clearance_height: Decimal = Field(Decimal(0), ge=0, le=20000, decimal_places=3)
    rotate: bool = True
    double_stack: bool = False
    stackable: bool = False

    @model_validator(mode="after")
    def valid_space(self):
        if self.mode == "pallet" and (not self.pallet or self.max_pallet_height is None):
            raise ValueError("Pallet dimensions and maximum loaded height are required.")
        if any(getattr(self.container, a) <= getattr(self, "clearance_"+a) for a in ("length","width","height")):
            raise ValueError("Clearance must leave usable container space.")
        return self

def scaled(value):
    return int(Decimal(value)*1000)

def footprint(length, width, box_length, box_width, rotate=True):
    L,W,l,w = map(scaled,(length,width,box_length,box_width))
    if min(L,W,l,w) <= 0:
        raise ValueError("Dimensions must be positive.")
    if max(L//min(l,w), W//min(l,w)) > 2000:
        raise ValueError("Dimensions create too many rows; use larger load units.")
    best=[]
    for transpose in (False,True):
        x,y=(W,L) if transpose else (L,W)
        a,b=(w,l) if transpose else (l,w)
        options=[(a,b)]
        if rotate and a!=b: options.append((b,a))
        candidates=[]
        for depth,count_length in options:
            # Strips run along y; depth is their width on x.
            candidates.append((depth,count_length))
        first=candidates[0]
        second=candidates[-1]
        for n in range(x//first[0]+1):
            m=(x-n*first[0])//second[0] if len(candidates)>1 else 0
            count=n*(y//first[1])+m*(y//second[1])
            if count<=len(best): continue
            if count>20000: raise ValueError("More than 20,000 units per layer; use larger load units.")
            placed=[]; offset=0
            for number,(dx,dy) in ((n,first),(m,second)):
                for _ in range(number):
                    for j in range(y//dy):
                        px,py,pl,pw=(j*dy,offset,dy,dx) if transpose else (offset,j*dy,dx,dy)
                        placed.append(dict(x=px/1000,y=py/1000,length=pl/1000,width=pw/1000))
                    offset+=dx
            best=placed
    return best

def plan(p: PlanInput):
    warnings=[]
    usable={a:getattr(p.container,a)-getattr(p,"clearance_"+a) for a in ("length","width","height")}
    pallet_layer=[]; pallet_layers=0; cartons_per_pallet=0; tiers=1
    if p.mode=="pallet":
        pallet_layer=footprint(p.pallet.length,p.pallet.width,p.carton.length,p.carton.width,p.rotate)
        if p.cartons_per_layer is not None:
            if p.cartons_per_layer>len(pallet_layer):
                raise ValueError("Response cartons per layer exceed the geometric pallet capacity. Reduce cartons per layer or choose a larger pallet.")
            pallet_layer=pallet_layer[:p.cartons_per_layer]
        max_height=min(p.max_pallet_height,usable["height"])
        pallet_layers=max(0,int((max_height-p.pallet.height)//p.carton.height))
        cartons_per_pallet=len(pallet_layer)*pallet_layers
        if p.pallet_payload_kg is not None and p.carton_kg is not None:
            limited=min(cartons_per_pallet,int(p.pallet_payload_kg//p.carton_kg))
            if limited<cartons_per_pallet:warnings.append("Pallet maximum goods weight limits cartons per pallet.")
            cartons_per_pallet=limited
        if cartons_per_pallet and pallet_layer:
            pallet_layers=(cartons_per_pallet+len(pallet_layer)-1)//len(pallet_layer)
        loaded_height=p.pallet.height+pallet_layers*p.carton.height
        unit_length,unit_width=p.pallet.length,p.pallet.width
        unit_weight=(p.pallet_kg+p.carton_kg*cartons_per_pallet) if p.pallet_kg is not None and p.carton_kg is not None else None
        if p.double_stack:
            if not p.stackable: warnings.append("Double stacking is not applied: confirm the load is stackable.")
            elif loaded_height*2>usable["height"]: warnings.append("Double stacking is not applied: two loaded pallets exceed usable height.")
            else: tiers=2
        if not cartons_per_pallet: warnings.append("No complete carton fits on this pallet within the loaded height.")
    else:
        unit_length,unit_width=p.carton.length,p.carton.width
        loaded_height=p.carton.height;unit_weight=p.carton_kg
        tiers=int(usable["height"]//loaded_height)
    positions=footprint(usable["length"],usable["width"],unit_length,unit_width,p.rotate)
    if loaded_height>usable["height"] or (p.mode=="pallet" and not cartons_per_pallet): positions=[]
    if p.door_height is not None and loaded_height>p.door_height:
        positions=[];warnings.append("Loaded unit is higher than the door opening.")
    if p.door_width is not None and (min(unit_length,unit_width) if p.rotate else unit_width)>p.door_width:
        positions=[];warnings.append("Loaded unit is wider than the door opening in both orientations.")
    geometric=len(positions)*tiers
    count=geometric
    if p.payload_kg is not None and unit_weight is not None and unit_weight>0:
        count=min(count,int(p.payload_kg//unit_weight))
        if count<geometric:warnings.append("Maximum payload limits the loaded quantity.")
    if unit_weight is None:warnings.append("Gross load weight is not verified. Enter carton gross weight and pallet tare weight.")
    if p.payload_kg is None:warnings.append("Container maximum payload has not been maintained.")
    if p.mode=="pallet" and p.pallet_payload_kg is None:warnings.append("Pallet load rating has not been verified.")
    volume=Decimal(count)*unit_length*unit_width*loaded_height
    available=p.container.length*p.container.width*p.container.height
    return dict(algorithm="mixed-strips-v1",optimal=False,
        pallet_layer=pallet_layer,cartons_per_layer=len(pallet_layer),pallet_layers=pallet_layers,cartons_per_pallet=cartons_per_pallet,
        container_layer=positions,container_tiers=tiers,floor_positions=len(positions),
        geometric_units=geometric,loaded_units=count,
        cartons=count*cartons_per_pallet if p.mode=="pallet" else count,
        loaded_unit_height=float(loaded_height),
        gross_kg=float(count*unit_weight) if unit_weight is not None else None,
        volume_percent=float(volume/available*100),warnings=warnings)
