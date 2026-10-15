-- After 105. Run in the application database with SQLCMD -b.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.fn_PackagingPICMember','FN') IS NULL THROW 52996,'Apply migration 105 first.',1;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingType','CopyDim') IS NULL
 ALTER TABLE dbo.PackagingType ADD CopyDim BIT NOT NULL CONSTRAINT DF_PackagingType_CopyDim DEFAULT(0) WITH VALUES;
IF OBJECT_ID('dbo.CK_PackagingType_CopyDim','C') IS NULL
 EXEC(N'ALTER TABLE dbo.PackagingType ADD CONSTRAINT CK_PackagingType_CopyDim CHECK(CopyDim=0 OR FinalComponent=1)');
IF COL_LENGTH('dbo.PackagingPrice','MaterialDimensionID') IS NULL
 ALTER TABLE dbo.PackagingPrice ADD MaterialDimensionID INT NULL REFERENCES dbo.PackagingDimension(ID),
 MaterialDimensionRowVersion BINARY(8) NULL,MaterialD1 DECIMAL(18,6) NULL,MaterialD2 DECIMAL(18,6) NULL,MaterialD3 DECIMAL(18,6) NULL;
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeWeb';
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeDimensionContext';
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF @D IS NULL THROW 52996,'Packaging Type procedure is missing.',1;
IF CHARINDEX('-- Copy Dim. flag',@D)=0
BEGIN
 IF CHARINDEX('DECLARE @FinalComponent BIT,@FinalSet BIT;',@D)=0
 OR CHARINDEX('ParentTypeID=@Parent,Shipping=@Shipping,FinalComponent=@FinalComponent,Status=@Status',@D)=0
 THROW 52996,'Unexpected Packaging Type definition; review migration.',1;
 SET @D=REPLACE(@D,N'DECLARE @FinalComponent BIT,@FinalSet BIT;',N'DECLARE @FinalComponent BIT,@FinalSet BIT,@CopyDim BIT;');
 SET @D=REPLACE(@D,N'SET @Name=NULLIF',N'-- Copy Dim. flag
    SET @CopyDim=0;
    IF @Cmd=''U'' SELECT @CopyDim=CopyDim FROM dbo.PackagingType WHERE ID=@ID;
    IF EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''CopyDim'')
    BEGIN
     IF EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''CopyDim'' AND j.[type]<>3)
      THROW 51111,''Copy Dim. must be True or False.'',1;
     SELECT @CopyDim=CASE JSON_VALUE(r.value,''$.CopyDim'') WHEN ''true'' THEN 1 ELSE 0 END FROM OPENJSON(@Rows) r WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row;
    END;
    IF @CopyDim=1 AND @FinalComponent=0 THROW 51111,''Copy Dim. requires Single.'',1;
    SET @Name=NULLIF');
 SET @D=REPLACE(@D,N'ParentTypeID,Shipping,FinalComponent)',N'ParentTypeID,Shipping,FinalComponent,CopyDim)');
 SET @D=REPLACE(@D,N'@Parent,@Shipping,@FinalComponent)',N'@Parent,@Shipping,@FinalComponent,@CopyDim)');
 SET @D=REPLACE(@D,N'FinalComponent=@FinalComponent,Status=@Status',N'FinalComponent=@FinalComponent,CopyDim=@CopyDim,Status=@Status');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
-- Preserve migration 99's marker so earlier repeatable validation can recognize it.
-- Repair the marker if an earlier application of 106 renamed it with the captions.
IF CHARINDEX(N'-- Explicit Single.',@D)>0
BEGIN
 SET @D=REPLACE(@D,N'-- Explicit Single.',N'-- Explicit final component.');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_BatchV6 @Documents NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Documents)<>1 OR LEFT(LTRIM(@Documents),1)<>'[' THROW 51111,'Price rows must be a JSON array.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@Documents)) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 price rows.',1;
 DECLARE @Rows dbo.PackagingPriceBatchTypeV4;
 DECLARE @One TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Doc NVARCHAR(MAX),@Row INT,@ID INT,@Own BIT,@Copy BIT,@Type INT,@Dim INT,@RV VARBINARY(8),
 @D1 DECIMAL(18,6),@D2 DECIMAL(18,6),@D3 DECIMAL(18,6),@Set BIT;
 DECLARE docs CURSOR LOCAL FAST_FORWARD FOR SELECT value FROM OPENJSON(@Documents) ORDER BY TRY_CONVERT(INT,JSON_VALUE(value,'$.RowNum'));
 OPEN docs; FETCH NEXT FROM docs INTO @Doc;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0; SET @Row=TRY_CONVERT(INT,JSON_VALUE(@Doc,'$.RowNum')); SET @ID=NULL;
  DELETE @Rows; DELETE @One;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PriceCopyDim;
   INSERT @Rows SELECT [RowNum],[Command],[ID],[MaterialID],[CurrencyID],[PriceBasis],[QuantityFrom],[QuantityTo],[UnitPrice],[EffectiveFrom],[EffectiveTo],[Status],CONVERT(VARBINARY(8),[RowVersionB64],1),[VendorID],[ExchangeRateToUSD],[SupplierDimensionID],CONVERT(VARBINARY(8),[SupplierDimensionRowVersion],1),[SupplierD1],[SupplierD2],[SupplierD3],[SupplierAreaPerPriceUnit],[SupplierSet]
   FROM OPENJSON(@Doc) WITH([RowNum] INT '$.RowNum',[Command] CHAR(1) '$.Command',[ID] INT '$.ID',[MaterialID] INT '$.MaterialID',[CurrencyID] INT '$.CurrencyID',[PriceBasis] NVARCHAR(40) '$.PriceBasis',[QuantityFrom] DECIMAL(18,4) '$.QuantityFrom',[QuantityTo] DECIMAL(18,4) '$.QuantityTo',[UnitPrice] DECIMAL(18,4) '$.UnitPrice',[EffectiveFrom] DATE '$.EffectiveFrom',[EffectiveTo] DATE '$.EffectiveTo',[Status] VARCHAR(10) '$.Status',[RowVersionB64] VARCHAR(18) '$.RowVersionB64',[VendorID] INT '$.VendorID',[ExchangeRateToUSD] DECIMAL(18,10) '$.ExchangeRateToUSD',[SupplierDimensionID] INT '$.SupplierDimensionID',[SupplierDimensionRowVersion] VARCHAR(18) '$.SupplierDimensionRowVersion',[SupplierD1] DECIMAL(18,6) '$.SupplierD1',[SupplierD2] DECIMAL(18,6) '$.SupplierD2',[SupplierD3] DECIMAL(18,6) '$.SupplierD3',[SupplierAreaPerPriceUnit] DECIMAL(28,9) '$.SupplierAreaPerPriceUnit',[SupplierSet] BIT '$.SupplierSet');
   SET @Dim=TRY_CONVERT(INT,JSON_VALUE(@Doc,'$.MaterialDimensionID'));
   SET @RV=CONVERT(VARBINARY(8),JSON_VALUE(@Doc,'$.MaterialDimensionRowVersion'),1);
   SET @D1=TRY_CONVERT(DECIMAL(18,6),JSON_VALUE(@Doc,'$.MaterialD1'));
   SET @D2=TRY_CONVERT(DECIMAL(18,6),JSON_VALUE(@Doc,'$.MaterialD2'));
   SET @D3=TRY_CONVERT(DECIMAL(18,6),JSON_VALUE(@Doc,'$.MaterialD3'));
   SET @Set=CASE JSON_VALUE(@Doc,'$.MaterialDimensionSet') WHEN 'true' THEN 1 WHEN '1' THEN 1 ELSE 0 END;
   IF EXISTS(SELECT 1 FROM @Rows WHERE Command='U') AND @Set=0
    SELECT @Dim=p.MaterialDimensionID,@RV=p.MaterialDimensionRowVersion,@D1=p.MaterialD1,@D2=p.MaterialD2,@D3=p.MaterialD3
    FROM dbo.PackagingPrice p WITH(UPDLOCK,HOLDLOCK) JOIN @Rows r ON r.ID=p.ID AND r.MaterialID=p.MaterialID;
   SET @Copy=0; SET @Type=NULL;
   SELECT @Copy=t.CopyDim,@Type=t.ID FROM @Rows r JOIN dbo.PackagingMaterial m WITH(HOLDLOCK) ON m.ID=r.MaterialID
    JOIN dbo.PackagingType t WITH(HOLDLOCK) ON t.ID=m.PackagingTypeID;
   IF NOT EXISTS(SELECT 1 FROM @Rows WHERE Command='D') AND (@Copy=1 OR @Dim IS NOT NULL)
   BEGIN
    IF @Dim IS NULL THROW 51111,'Copy Dim. requires material dimensions in Packaging Pricing.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension d WITH(HOLDLOCK) WHERE d.ID=@Dim AND d.PackagingTypeID=@Type
     AND d.RowVersion=@RV AND d.Status='Active'
     AND (NULLIF(d.D1Name,'') IS NULL OR COALESCE(@D1,0)>0)
     AND (NULLIF(d.D2Name,'') IS NULL OR COALESCE(@D2,0)>0)
     AND (NULLIF(d.D3Name,'') IS NULL OR COALESCE(@D3,0)>0)
     AND (d.D1Name IS NOT NULL OR @D1 IS NULL) AND (d.D2Name IS NOT NULL OR @D2 IS NULL) AND (d.D3Name IS NOT NULL OR @D3 IS NULL)
     AND NOT EXISTS(SELECT 1 FROM (VALUES(d.D1UoMID),(d.D2UoMID),(d.D3UoMID)) x(ID) JOIN dbo.UoM u ON u.ID=x.ID WHERE u.Status<>'Active'))
     THROW 51111,'Enter all defined material dimensions using a current active definition and units.',1;
   END;
   INSERT @One EXEC dbo.usp_PackagingPrice_BatchV5 @Rows,@Username;
   IF EXISTS(SELECT 1 FROM @One WHERE Status='OK') AND NOT EXISTS(SELECT 1 FROM @Rows WHERE Command='D')
   BEGIN
    SELECT @ID=NewID FROM @One WHERE Status='OK';
    UPDATE dbo.PackagingPrice SET MaterialDimensionID=@Dim,MaterialDimensionRowVersion=@RV,
     MaterialD1=@D1,MaterialD2=@D2,MaterialD3=@D3 WHERE ID=@ID;
    UPDATE @One SET NewRowVersion=(SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=@ID) WHERE Status='OK';
   END;
   INSERT @Result SELECT * FROM @One;
   IF @Own=1 COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PriceCopyDim;
   ELSE IF XACT_STATE()=-1 THROW;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),NULL,NULL);
  END CATCH;
  FETCH NEXT FROM docs INTO @Doc;
 END;
 CLOSE docs; DEALLOCATE docs;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
COMMIT TRANSACTION;
GO
