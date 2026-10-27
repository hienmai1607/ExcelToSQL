"""Whole-layer pallet capacity; rated weight includes every packaging component."""
from decimal import Decimal


def pallet_capacity(footprint, height_layers, carton_kg, tare_kg, max_gross_kg,
                    cartons_per_layer=None, layers_per_pallet=None):
    """Maximize horizontal utilization first, then complete vertical layers."""
    if carton_kg is None or tare_kg is None or max_gross_kg is None:
        raise ValueError('Maintain pallet maximum gross payload and complete carton/pallet tare before calculating capacity.')
    carton, tare, maximum = map(lambda v: Decimal(str(v)), (carton_kg, tare_kg, max_gross_kg))
    if not all(v.is_finite() for v in (carton,tare,maximum)) or carton<=0 or tare<0 or maximum<=0:
        raise ValueError('Pallet capacity requires positive carton gross and maximum gross weight, and nonnegative tare.')
    limit=max(0,int((maximum-tare)//carton))
    automatic=min(int(footprint),limit)
    across=automatic if cartons_per_layer is None else int(cartons_per_layer)
    if across<1 or across>automatic:
        if cartons_per_layer is None:return dict(cartons_per_layer=0,pallet_layers=0,cartons_per_pallet=0,gross_kg=tare)
        raise ValueError('Cartons / layer exceed the pallet footprint or maximum gross payload.')
    available=min(int(height_layers),limit//across)
    layers=available if layers_per_pallet is None else int(layers_per_pallet)
    if layers<1 or layers>available:
        if layers_per_pallet is None:return dict(cartons_per_layer=across,pallet_layers=0,cartons_per_pallet=0,gross_kg=tare)
        raise ValueError('Layers / pallet exceed maximum height or maximum gross payload.')
    count=across*layers
    return dict(cartons_per_layer=across,pallet_layers=layers,cartons_per_pallet=count,gross_kg=tare+carton*count)
