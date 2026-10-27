"""Explicit rectangular dimensions or a diameter's square shipping envelope, in mm."""
def shipping_envelope(measured):
    result={key:measured[key] for key in ('length','width','height') if key in measured}
    diameter=next((measured[key] for key in ('dia','diameter') if key in measured),None)
    if 'length' not in result and 'width' not in result and diameter is not None:
        result.update(length=diameter,width=diameter)
    return result
