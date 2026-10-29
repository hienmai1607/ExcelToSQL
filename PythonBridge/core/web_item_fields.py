"""Web-only editor columns; do not expand legacy workbook column contracts."""
from packaging_efficiency import EFFICIENCY_FIELDS
PRODUCT_FIELDS = {
    "ProductCode", "ProductName", "AnnualUnit", "WeightGrams", "ApplicableNetWeightGrams",
    "ItemStage", "NutDensity", "UsedVolumeML", "ShelfLifeDays",
}
REQUEST_FIELDS = {
    "RequestedLayerCount", "PalletSpecialComments", "PalletSize", "PalletStacking", "MaxPalletHeightMM",
    "ContainerRequest", "ConfigurationRequest", "PrimaryTypeName", "Transparency",
    "SecondaryTypeName", "NumberOfPrimary", "SecondaryTransparency", "TertiaryTypeName",
    "NumberOfSecondary", "TertiaryTransparency", "NumberOfTertiary", "QuaternaryTypeName", "QuaternaryTransparency", "ShelfLifeDays", "RecyclableRequirement",
    "RecycledContent", "MetalizedAluminum", "SpecialComments",
}
REQUEST_FIELDS |= {prefix+field for prefix in ("Secondary","Tertiary","Quaternary") for field in
    ("RecyclableRequirement","RecycledContent","MetalizedAluminum","SpecialComments")}
REQUEST_FIELDS.discard("ShelfLifeDays")
RESPONSE_FIELDS = {
    "SelectedContainerType",
    "ResponseLayerCount", "NoOfPrimaryUnit", "PrimaryNetWeightGrams",
    "NoOfSecondaryUnit", "SecondaryNetWeightGrams", "NoOfTertiaryUnit", "TertiaryNetWeightGrams",
    "FirstPMType", "FirstPMMOQ", "PrimaryPricePerUnit", "PrimaryPriceCurrencyCode",
    "SecondPMType", "SecondPMMOQ", "SecondaryPricePerUnit", "SecondaryPriceCurrencyCode",
    "ThirdPMType", "ThirdPMMOQ", "TertiaryPricePerUnit", "TertiaryPriceCurrencyCode",
    "FourthPMType", "FourthPMMOQ", "QuaternaryPricePerUnit", "QuaternaryPriceCurrencyCode", "NoOfQuaternaryUnit", "QuaternaryNetWeightGrams",
    "ResponsePalletSize", "ResponsePalletStacking", "ResponseMaxPalletHeightMM", "HeightMM",
    "CartonsPerLayer", "LayersPerPallet", "UnitsPerPallet", "NetWeightPerPalletKG",
    "PalletsPerContainer", "CalculatedCartonsPerContainer",
    "NetWeightPerContainerKG",
}
CALCULATED_FIELDS = {
    "ApplicableNetWeightGrams", "NoOfQuaternaryUnit", "QuaternaryNetWeightGrams",
    "UsedVolumeML",  # Mix parents aggregate across child responses, not the SQL density column.
    "LayersPerContainer",
    "NoOfPrimaryUnit", "NoOfSecondaryUnit", "NoOfTertiaryUnit", "PrimaryNetWeightGrams",
    "SecondaryNetWeightGrams", "TertiaryNetWeightGrams", "NetWeightPerPalletKG", "UnitsPerPallet",
    "CalculatedCartonsPerContainer", "NetWeightPerContainerKG", "NetWeightPerContainerFloorKG", "LayersPerPallet",
}
RESPONSE_FIELDS |= EFFICIENCY_FIELDS
CALCULATED_FIELDS |= EFFICIENCY_FIELDS
WEB_ITEM_FIELDS = PRODUCT_FIELDS | REQUEST_FIELDS | RESPONSE_FIELDS
