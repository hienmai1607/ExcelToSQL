USE [test];
GO
-- After 79. Split shipping space from material consumption; never delete request history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingPrice','SupplierDimensionID') IS NULL
 THROW 52980,'Apply migration 79 first.',1;
IF COL_LENGTH('dbo.PackagingDimension','OccupiedM2Formula') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD
  OccupiedM2Formula NVARCHAR(200) NULL, OccupiedM3Formula NVARCHAR(200) NULL,
  ConvertFromParentFormula NVARCHAR(200) NULL, ConvertFromSupplierFormula NVARCHAR(200) NULL,
  OccupiedFormulaNeedsReview BIT NOT NULL CONSTRAINT DF_PackagingDimension_OccupiedReview DEFAULT(0);
IF OBJECT_ID('dbo.PackagingFormulaRoleMigrationLog') IS NULL
 CREATE TABLE dbo.PackagingFormulaRoleMigrationLog(
  DimensionID INT PRIMARY KEY, BeforeJSON NVARCHAR(MAX) NOT NULL,
  CapturedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF OBJECT_ID('dbo.PackagingFormulaRoleMigrationState') IS NULL
 CREATE TABLE dbo.PackagingFormulaRoleMigrationState(
  ID INT PRIMARY KEY CHECK(ID=1),AppliedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF NOT EXISTS(SELECT 1 FROM dbo.PackagingFormulaRoleMigrationState WHERE ID=1) BEGIN
 INSERT dbo.PackagingFormulaRoleMigrationLog(DimensionID,BeforeJSON)
 SELECT d.ID,(SELECT old.* FROM dbo.PackagingDimension old WHERE old.ID=d.ID FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
 FROM dbo.PackagingDimension d;
 -- The old parent area is consumption, NOT a footprint. Leave occupied m2 blank for review.
 UPDATE d SET
  OccupiedM3Formula=CASE WHEN t.ParentTypeID IS NULL AND t.RootShipping=1 THEN d.VolumeFormula END,
  OccupiedFormulaNeedsReview=CASE WHEN t.ParentTypeID IS NULL AND t.RootShipping=1
    AND d.SquareMeterFormula IS NOT NULL THEN 1 ELSE 0 END,
  ConvertFromParentFormula=CASE WHEN t.ParentTypeID IS NOT NULL THEN p.SquareMeterFormula END,
  ConvertFromSupplierFormula=CASE WHEN t.ParentTypeID IS NOT NULL THEN COALESCE(d.SquareMeterFormula,p.SquareMeterFormula) END
 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
 LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID;
 INSERT dbo.PackagingFormulaRoleMigrationState(ID) VALUES(1);
END;
GO
CREATE OR ALTER VIEW dbo.v_PackagingDimensionWeb AS
SELECT d.*,t.ParentTypeID,t.RootTypeID,t.RootShipping AS Shipping,t.PackagingType,t.PriceBasis,
 p.RowVersion AS ParentDimensionRowVersion,
 -- Legacy aliases are retained only for older readers, not new formula evaluation.
 COALESCE(d.SquareMeterFormula,p.SquareMeterFormula) AS EffectiveSquareMeterFormula,
 COALESCE(d.VolumeFormula,p.VolumeFormula) AS EffectiveVolumeFormula,
 CONVERT(BIT,CASE WHEN d.FormulaNeedsReview=1 OR p.FormulaNeedsReview=1 THEN 1 ELSE 0 END) AS EffectiveNeedsReview
FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_SaveV2
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @Status VARCHAR(10)='Active',@FormulaReviewed BIT=0,
 @ParentDimensionID INT=NULL,@ParentDimensionRowVersion VARBINARY(8)=NULL,
 @OccupiedM2Formula NVARCHAR(200)=NULL,@OccupiedM3Formula NVARCHAR(200)=NULL,
 @ConvertFromParentFormula NVARCHAR(200)=NULL,@ConvertFromSupplierFormula NVARCHAR(200)=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@Own BIT=0,@Root INT,@Shipping BIT,@TypeStatus VARCHAR(10),@OldType INT,
  @PriceBasis NVARCHAR(20),@NeedsReview BIT=0,@OccupiedReview BIT=0,@Lock INT,@AllFormulas NVARCHAR(800);
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRoleRow;
 EXEC @Lock=sys.sp_getapplock @Resource='PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @Lock<0 THROW 51108,'Packaging type hierarchy is busy. Retry.',1;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL BEGIN
  SELECT @OldType=PackagingTypeID,@NeedsReview=FormulaNeedsReview,@OccupiedReview=OccupiedFormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict. Refresh first.',1;
 END;
 SELECT @Root=RootTypeID,@Shipping=RootShipping,@TypeStatus=Status,@PriceBasis=PriceBasis
 FROM dbo.v_PackagingTypeDimensionContext WHERE ID=@PackagingTypeID;
 IF @Root IS NULL OR (@TypeStatus<>'Active' AND NOT(@Status='Block' AND @OldType=@PackagingTypeID))
  THROW 51111,'Choose an active Packaging Type.',1;
 IF @Status IS NULL OR @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
 IF @Root<>@PackagingTypeID BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK)
   WHERE ID=@ParentDimensionID AND PackagingTypeID=@Root AND ParentDimensionID IS NULL
    AND (Status='Active' OR @Status='Block') AND RowVersion=@ParentDimensionRowVersion)
   THROW 51108,'Choose a current parent dimension definition. Refresh first.',1;
  SELECT @D1=D1Name,@D2=D2Name,@D3=D3Name,@D1UoMID=D1UoMID,@D2UoMID=D2UoMID,@D3UoMID=D3UoMID
  FROM dbo.PackagingDimension WHERE ID=@ParentDimensionID;
 END ELSE IF @ParentDimensionID IS NOT NULL THROW 51111,'Parent types own their dimensions.',1;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N''); SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N''); SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @OccupiedM2Formula=NULLIF(LTRIM(RTRIM(@OccupiedM2Formula)),N'');
 SET @OccupiedM3Formula=NULLIF(LTRIM(RTRIM(@OccupiedM3Formula)),N'');
 SET @ConvertFromParentFormula=NULLIF(LTRIM(RTRIM(@ConvertFromParentFormula)),N'');
 SET @ConvertFromSupplierFormula=NULLIF(LTRIM(RTRIM(@ConvertFromSupplierFormula)),N'');
 IF (@OccupiedM2Formula IS NOT NULL OR @OccupiedM3Formula IS NOT NULL) AND (@Root<>@PackagingTypeID OR @Shipping<>1)
  THROW 51111,'Occupied formulas apply only to Shipping parents.',1;
 IF (@ConvertFromParentFormula IS NOT NULL OR @ConvertFromSupplierFormula IS NOT NULL) AND @Root=@PackagingTypeID
  THROW 51111,'Conversion formulas apply only to child types.',1;
 IF @Root<>@PackagingTypeID AND @PriceBasis='Square meter' AND @Status='Active' AND @ConvertFromParentFormula IS NULL
  THROW 51111,'Square meter children require Convert from parent.',1;
 IF @D1 IS NULL OR @D1UoMID IS NULL THROW 51111,'D1 name and unit are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs a name and unit.',1;
 IF @Shipping=1 AND (@D2 IS NULL OR @D3<>N'Height' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,'Shipping types require three dimensions; D3 is fixed as Height.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) x(ID)
  WHERE ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE UoM.ID=x.ID AND Status='Active'))
  AND @Status='Active' THROW 51111,'Choose active dimension units.',1;
 SET @AllFormulas=COALESCE(@OccupiedM2Formula,N'')+COALESCE(@OccupiedM3Formula,N'')
   +COALESCE(@ConvertFromParentFormula,N'')+COALESCE(@ConvertFromSupplierFormula,N'');
 IF CHARINDEX(N'D2',@AllFormulas)>0 AND @D2 IS NULL OR CHARINDEX(N'D3',@AllFormulas)>0 AND @D3 IS NULL
  THROW 51111,'Define dimensions used in the formulas.',1;
 IF (@NeedsReview=1 OR @OccupiedReview=1) AND @FormulaReviewed<>1 AND @Status='Active'
  THROW 51111,'Review the migrated formulas before saving.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,
   OccupiedM2Formula,OccupiedM3Formula,ConvertFromParentFormula,ConvertFromSupplierFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@ParentDimensionID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,
   @OccupiedM2Formula,@OccupiedM3Formula,@ConvertFromParentFormula,@ConvertFromSupplierFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,ParentDimensionID=@ParentDimensionID,
  D1Name=@D1,D2Name=@D2,D3Name=@D3,D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,
  OccupiedM2Formula=@OccupiedM2Formula,OccupiedM3Formula=@OccupiedM3Formula,
  ConvertFromParentFormula=@ConvertFromParentFormula,ConvertFromSupplierFormula=@ConvertFromSupplierFormula,
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  OccupiedFormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE OccupiedFormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRoleRow;
 THROW;
 END CATCH;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_FormulaRoles
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  WHERE ((d.OccupiedM2Formula IS NOT NULL OR d.OccupiedM3Formula IS NOT NULL) AND (t.ParentTypeID IS NOT NULL OR t.RootShipping<>1))
   OR ((d.ConvertFromParentFormula IS NOT NULL OR d.ConvertFromSupplierFormula IS NOT NULL) AND t.ParentTypeID IS NULL))
  THROW 51111,'Occupied formulas are for Shipping parents; conversion formulas are for children.',1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_BatchV5
    @Rows dbo.PackagingPriceBatchTypeV4 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @SupplierDimension INT,@SupplierRV VARBINARY(8),@SupplierD1 DECIMAL(18,6),@SupplierD2 DECIMAL(18,6),@SupplierD3 DECIMAL(18,6),@SupplierArea DECIMAL(28,9),@SupplierSet BIT;
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Rate DECIMAL(18,10),@Vendor INT,@Material INT,@Currency INT,@Basis NVARCHAR(40),@QFrom DECIMAL(18,4),@QTo DECIMAL(18,4),@Price DECIMAL(18,4),@From DATE,@To DATE,@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,MaterialID,CurrencyID,NULLIF(LTRIM(RTRIM(PriceBasis)),N''),QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit,SupplierSet FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND COALESCE(@SupplierSet,0)=0
                 SELECT @SupplierDimension=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionID END,
                  @SupplierRV=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionRowVersion END,
                  @SupplierD1=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD1 END,
                  @SupplierD2=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD2 END,
                  @SupplierD3=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD3 END,
                  @SupplierArea=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierAreaPerPriceUnit END
                 FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @SupplierDimension IS NULL AND (@SupplierRV IS NOT NULL OR @SupplierD1 IS NOT NULL OR @SupplierD2 IS NOT NULL OR @SupplierD3 IS NOT NULL OR @SupplierArea IS NOT NULL)
                 THROW 51111,'Supplier measurements need a child dimension definition.',1;
                IF @SupplierDimension IS NOT NULL AND @SupplierSet=1
                BEGIN
                 IF @SupplierArea IS NULL OR @SupplierArea<=0 OR @SupplierD1<=0 OR @SupplierD2<=0 OR @SupplierD3<=0
                  THROW 51111,'Supplier formula area and measurements must be positive.',1;
                 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension d WITH(HOLDLOCK)
                  JOIN dbo.PackagingMaterial m ON m.PackagingTypeID=d.PackagingTypeID
                  JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
                  JOIN dbo.PackagingDimension parent ON parent.ID=d.ParentDimensionID
                  WHERE d.ID=@SupplierDimension AND m.ID=@Material AND t.ParentTypeID IS NOT NULL
                   AND d.RowVersion=@SupplierRV AND d.Status='Active' AND t.Status='Active' AND parent.Status='Active'
                   AND d.FormulaNeedsReview=0 AND parent.FormulaNeedsReview=0
                   AND NOT EXISTS(SELECT 1 FROM (VALUES(d.D1UoMID),(d.D2UoMID),(d.D3UoMID)) s(ID)
                    JOIN dbo.UoM u WITH(HOLDLOCK) ON u.ID=s.ID WHERE u.Status<>'Active')
                   AND d.ConvertFromSupplierFormula IS NOT NULL)
                  THROW 51108,'Supplier child formula changed or is unavailable. Refresh pricing.',1;
                END;
                IF @Vendor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Vendor AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingPrice WHERE ID=@ID AND VendorID=@Vendor))))
                    THROW 51112,'Choose an active Vendor.',1;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @Currency IS NULL AND @Vendor IS NOT NULL SELECT @Currency=CurrencyID FROM dbo.Vendor WHERE ID=@Vendor;
                IF EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@Currency AND CurrencyCode='USD') SET @Rate=1;
                IF @Rate IS NOT NULL AND @Rate<=0 THROW 51111,'Exchange rate must be positive.',1;
                IF @Currency IS NULL OR @Basis IS NULL OR @QFrom IS NULL OR @Price IS NULL OR @From IS NULL
                        THROW 51111,'Currency, basis, quantity from, price and effective from are required.',1;
                    IF NOT EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Material AND Status='Active')
                        THROW 51112,'Active Packaging Material is required.',1;
                    /* Half-open quantity intervals [from,to); inclusive effective dates. */
                    IF COALESCE(@Status,'Active')='Active' AND EXISTS(
                        SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                        WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis AND (VendorID=@Vendor OR (VendorID IS NULL AND @Vendor IS NULL))
                          AND Status='Active' AND (@Command='C' OR ID<>@ID)
                          AND (@To IS NULL OR EffectiveFrom<=@To)
                          AND (EffectiveTo IS NULL OR @From<=EffectiveTo)
                          AND (@QTo IS NULL OR QuantityFrom<@QTo)
                          AND (QuantityTo IS NULL OR @QFrom<QuantityTo))
                        THROW 51113,'Active price date and quantity ranges overlap.',1;
            END;
            IF @Command='C'
            BEGIN
                INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingPrice SET SupplierDimensionID=@SupplierDimension,SupplierDimensionRowVersion=@SupplierRV,SupplierD1=@SupplierD1,SupplierD2=@SupplierD2,SupplierD3=@SupplierD3,SupplierAreaPerPriceUnit=@SupplierArea,ExchangeRateToUSD=@Rate,VendorID=@Vendor,MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            IF @OwnTran=1 COMMIT;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingRow;
            ELSE IF XACT_STATE()=-1 THROW;
            DELETE @Result WHERE RowNum=@RowNum;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),@ID,NULL);
        END CATCH;
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_FormulaRoleScope
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  WHERE (d.OccupiedM2Formula IS NOT NULL OR d.OccupiedM3Formula IS NOT NULL)
   AND (t.ParentTypeID IS NOT NULL OR t.RootShipping<>1))
  THROW 51111,'Clear occupied formulas before removing Shipping from their parent type.',1;
END;
GO
COMMIT TRANSACTION;
GO
