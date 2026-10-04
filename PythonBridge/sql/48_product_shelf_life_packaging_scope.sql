USE [test];
GO
-- After 47. Shelf life belongs to Product; logistics belong to root items.
-- Retain legacy columns and request snapshots. Do not rewrite historical data.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF COL_LENGTH('dbo.Product','ShelfLifeDays') IS NULL
 ALTER TABLE dbo.Product ADD ShelfLifeDays INT NULL;
GO
IF OBJECT_ID('dbo.CK_Product_ShelfLifeDays','C') IS NULL
 ALTER TABLE dbo.Product WITH CHECK ADD CONSTRAINT CK_Product_ShelfLifeDays
 CHECK(ShelfLifeDays IS NULL OR ShelfLifeDays>=0);
GO
-- Extend the established partial-update procedure without replacing its guards.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_Product_Fields_Save'));
IF @Definition IS NULL THROW 52957,'Run Product migrations through 47 first.',1;
IF CHARINDEX(N'''ShelfLifeDays''',@Definition)=0
BEGIN
 IF CHARINDEX(N'''Category'',''ProductName'',''WeightGrams'',''Status'',''CustomerID''',@Definition)=0
  THROW 52957,'Unexpected Product field procedure. Review before deploying.',1;
 SET @Definition=REPLACE(@Definition,N'''Category'',''ProductName'',''WeightGrams'',''Status'',''CustomerID''',
  N'''Category'',''ProductName'',''WeightGrams'',''Status'',''CustomerID'',''ShelfLifeDays''');
 SET @Definition=REPLACE(@Definition,N'[type] IN(4,5))',
  N'([key]=''ShelfLifeDays'' AND [type]<>0 AND
   ([type] NOT IN(1,2) OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<0 OR [value] LIKE ''%[^0-9]%'')) OR
   [type] IN(4,5))');
 SET @Definition=REPLACE(@Definition,N'UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',
  N'ShelfLifeDays=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ShelfLifeDays'') THEN j.ShelfLifeDays ELSE t.ShelfLifeDays END,
  UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()');
 SET @Definition=REPLACE(@Definition,N'Category NVARCHAR(100)) j',N'Category NVARCHAR(100),ShelfLifeDays INT) j');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Retired requirements cannot be written, even by old clients or direct calls.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @Definition IS NULL THROW 52957,'Run Opportunity field migrations first.',1;
IF CHARINDEX(N'Parent-only logistics',@Definition)=0
BEGIN
 SET @Definition=REPLACE(@Definition,N',''BarrierRequirement'',''ShelfLifeDays''',N'');
 SET @Definition=REPLACE(@Definition,
  N'BarrierRequirement=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''BarrierRequirement'') THEN NULLIF(LTRIM(RTRIM(j.BarrierRequirement)),N'''') ELSE t.BarrierRequirement END,',N'');
 SET @Definition=REPLACE(@Definition,
  N'ShelfLifeDays=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ShelfLifeDays'') THEN j.ShelfLifeDays ELSE t.ShelfLifeDays END,',N'');
 SET @Definition=REPLACE(@Definition,N',BarrierRequirement NVARCHAR(500),ShelfLifeDays INT',N'');
 SET @Definition=REPLACE(@Definition,N'DECLARE @OldUser SQL_VARIANT=',
  N'-- Parent-only logistics: reject supplied keys, including NULL.
  IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
   AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN(''PalletSize'',''PalletStacking'',''MaxPalletHeightM'',''ContainerRequest''))
   THROW 52960,''Pallet and Container requirements belong to the parent item only.'',1;
  DECLARE @OldUser SQL_VARIANT=');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Current Opportunity readers use Product shelf life, not the retired item value.
-- Keep a NULL Barrier alias for backwards-compatible internal reader SQL.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.v_OpportunityItemPackaging'));
IF @Definition IS NULL THROW 52957,'Opportunity Packaging view is missing.',1;
IF CHARINDEX(N'p.ShelfLifeDays',@Definition)=0
BEGIN
 SET @Definition=REPLACE(@Definition,N'oi.PalletSize',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.PalletSize END AS PalletSize');
 SET @Definition=REPLACE(@Definition,N'oi.PalletStacking',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.PalletStacking END AS PalletStacking');
 SET @Definition=REPLACE(@Definition,N'oi.MaxPalletHeightM',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.MaxPalletHeightM END AS MaxPalletHeightM');
 SET @Definition=REPLACE(@Definition,N'oi.ContainerRequest',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.ContainerRequest END AS ContainerRequest');
 SET @Definition=REPLACE(@Definition,N'oi.BarrierRequirement',N'CONVERT(NVARCHAR(500),NULL) AS BarrierRequirement');
 SET @Definition=REPLACE(@Definition,N'oi.ShelfLifeDays',N'p.ShelfLifeDays');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER VIEW',N'ALTER VIEW');
 SET @Definition=REPLACE(@Definition,N'CREATE VIEW',N'ALTER VIEW');
 SET @Definition=REPLACE(@Definition,N'CREATE   VIEW',N'ALTER VIEW');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Existing request snapshots stay immutable. Only new requests use these rules.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @Definition IS NULL THROW 52957,'Packaging Request snapshot procedure is missing.',1;
IF CHARINDEX(N'p.ShelfLifeDays,i.SpecialComments',@Definition)=0
BEGIN
 IF CHARINDEX(N'i.BarrierRequirement,i.ShelfLifeDays,i.SpecialComments',@Definition)=0
  THROW 52957,'Unexpected Packaging Request snapshot procedure.',1;
 SET @Definition=REPLACE(@Definition,
  N'i.PalletSize,i.PalletStacking,i.MaxPalletHeightM,i.ContainerRequest,i.ConfigurationRequest',
  N'CASE WHEN i.ParentItemID IS NULL THEN i.PalletSize END,
   CASE WHEN i.ParentItemID IS NULL THEN i.PalletStacking END,
   CASE WHEN i.ParentItemID IS NULL THEN i.MaxPalletHeightM END,
   CASE WHEN i.ParentItemID IS NULL THEN i.ContainerRequest END,i.ConfigurationRequest');
 SET @Definition=REPLACE(@Definition,N'i.BarrierRequirement,i.ShelfLifeDays,i.SpecialComments',
  N'NULL,p.ShelfLifeDays,i.SpecialComments');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Product readers and both root/child dropdown lookup payloads include shelf life.
DECLARE @Name SYSNAME,@Definition NVARCHAR(MAX);
DECLARE readers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.procedures
 WHERE name IN('usp_Product_Read','usp_OpportunityProductLookup_Read','usp_OpportunityMixLookup_Read');
OPEN readers; FETCH NEXT FROM readers INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @Definition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));
 IF CHARINDEX(N'p.ShelfLifeDays',@Definition)=0
 BEGIN
  IF CHARINDEX(N'p.ProductName',@Definition)=0 THROW 52957,'Unexpected Product reader.',1;
  SET @Definition=REPLACE(@Definition,N'p.ProductName,',N'p.ProductName,p.ShelfLifeDays,');
  SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
  SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
  SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @Definition;
 END;
 FETCH NEXT FROM readers INTO @Name;
END;
CLOSE readers; DEALLOCATE readers;
GO
COMMIT;
GO
