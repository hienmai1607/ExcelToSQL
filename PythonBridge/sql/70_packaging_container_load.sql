USE [test];
GO
-- After 69. Web-only container loading counts; calculated totals remain read-only.
-- Preserve legacy CartonsPerContainer entries and all immutable request snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','LayersPerContainer') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD LayersPerContainer INT NULL
  CONSTRAINT CK_PCRItem_LayersPerContainer CHECK(LayersPerContainer>=1);
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletsPerContainer') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletsPerContainer INT NULL
  CONSTRAINT CK_PCRItem_PalletsPerContainer CHECK(PalletsPerContainer>=1);
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','CartonsPerContainerFloor') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CartonsPerContainerFloor INT NULL
  CONSTRAINT CK_PCRItem_CartonsPerContainerFloor CHECK(CartonsPerContainerFloor>=1);

DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Packing Way whole-count validation.',@D)=0
 THROW 52970,'Run migrations through 69 first.',1;
IF CHARINDEX(N'-- Container loading count validation.',@D)=0
BEGIN
 IF CHARINDEX(N'''CartonsPerContainer'',''NutDensity''',@D)=0
  OR CHARINDEX(N'UnitsPerTertiary INT) j',@D)=0
  OR CHARINDEX(N' NutDensity=CASE',@D)=0
  OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',@D)=0
  THROW 52970,'Unexpected response fields procedure signature.',1;
 SET @D=REPLACE(@D,N'''CartonsPerContainer'',''NutDensity''',
  N'''CartonsPerContainer'',''LayersPerContainer'',''PalletsPerContainer'',''CartonsPerContainerFloor'',''NutDensity''');
 SET @D=REPLACE(@D,N'UnitsPerTertiary INT) j',N'UnitsPerTertiary INT,LayersPerContainer INT,PalletsPerContainer INT,CartonsPerContainerFloor INT) j');
 SET @D=REPLACE(@D,N' NutDensity=CASE',N' LayersPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerContainer'') THEN j.LayersPerContainer ELSE t.LayersPerContainer END,
 PalletsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''PalletsPerContainer'') THEN j.PalletsPerContainer ELSE t.PalletsPerContainer END,
 CartonsPerContainerFloor=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''CartonsPerContainerFloor'') THEN j.CartonsPerContainerFloor ELSE t.CartonsPerContainerFloor END,
 NutDensity=CASE');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',N'-- Container loading count validation.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN(''LayersPerContainer'',''PalletsPerContainer'',''CartonsPerContainerFloor'') AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE ''%[^0-9]%'' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52961,''Container counts must be positive whole numbers up to 2,147,483,647.'',1;
 DECLARE @LoadConfiguration NVARCHAR(500);
 SELECT @LoadConfiguration=COALESCE(LTRIM(RTRIM(ConfigurationRequest)),N'''') FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
 IF (@LoadConfiguration=N''Floor load'' AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN(''LayersPerContainer'',''PalletsPerContainer'') AND [type]<>0))
  OR (@LoadConfiguration NOT IN(N''Floor load'',N''Both'') AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''CartonsPerContainerFloor'' AND [type]<>0))
  THROW 52961,''Use only the container fields matching the request configuration snapshot.'',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;

-- Add response count changes to the existing actor/event audit stream.
SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL OR CHARINDEX(N'CROSS APPLY(VALUES',@D)=0
 THROW 52970,'Unexpected request item audit trigger.',1;
DECLARE @Rows NVARCHAR(MAX)=N'',@Field SYSNAME;
DECLARE fields CURSOR LOCAL FAST_FORWARD FOR
 SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('dbo.PackagingConfigurationRequestItem')
 AND name IN(N'LayersPerContainer',N'PalletsPerContainer',N'CartonsPerContainerFloor');
OPEN fields;FETCH NEXT FROM fields INTO @Field;
WHILE @@FETCH_STATUS=0
BEGIN
 IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
  SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N'),1),';
 FETCH NEXT FROM fields INTO @Field;
END;
CLOSE fields;DEALLOCATE fields;
IF @Rows<>N''
BEGIN
 SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
