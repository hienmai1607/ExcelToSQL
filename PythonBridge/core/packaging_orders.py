"""Shared packaging-order membership and cumulative layer vocabulary."""
import json

ORDERS = ('Primary', 'Secondary', 'Tertiary')
RESPONSE_ORDER_FIELDS = (
    ('Primary', 'FirstPMType', 'FirstPMMOQ'),
    ('Secondary', 'SecondPMType', 'SecondPMMOQ'),
    ('Tertiary', 'ThirdPMType', 'ThirdPMMOQ'),
)


def decode_orders(rows):
    for row in rows:
        value = row.pop('PackagingOrdersJSON', None)
        row['PackagingOrders'] = [] if row.get('ParentTypeID') is not None else (
            json.loads(value) if value else [row['PackagingOrder']])
    return rows
