"""Deterministic, bounded rectangular loading plans in millimetres.

Mixed blocks and bounded search; footprint optimality is reported separately.
Returned coordinates are the sole source of counts and 3D placement.
"""
from decimal import Decimal
from typing import Literal
from rectangle_packing import layout, ALGORITHM
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
    pallet_max_gross_kg: Decimal | None = Field(None,gt=0,le=100000,allow_inf_nan=False)
    layers_per_pallet: int | None = Field(None,gt=0,le=20000)
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
    return layout(length,width,box_length,box_width,rotate).positions()

def plan(p: PlanInput):
    warnings=[]
    usable={a:getattr(p.container,a)-getattr(p,"clearance_"+a) for a in ("length","width","height")}
    pallet_layer=[]; pallet_layers=0; cartons_per_pallet=0; tiers=1
    pallet_fit=None
    if p.mode=="pallet":
        pallet_fit=layout(p.pallet.length,p.pallet.width,p.carton.length,p.carton.width,p.rotate)
        pallet_layer=pallet_fit.positions()
        if p.cartons_per_layer is not None:
            if p.cartons_per_layer>len(pallet_layer):
                if p.cartons_per_layer>pallet_fit.upper_bound:
                    raise ValueError(f"Response cartons per layer exceed the proven maximum of {pallet_fit.upper_bound} for this pallet. Reduce cartons per layer or choose a larger pallet.")
                raise ValueError(f"Response requests {p.cartons_per_layer} cartons per layer; the bounded search found {len(pallet_layer)} (upper bound {pallet_fit.upper_bound}). This request is not proven infeasible; review the arrangement.")
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
        if p.pallet_max_gross_kg is not None:
            from pallet_capacity import pallet_capacity
            capacity=pallet_capacity(len(pallet_fit.positions()),int((max_height-p.pallet.height)//p.carton.height),
                p.carton_kg,p.pallet_kg,p.pallet_max_gross_kg,p.cartons_per_layer,p.layers_per_pallet)
            pallet_layer=pallet_fit.positions()[:capacity["cartons_per_layer"]]
            pallet_layers=capacity["pallet_layers"];cartons_per_pallet=capacity["cartons_per_pallet"]
        elif p.layers_per_pallet is not None:
            raise ValueError("Manual Layers / pallet require a maintained pallet maximum gross payload.")
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
    container_fit=layout(usable["length"],usable["width"],unit_length,unit_width,p.rotate)
    positions=container_fit.positions()
    for label,fit in (("Pallet",pallet_fit),("Container floor",container_fit)):
        if fit is not None and not fit.optimal:
            warnings.append(f"{label} layout: best found {len(fit.rectangles)}, upper bound {fit.upper_bound}; maximum not proven.")
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
    return dict(algorithm=ALGORITHM,optimal=False,
        pallet_layer_capacity=len(pallet_fit.rectangles) if pallet_fit else 0,
        pallet_layer_upper_bound=pallet_fit.upper_bound if pallet_fit else 0,
        pallet_layout_optimal=pallet_fit.optimal if pallet_fit else False,
        container_layer_capacity=len(container_fit.rectangles),
        container_layer_upper_bound=container_fit.upper_bound,
        container_layout_optimal=container_fit.optimal,
        pallet_layer=pallet_layer,cartons_per_layer=len(pallet_layer),pallet_layers=pallet_layers,cartons_per_pallet=cartons_per_pallet,
        container_layer=positions,container_tiers=tiers,floor_positions=len(positions),
        geometric_units=geometric,loaded_units=count,
        cartons=count*cartons_per_pallet if p.mode=="pallet" else count,
        loaded_unit_height=float(loaded_height),
        gross_kg=float(count*unit_weight) if unit_weight is not None else None,
        volume_percent=float(volume/available*100),warnings=warnings)
