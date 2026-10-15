-- After 109. Additive, rerunnable migration; historical pallet records remain.
-- Actual pallet height is unknown in the legacy master. Leave MaterialD3 NULL
-- until a user verifies it in Packaging Pricing; do not invent height or price.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @EA INT=(SELECT ID FROM dbo.UoM WHERE UoMCode=N'EA' AND Status='Active'),
 @MM INT=(SELECT ID FROM dbo.UoM WHERE UoMCode=N'MM' AND Status='Active'),
 @USD INT=(SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'),@Type INT,@Dim INT;
 IF @EA IS NULL OR @MM IS NULL OR @USD IS NULL THROW 52996,'Maintain active EA and MM units and USD currency before migrating pallets.',1;
 IF OBJECT_ID('dbo.PalletMaterialMigration','U') IS NULL
 CREATE TABLE dbo.PalletMaterialMigration(
 LegacyPalletID INT PRIMARY KEY REFERENCES dbo.Pallet(ID),
 MaterialID INT NOT NULL UNIQUE REFERENCES dbo.PackagingMaterial(ID),
 LegacyPriceID INT NULL REFERENCES dbo.PackagingPrice(ID),
 LengthMM DECIMAL(18,6) NOT NULL,WidthMM DECIMAL(18,6) NOT NULL,
 MigratedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
 SELECT @Type=ID FROM dbo.PackagingType WHERE PackagingOrder=N'Pallet' AND PackagingType=N'Pallet';
 IF @Type IS NULL AND EXISTS(SELECT 1 FROM dbo.Pallet)
 BEGIN
  INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy,Shipping,FinalComponent,CopyDim)
   SELECT TOP(1) N'Pallet',N'Pallet',N'Count',0,'Active',CreatedBy,0,1,1 FROM dbo.Pallet ORDER BY ID;
  SET @Type=SCOPE_IDENTITY();
 END;
 SELECT @Dim=ID FROM dbo.PackagingDimension WHERE PackagingTypeID=@Type AND D1Name='Length' AND D2Name='Width' AND D3Name='Height' AND D1UoMID=@MM AND D2UoMID=@MM AND D3UoMID=@MM AND Status='Active';
 IF @Type IS NOT NULL AND @Dim IS NULL
 BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1UoMID,D2UoMID,D3UoMID,D1Name,D2Name,D3Name,Status,CreatedBy,FormulaNeedsReview,OccupiedFormulaNeedsReview)
   SELECT @Type,@MM,@MM,@MM,N'Length',N'Width',N'Height','Active',CreatedBy,0,0 FROM dbo.PackagingType WHERE ID=@Type;
  SET @Dim=SCOPE_IDENTITY();
 END;
 DECLARE @ID INT,@Length DECIMAL(18,6),@Width DECIMAL(18,6),@Price DECIMAL(19,2),@Actor INT,@Status VARCHAR(10),@Size NVARCHAR(100),@Material INT,@PriceID INT;
 DECLARE pallets CURSOR LOCAL FAST_FORWARD FOR
 SELECT p.ID,p.Length*CASE WHEN u.UoMCode=N'MM' THEN 1 ELSE c.Factor END,
 p.Width*CASE WHEN u.UoMCode=N'MM' THEN 1 ELSE c.Factor END,p.PalletPriceUSDPerEA,p.CreatedBy,p.Status,v.PalletSize
 FROM dbo.Pallet p JOIN dbo.UoM u ON u.ID=p.UoMID JOIN dbo.v_PalletMaster v ON v.ID=p.ID
 OUTER APPLY dbo.fn_UnitConversion(u.UoMCode,N'MM',NULL,NULL,NULL) c
 WHERE NOT EXISTS(SELECT 1 FROM dbo.PalletMaterialMigration m WHERE m.LegacyPalletID=p.ID);
 OPEN pallets; FETCH NEXT FROM pallets INTO @ID,@Length,@Width,@Price,@Actor,@Status,@Size;
 WHILE @@FETCH_STATUS=0
 BEGIN
  IF @Length IS NULL OR @Width IS NULL THROW 52996,'A legacy pallet is missing its unit conversion to MM. No records migrated.',1;
  INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,Description,UnitOfMeasure,Status,CreatedBy,PackagingTypeID)
   VALUES(CONCAT(N'PAL-LEGACY-',@ID),CONCAT(N'Pallet ',@Size),N'Migrated pallet: verify actual height and maintain vendor pricing before use.',N'EA',@Status,@Actor,@Type);
  SET @Material=SCOPE_IDENTITY(); SET @PriceID=NULL;
  IF @Price IS NOT NULL
  BEGIN
   INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,ExchangeRateToUSD,EffectiveFrom,Status,CreatedBy,
    MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3)
    SELECT @Material,@USD,N'EA',0,@Price,1,CONVERT(DATE,SYSUTCDATETIME()),@Status,@Actor,@Dim,RowVersion,@Length,@Width,NULL
    FROM dbo.PackagingDimension WHERE ID=@Dim;
   SET @PriceID=SCOPE_IDENTITY();
  END;
  INSERT dbo.PalletMaterialMigration(LegacyPalletID,MaterialID,LegacyPriceID,LengthMM,WidthMM)
   VALUES(@ID,@Material,@PriceID,@Length,@Width);
  FETCH NEXT FROM pallets INTO @ID,@Length,@Width,@Price,@Actor,@Status,@Size;
 END;
 CLOSE pallets; DEALLOCATE pallets;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
