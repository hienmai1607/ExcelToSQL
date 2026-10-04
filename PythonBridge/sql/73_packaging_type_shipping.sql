USE [test];
GO
-- After 72. Shipping is root-only; existing types remain explicitly non-shipping.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingType','Shipping') IS NULL
 ALTER TABLE dbo.PackagingType ADD Shipping BIT NOT NULL
  CONSTRAINT DF_PackagingType_Shipping DEFAULT(0) WITH VALUES;
GO
IF OBJECT_ID('dbo.CK_PackagingType_ShippingRoot','C') IS NULL
 ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_ShippingRoot
  CHECK(Shipping=0 OR ParentTypeID IS NULL);
GO
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeWeb';
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF @D IS NULL OR CHARINDEX(N'DECLARE @ChosenOrders TABLE',@D)=0
 THROW 52970,'Run Packaging Type order migration 66 first.',1;
IF CHARINDEX(N'-- Shipping root flag.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'DECLARE @ChosenOrders TABLE',N'DECLARE @Shipping BIT,@ShippingSet BIT;
 DECLARE @ChosenOrders TABLE');
 SET @D=REPLACE(@D,N'SET @Name=NULLIF',N'-- Shipping root flag.
    SET @ShippingSet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
     WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''Shipping'') THEN 1 ELSE 0 END;
    SET @Shipping=0;
    IF @ShippingSet=1 BEGIN
     IF EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
      WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''Shipping'' AND j.[type]<>3)
      THROW 51111,''Shipping must be True or False.'',1;
     SELECT @Shipping=CASE JSON_VALUE(r.value,''$.Shipping'') WHEN ''true'' THEN 1 ELSE 0 END
      FROM OPENJSON(@Rows) r WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row;
    END ELSE IF @Cmd=''U'' SELECT @Shipping=Shipping FROM dbo.PackagingType WHERE ID=@ID;
    IF @Parent IS NOT NULL BEGIN
     IF @ShippingSet=1 AND @Shipping=1 THROW 51111,''Shipping applies only to root Packaging Types.'',1;
     SET @Shipping=0;
    END;
    SET @Name=NULLIF');
 SET @D=REPLACE(@D,N'TareWeight,Status,CreatedBy,ParentTypeID)',N'TareWeight,Status,CreatedBy,ParentTypeID,Shipping)');
 SET @D=REPLACE(@D,N'@Basis,0,@Status,@Actor,@Parent)',N'@Basis,0,@Status,@Actor,@Parent,@Shipping)');
 SET @D=REPLACE(@D,N'ParentTypeID=@Parent,Status=@Status',N'ParentTypeID=@Parent,Shipping=@Shipping,Status=@Status');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF CHARINDEX(N'-- Shipping existing dimensions.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'SET @Name=NULLIF',N'-- Shipping existing dimensions.
    IF @Shipping=1 AND EXISTS(SELECT 1 FROM dbo.PackagingDimension WHERE PackagingTypeID=@ID AND Status=''Active''
     AND (NULLIF(LTRIM(RTRIM(D1Name)),N'''') IS NULL OR NULLIF(LTRIM(RTRIM(D2Name)),N'''') IS NULL
      OR NULLIF(LTRIM(RTRIM(D3Name)),N'''') IS NULL OR D1UoMID IS NULL OR D2UoMID IS NULL OR D3UoMID IS NULL))
     THROW 51111,''Complete all three active dimension names and units before enabling Shipping.'',1;
    SET @Name=NULLIF');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @Name SYSNAME,@D NVARCHAR(MAX);
DECLARE lookups CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.procedures
 WHERE name IN('usp_OpportunityPackagingTypeLookup_Read','usp_PackagingResponseTypeLookup_Read');
OPEN lookups; FETCH NEXT FROM lookups INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
 IF CHARINDEX(N'PackagingType,Shipping,ParentTypeID',@D)=0 BEGIN
  IF CHARINDEX(N'PackagingType,ParentTypeID',@D)=0 THROW 52970,'Unexpected type lookup signature.',1;
  SET @D=REPLACE(@D,N'PackagingType,ParentTypeID',N'PackagingType,Shipping,ParentTypeID');
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM lookups INTO @Name;
END;
CLOSE lookups; DEALLOCATE lookups;
GO
-- Required dimension definitions, independent of Count/Volume/Square meter basis.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_Save'));
IF @D IS NULL OR CHARINDEX(N'@PriceBasis NVARCHAR(20)',@D)=0
 THROW 52970,'Run dimension migration 62 first.',1;
IF CHARINDEX(N'-- Shipping dimensions.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'@PriceBasis NVARCHAR(20)',N'@Shipping BIT,@PriceBasis NVARCHAR(20)');
 SET @D=REPLACE(@D,N'SELECT @PriceBasis=PriceBasis',N'SELECT @Shipping=Shipping,@PriceBasis=PriceBasis');
 SET @D=REPLACE(@D,N'IF @PriceBasis<>N''Square meter'' SET',N'IF @PriceBasis<>N''Square meter'' AND @Shipping=0 SET');
 SET @D=REPLACE(@D,N'IF @D1 IS NULL OR',N'-- Shipping dimensions.
 IF @Shipping=1 AND (@D1 IS NULL OR @D2 IS NULL OR @D3 IS NULL OR @D1UoMID IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,''Shipping types require D1, D2 and D3 names and units.'',1;
 IF @D1 IS NULL OR');
 SET @D=REPLACE(@D,N'IF @PriceBasis=N''Square meter'' AND ((',N'IF (@PriceBasis=N''Square meter'' OR @Shipping=1) AND ((');
 SET @D=REPLACE(@D,N'IF @PriceBasis=N''Square meter'' AND @NeedsReview=1',N'IF (@PriceBasis=N''Square meter'' OR @Shipping=1) AND @NeedsReview=1');
 SET @D=REPLACE(@D,N'CASE WHEN @PriceBasis=N''Square meter'' AND @FormulaReviewed=1',N'CASE WHEN (@PriceBasis=N''Square meter'' OR @Shipping=1) AND @FormulaReviewed=1');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_ShippingRequired
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
  WHERE t.Shipping=1 AND (NULLIF(LTRIM(RTRIM(d.D1Name)),N'') IS NULL
   OR NULLIF(LTRIM(RTRIM(d.D2Name)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(d.D3Name)),N'') IS NULL
   OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL))
  THROW 51111,'Shipping types require D1, D2 and D3 names and units.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_ShippingDimensions
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted t JOIN dbo.PackagingDimension d ON d.PackagingTypeID=t.ID
  WHERE t.Shipping=1 AND d.Status='Active' AND (NULLIF(LTRIM(RTRIM(d.D1Name)),N'') IS NULL
   OR NULLIF(LTRIM(RTRIM(d.D2Name)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(d.D3Name)),N'') IS NULL
   OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL))
  THROW 51111,'Complete all three active dimension names and units before enabling Shipping.',1;
END;
GO
-- Grandfather unchanged historical choices, but reject new non-shipping final types.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'ProductGradeSnapshot',@D)=0 THROW 52970,'Run migration 71 first.',1;
IF CHARINDEX(N'-- Shipping final request.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'-- Shipping final request.
 IF @Web=1 AND @Layers>=2 AND EXISTS(SELECT 1 FROM dbo.OpportunityItem i
  CROSS APPLY(SELECT CASE WHEN @Layers=2 THEN
   CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryTypeID'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.SecondaryTypeID'')) ELSE i.SecondaryTypeID END
   ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryTypeID'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.TertiaryTypeID'')) ELSE i.TertiaryTypeID END END TypeID) v
  WHERE i.ID=@ID AND v.TypeID IS NOT NULL
   AND NOT(i.PackagingLayerCount=@Layers AND v.TypeID=COALESCE(CASE WHEN @Layers=2 THEN i.SecondaryTypeID ELSE i.TertiaryTypeID END,-1))
   AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType t WHERE t.ID=v.TypeID AND t.Shipping=1 AND t.ParentTypeID IS NULL
    AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)))
  THROW 52957,''The final packaging layer requires a Shipping type in the matching order.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'ResponsePalletSize',@D)=0 THROW 52970,'Run migration 72 first.',1;
IF CHARINDEX(N'-- Shipping final response.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'-- Shipping final response.
 IF @Layers>=2 AND EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem i
  CROSS APPLY(SELECT CASE WHEN @Layers=2 THEN
   CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondPMType'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.SecondPMType''))),N'''') ELSE i.SecondPMType END
   ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ThirdPMType'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.ThirdPMType''))),N'''') ELSE i.ThirdPMType END END TypeName) v
  WHERE i.ID=@ID AND v.TypeName IS NOT NULL
   AND NOT(COALESCE(i.ResponseLayerCount,i.RequestedLayerCount)=@Layers AND v.TypeName=COALESCE(CASE WHEN @Layers=2 THEN i.SecondPMType ELSE i.ThirdPMType END,N''''))
   AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType t WHERE t.PackagingType=v.TypeName AND t.Shipping=1 AND t.ParentTypeID IS NULL
    AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)))
  THROW 52961,''The final packaging layer requires a Shipping type in the matching order.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
