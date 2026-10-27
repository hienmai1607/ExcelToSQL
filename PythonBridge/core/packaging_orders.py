"""Shared packaging-order membership and cumulative layer vocabulary."""
import json

ORDERS = ('Primary', 'Secondary', 'Tertiary', 'Quaternary')
TYPE_FLAGS = {'Primary':'Primary','Secondary':'Secondary','Tertiary':'Tertiary','Quaternary':'Quaternary','Palletization':'Pallet'}
TYPE_ORDERS = tuple(TYPE_FLAGS.values())
RESPONSE_ORDER_FIELDS = (
    ('Primary', 'FirstPMType', 'FirstPMMOQ'),
    ('Secondary', 'SecondPMType', 'SecondPMMOQ'),
    ('Tertiary', 'ThirdPMType', 'ThirdPMMOQ'),
    ('Quaternary', 'FourthPMType', 'FourthPMMOQ'),
)


def decode_orders(rows):
    for row in rows:
        parents = row.pop('ParentTypeIDsJSON', None)
        row['ParentTypeIDs'] = json.loads(parents) if parents else ([row['ParentTypeID']] if row.get('ParentTypeID') is not None else [])
        value = row.pop('PackagingOrdersJSON', None)
        row['PackagingOrders'] = [] if row.get('ParentTypeID') is not None else (
            json.loads(value) if value else [row['PackagingOrder']])
        for key, order in TYPE_FLAGS.items():
            row[key] = order in row['PackagingOrders']
    return rows
