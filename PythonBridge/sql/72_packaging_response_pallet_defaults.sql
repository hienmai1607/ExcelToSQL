USE [test];
GO
-- After 71. Separate editable response pallet specifications from frozen requests.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponsePalletSize') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponsePalletSize NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponsePalletStacking') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponsePalletStacking NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponseMaxPalletHeightMM') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponseMaxPalletHeightMM INT NULL
  CONSTRAINT CK_PCRItem_ResponseMaxPalletHeightMM CHECK(ResponseMaxPalletHeightMM BETWEEN 1 AND 999999999);
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponseDefaultsInitialized') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponseDefaultsInitialized BIT NOT NULL
  CONSTRAINT DF_PCRItem_ResponseDefaultsInitialized DEFAULT(0) WITH VALUES;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Container loading count validation.',@D)=0
 THROW 52970,'Run migrations through 71 first.',1;
IF CHARINDEX(N'ResponsePalletSize',@D)=0
BEGIN
 IF CHARINDEX(N'''CartonsPerContainerFloor'',''NutDensity''',@D)=0
  OR CHARINDEX(N'CartonsPerContainerFloor INT) j',@D)=0
  OR CHARINDEX(N' NutDensity=CASE',@D)=0
  OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',@D)=0
  THROW 52970,'Unexpected response pallet procedure signature.',1;
 SET @D=REPLACE(@D,N'''CartonsPerContainerFloor'',''NutDensity''',
  N'''CartonsPerContainerFloor'',''ResponsePalletSize'',''ResponsePalletStacking'',''ResponseMaxPalletHeightMM'',''NutDensity''');
 SET @D=REPLACE(@D,N'CartonsPerContainerFloor INT) j',
  N'CartonsPerContainerFloor INT,ResponsePalletSize NVARCHAR(100),ResponsePalletStacking NVARCHAR(100),ResponseMaxPalletHeightMM INT) j');
 SET @D=REPLACE(@D,N' NutDensity=CASE',N' ResponsePalletSize=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponsePalletSize'') THEN NULLIF(LTRIM(RTRIM(j.ResponsePalletSize)),N'''') ELSE t.ResponsePalletSize END,
 ResponsePalletStacking=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponsePalletStacking'') THEN NULLIF(LTRIM(RTRIM(j.ResponsePalletStacking)),N'''') ELSE t.ResponsePalletStacking END,
 ResponseMaxPalletHeightMM=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponseMaxPalletHeightMM'') THEN j.ResponseMaxPalletHeightMM ELSE t.ResponseMaxPalletHeightMM END,
 ResponseDefaultsInitialized=1,
 NutDensity=CASE');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',N'-- Response pallet specifications are independent of request configuration.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponseMaxPalletHeightMM'' AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE ''%[^0-9]%'' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value]) NOT BETWEEN 1 AND 999999999))
  THROW 52961,''Max pallet height must be a positive whole number of millimeters up to 999,999,999.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  WHERE j.[key]=''ResponsePalletStacking'' AND j.[type]<>0 AND NULLIF(LTRIM(RTRIM(j.[value])),N'''') IS NOT NULL
  AND (j.[type]<>1 OR j.[value] COLLATE Latin1_General_100_BIN2 NOT IN(N''Single'',N''Double''))
  AND NOT EXISTS(SELECT 1 WHERE CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.ResponsePalletStacking)
   OR CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.PalletStacking)))
  THROW 52961,''Choose Single or Double for pallet stacking.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  WHERE j.[key]=''ResponsePalletSize'' AND j.[type]<>0 AND NULLIF(LTRIM(RTRIM(j.[value])),N'''') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID
   WHERE p.PalletSize=j.[value] AND p.Status=''Active'' AND u.Status=''Active'')
  AND NOT EXISTS(SELECT 1 WHERE CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.ResponsePalletSize)
   OR CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.PalletSize)))
  THROW 52961,''Choose an active pallet size from Pallet Master.'',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- New requests capture defaults at INSERT time. Never rewrite existing responses.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'TertiarySpecialComments',@D)=0
 THROW 52970,'Run request snapshot migration 71 first.',1;
IF CHARINDEX(N'ResponseDefaultsInitialized',@D)=0
BEGIN
 IF CHARINDEX(N'TertiarySpecialComments)',@D)=0 OR CHARINDEX(N'i.TertiarySpecialComments',@D)=0
  THROW 52970,'Unexpected request default INSERT signature.',1;
 SET @D=REPLACE(@D,N'TertiarySpecialComments)',N'TertiarySpecialComments,ResponseLayerCount,FirstPMType,SecondPMType,ThirdPMType,UnitsPerCarton,UnitsPerTertiary,ResponsePalletSize,ResponsePalletStacking,ResponseMaxPalletHeightMM,ResponseDefaultsInitialized)');
 SET @D=REPLACE(@D,N'i.TertiarySpecialComments',N'i.TertiarySpecialComments,i.PackagingLayerCount,
  (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.PrimaryTypeID),
  CASE WHEN i.PackagingLayerCount>=2 THEN (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.SecondaryTypeID) END,
  CASE WHEN i.PackagingLayerCount>=3 THEN (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.TertiaryTypeID) END,
  CASE WHEN i.PackagingLayerCount>=2 THEN i.NumberOfPrimary END,
  CASE WHEN i.PackagingLayerCount>=3 THEN i.NumberOfSecondary END,
  CASE WHEN i.ParentItemID IS NULL THEN i.PalletSize END,
  CASE WHEN i.ParentItemID IS NULL THEN i.PalletStacking END,
  CASE WHEN i.ParentItemID IS NULL THEN i.MaxPalletHeightMM END,1');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL OR CHARINDEX(N'CROSS APPLY(VALUES',@D)=0
 THROW 52970,'Unexpected request item audit trigger.',1;
DECLARE @Rows NVARCHAR(MAX)=N'',@Field SYSNAME;
DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
 WHERE object_id=OBJECT_ID('dbo.PackagingConfigurationRequestItem')
 AND name IN(N'ResponsePalletSize',N'ResponsePalletStacking',N'ResponseMaxPalletHeightMM');
OPEN fields;FETCH NEXT FROM fields INTO @Field;
WHILE @@FETCH_STATUS=0 BEGIN
 IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
  SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N'),1),';
 FETCH NEXT FROM fields INTO @Field;
END;
CLOSE fields;DEALLOCATE fields;
IF @Rows<>N'' BEGIN
 SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
