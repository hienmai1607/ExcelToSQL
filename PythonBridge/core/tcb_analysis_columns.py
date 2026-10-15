"""Read-only saved TCB Analysis values shared by Opportunity grid and workbook."""
import json
from decimal import Decimal, localcontext
from fractions import Fraction as F
from container_loading import container_types, loading_profiles

TCB_GROUPS = [
 [
  "FOB Costing",
  {
   "TCBProductPerUnit": "Product ($/unit)",
   "TCBSelfPackagingPerUnit": "Self Packaging ($/unit)",
   "TCBParentPackagingPerUnit": "Parent Packaging ($/unit)",
   "TCBPalletPerUnit": "Pallet & Floor cost ($/unit)",
   "TCBPackingPerUnit": "Packing ($/unit)",
   "TCBInitialDesignPerUnit": "Initial Design ($/unit)",
   "TCBFixedCostsPerUnit": "Fixed costs ($/unit)",
   "TCBFobbingPerUnit": "Fobbing fee ($/unit)",
   "TCBInterestPerUnit": "Interest ($/unit)",
   "TCBMarginPerUnit": "Margin ($/unit)",
   "TCBFOBPerUnit": "FOB ($/unit)",
   "TCBFOBCustomerPerUnit": "FOB (customer currency/unit)"
  }
 ],
 [
  "Destination Logistics",
  {
   "TCBFreightPerUnit": "Freight ($/unit)",
   "TCBDutyPerUnit": "Duty ($/unit)",
   "TCBClearancePerUnit": "Dest. Clearance ($/unit)",
   "TCBHaulagePerUnit": "Dest. Haulage (Port-WH) ($/unit)",
   "TCBDestinationWHPerUnit": "WH Cost (dest.) ($/unit)",
   "TCBDamagePerUnit": "Overage, Shortage & Damage ($/unit)"
  }
 ],
 [
  "Co-Man & Fees",
  {
   "TCBWHToCoManPerUnit": "WH - Co-Man WH ($/unit)",
   "TCBCoManOverheadPerUnit": "Co-Man Overhead ($/unit)",
   "TCBFreightToCustomerPerUnit": "Freight to Customer ($/unit)",
   "TCBSpoilagePerUnit": "Spoilage Allowance ($/unit)",
   "TCBPaymentTermPerUnit": "Payment Term ($/unit)",
   "TCBCoManFeePerUnit": "Co-Man fee ($/unit)",
   "TCBBrokerFeePerUnit": "Broker Fee ($/unit)"
  }
 ],
 [
  "Selling Totals",
  {
   "TCBCFRPerUnit": "CFR ($/unit)",
   "TCBDDPPerUnit": "DDP ($/unit)",
   "TCBDDPCustomerPerUnit": "DDP (customer currency/unit)"
  }
 ]
]
TCB_LABELS = {key:label for _,fields in TCB_GROUPS for key,label in fields.items()}
TCB_COLUMNS = set(TCB_LABELS)

def obj(value):
    if isinstance(value, dict): return value
    try:
        result = json.loads(value or "{}") if isinstance(value, str) else {}
        return result if isinstance(result,dict) else {}
    except (ValueError, TypeError): return {}

def num(value, zero=False):
    try:
        result = F(str(value))
        return result if result >= 0 and (zero or result > 0) else None
    except (ValueError, TypeError, ZeroDivisionError): return None

def plus(values):
    return sum(values, F(0)) if all(v is not None for v in values) else None

def times(value, factor):
    return value * factor if value is not None and factor is not None else None

def per(value, count):
    if value == 0: return value
    return value / count if value is not None and count is not None and count > 0 else None

def optional(row, key):
    value = row.get(key)
    return F(0) if value in (None, "") else num(value, True)

def ratio(row, key):
    value = optional(row, key)
    return value / 100 if value is not None and value <= 100 else None

def saved(row):
    return obj(row.get("_TCBCostInfo"))

def final_units(row):
    count = row.get("ResponseLayerCount")
    if count not in (1,2,3): return None
    result = F(1)
    for key in ("UnitsPerCarton","UnitsPerTertiary")[:count-1]:
        n = num(row.get(key))
        if n is None or n.denominator != 1: return None
        result *= n
    return result

def loss(inputs, field):
    processes = inputs.get("LossProcesses")
    if not isinstance(processes,list): return ratio(inputs, field)
    mapping = {"Sorting":"LossProductPct","Processing":"LossProductPct"}
    mapping.update({prefix+layer+"Packaging":prefix+layer+"LossPct"
                    for prefix in ("","Mix") for layer in ("Primary","Secondary","Tertiary")})
    result = F(1)
    for step in processes:
        if not isinstance(step,dict): return None
        if mapping.get(step.get("ProcessType")) != field: continue
        pct = ratio(step,"LossPct")
        if pct is None: return None
        result *= 1-pct
    return 1-result

def packaging(row, owner):
    count = row.get("ResponseLayerCount")
    if count not in (1,2,3): return None
    inputs = obj(saved(row).get("Inputs"))
    total, units = F(0), F(1)
    for i,layer in enumerate(("Primary","Secondary","Tertiary")[:count]):
        if i:
            n = num(row.get("UnitsPerCarton" if i == 1 else "UnitsPerTertiary"))
            if n is None or n.denominator != 1: return None
            units *= n
        price = num(row.get(layer+"PricePerUnit"),True)
        currency = row.get(layer+"PriceCurrencyCode")
        if not currency: return None
        if currency == "USD": pass
        elif currency == "VND":
            rate = num(owner.get("ExchangeRateVNDPerUSD"))
            price = price / rate if price is not None and rate is not None else None
        elif currency == owner.get("CustomerCurrencyCode"):
            rate = num(owner.get("ExchangeRateCustomerCurrencyPerUSD"))
            price = price / rate if price is not None and rate is not None else None
        else: price = num(row.get(layer+"PriceUSDPerUnit"),True)
        lost = loss(inputs,("Mix" if row.get("IsMixParent") else "")+layer+"LossPct")
        if price is None or lost is None or lost >= 1: return None
        total += price / (1-lost) / units
    return total

def composition(root, children):
    capture = obj(root.get("ProductMixSnapshot")).get("items")
    quantities = []
    for child in children:
        if isinstance(capture,list):
            matches = [r for r in capture if r.get("ProductID") == child.get("ProductID")]
            if len(matches) != 1: return None
            quantities.append(num(matches[0].get("UnitQuantity",matches[0].get("MixUnitQuantity"))))
        else: quantities.append(num(child.get("MixUnitQuantity")))
    if not children or any(q is None for q in quantities): return None
    if isinstance(capture,list) and (len(capture) != len(children) or len({c.get("ProductID") for c in children}) != len(children)): return None
    return sum(quantities,F(0))

def display(value):
    if value is None: return None
    with localcontext() as ctx:
        ctx.prec = 60
        return format(Decimal(value.numerator)/Decimal(value.denominator),".12f").rstrip("0").rstrip(".") or "0"

def add_tcb_columns(rows):
    """Only use saved item costs and permission-filtered response fields; no pricing-master reads."""
    for row in rows: row.update({key:None for key in TCB_COLUMNS})
    for root in [r for r in rows if not r.get("ParentItemID")]:
        children = [r for r in rows if r.get("ParentItemID") == root.get("ItemID")]
        products = [r for r in children if not r.get("IsMixParent")] if root.get("IsMixParent") else [root]
        if not products: continue
        total = composition(root,children) if root.get("IsMixParent") else F(1)
        shipping = {**root,**obj(root.get("ShipmentCostInfo"))}
        inputs = obj(saved(root).get("Inputs"))
        profiles = loading_profiles(root.get("ContainerLoadProfiles"))
        types = container_types(root.get("ResponseContainerFamily",root.get("ContainerRequest")),root.get("ShipmentContainerSizeFT",shipping.get("ContainerSizeFT")))
        configured = [t for t in types if t in profiles or root.get("SelectedContainerType") == t]
        selected = root.get("SelectedContainerType")
        from response_load_plan import read_plan
        planned=read_plan(root)
        kind = (planned.get("Code") or "Load plan") if planned else selected if selected in configured else configured[0] if len(configured)==1 else ""
        mode = root.get("PackingConfiguration") or root.get("ConfigurationRequest")
        resolved = mode in ("Pallet load","Floor load","Both")
        profile = profiles.get(kind,{})
        result = obj(obj(root.get("ContainerLoadResults")).get(kind))
        cartons = result.get("CalculatedCartonsPerContainer",root.get("CalculatedCartonsPerContainer") if selected==kind else None)
        container_units = times(times(num(cartons),final_units(root)),total)
        pallet_units = times(num(root.get("UnitsPerPallet")),total)
        awarded = times(times(num(root.get("AnnualUnit")),ratio(root,"EstPctAwarded")),total)
        parent_pm = per(packaging(root,root),total) if root.get("IsMixParent") else F(0)
        def container(key): return per(optional(shipping,key),container_units) if resolved else None
        def pallet(key): return per(optional(shipping,key),pallet_units) if resolved else None
        pallet_price=root.get("DefaultPalletUSDPerEA") if "DefaultPalletUSDPerEA" in root else obj(root.get("PalletPricingJSON")).get("UnitUSDPrice") if "PalletPricingJSON" in root else inputs.get("PalletUSDPerEA")
        pallet_cost = None if not resolved else F(0) if mode=="Floor load" else per(num(pallet_price,True),pallet_units)
        currency = str(root.get("CustomerCurrencyCode") or "").upper()
        rate = F(1) if currency=="USD" else num(root.get("ExchangeRateVNDPerUSD" if currency=="VND" else "ExchangeRateCustomerCurrencyPerUSD")) if currency else None
        for row in products:
            value = saved(row);own = obj(value.get("Inputs"));weight = num(row.get("WeightGrams"))
            lost = ratio(own,"LossProductPct") if own.get("ProductLossFormula") else loss(own,"LossProductPct")
            product = times(times(num(value.get("ProductUSDPerLb"),True),per(weight,F("453.59237"))),1-lost if lost is not None else None)
            applicable_weight = num(row.get("ApplicableNetWeightGrams") if "ApplicableNetWeightGrams" in row else row.get("WeightGrams"))
            floor_cost = times(optional(shipping,"FloorLoadUSDPerMT"),per(applicable_weight,F(1000000))) if mode in ("Floor load","Both") else F(0)
            loading_cost = plus([pallet_cost,floor_cost])
            cells = [product,packaging(row,root),parent_pm,loading_cost,times(optional(shipping,"PackingUSDPerLb"),per(weight,F("453.59237"))),
                     per(optional(shipping,"InitialDesignUSD"),awarded),per(optional(shipping,"OtherFixedCostsUSD"),awarded),container("FobbingUSDPerContainer")]
            cells.append(times(plus(cells),times(ratio(shipping,"InterestPct"),per(optional(shipping,"InterestDays"),F(360)) if shipping.get("InterestDays") is not None else per(optional(shipping,"InterestMonths"),F(12)))))
            cells.append(times(optional(shipping,"MarginUSDPerLb"),per(weight,F("453.59237"))) if shipping.get("MarginMode") == "USDPerLb" or shipping.get("MarginMode") is None and shipping.get("MarginUSDPerLb") is not None else times(plus(cells),ratio(shipping,"MarginPct")))
            cells.append(plus(cells));cells.append(times(cells[10],rate))
            freight = container("FreightUSDPerContainer")
            destination = [freight,times(plus([cells[10],freight]),ratio(shipping,"DutyPct")),per(per(optional(shipping,"ImportClearanceCustomerPerPallet"),rate),pallet_units) if resolved and shipping.get("ImportClearanceCustomerPerPallet") is not None else container("ImportClearanceUSDPerContainer"),
                           container("PortToWHUSDPerContainer"),pallet("WHCostUSDPerPallet")]
            destination.append(times(plus([cells[10],*destination]),ratio(shipping,"OverageShortageDamagePct")))
            destination.extend([pallet("WHToCoManWHUSDPerPallet"),pallet("CoManOverheadUSDPerPallet"),pallet("FreightToCustomerUSDPerPallet")])
            base = plus([cells[10],*destination])
            fees = [ratio(shipping,k) for k in ("SpoilageAllowancePct","PaymentTermPct","CoManFeePct","BrokerFeePct")]
            combined = plus(fees)
            gross = per(base,1-combined) if combined is not None and combined < 1 else None
            allowances = [times(gross,f) for f in fees]
            ddp = plus([base,*allowances])
            cells.extend([*destination,*allowances,plus([cells[10],freight]),ddp,times(ddp,rate)])
            row.update({key:display(value) for key,value in zip(TCB_LABELS,cells)})
    for row in rows: row.pop("_TCBCostInfo",None)
    return rows
