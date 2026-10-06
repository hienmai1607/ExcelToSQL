:on error exit
/*
PythonBridge VM upgrade: migrations 86-88, generated 2026-10-06.

Existing application database only; migrations through 85 must already be applied.
Back up the target database and stop the API before running this upgrade.
Existing request, pricing and master history is preserved; no history purge.
Each source keeps its original transaction. This bundle is NOT atomic:
if a migration fails, earlier committed migrations remain. Stop and investigate.

SSMS: select the application database, enable Query > SQLCMD Mode, execute this file.
sqlcmd: sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i upgrade_086_to_088_vm.sql
The connection's selected database is the target. No local USE [test] directives,
external include files, credentials or sample data are included.
Deploy matching core/ and webapp/dist/, restart the API, hard-refresh clients.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb')
 THROW 52995,'Select the existing PythonBridge application database, not a system database.',1;
IF @@TRANCOUNT<>0
 THROW 52995,'Run the VM upgrade on a new connection without an existing transaction.',1;
IF (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID())<130
 THROW 52995,'PythonBridge requires database compatibility level 130 or higher.',1;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ContainerLoadProfiles') IS NULL
 OR COL_LENGTH('dbo.OpportunityItem','ProductNetWeightGrams') IS NULL
 OR CHARINDEX(N'-- Shipping height container layers.',
    COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),N''))=0
 THROW 52995,'Apply migrations through 85 before this upgrade; it is not a fresh-install script.',1;
PRINT N'Applying PythonBridge migrations 86-88 to '+QUOTENAME(DB_NAME());
GO
-- BEGIN MIGRATION 86_mix_parent_logistics.sql
PRINT N'Applying 86_mix_parent_logistics.sql';
GO
-- After 85. Child logistics belong to the mix parent; preserve existing history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.OpportunityItem','ParentItemID') IS NULL
 OR COL_LENGTH('dbo.PackagingConfigurationRequestItem','ContainerLoadProfiles') IS NULL
 THROW 52992,'Apply migrations through 85 before mix parent logistics.',1;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ProductMixSnapshot') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ProductMixSnapshot NVARCHAR(MAX) NULL;
GO
CREATE OR ALTER VIEW dbo.v_ProductActiveGradeSnapshot AS
 SELECT p.ID ProductID,(SELECT JSON_QUERY(COALESCE((
  SELECT g.ParentID,g.ID,g.RawGradeID,g.RawMaterialID,g.Grade,g.RatioPct,
   m.MaterialCode RawMaterialCode,m.MaterialName RawMaterialName
  FROM dbo.ProductGradeItem g JOIN dbo.ProductGradeVersion v ON v.ID=g.VersionID
  LEFT JOIN dbo.RawMaterial m ON m.ID=g.RawMaterialID
  WHERE v.ProductID=p.ID AND v.Status='Active' ORDER BY g.ParentID,g.ID FOR JSON PATH),N'[]')) items
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) ProductGradeSnapshot
 FROM dbo.Product p;
GO
CREATE OR ALTER VIEW dbo.v_OpportunityMixStructure AS
 SELECT s.ParentItemID,s.MixVersionID,(SELECT s.MixVersionID,
  JSON_QUERY(COALESCE((SELECT c.ProductID,p.ProductCode,p.ProductName,c.MixUnitQuantity UnitQuantity,
   c.ProductNetWeightGrams WeightGrams,
   JSON_QUERY(COALESCE(c.ProductGradeSnapshot,g.ProductGradeSnapshot)) ProductGradeSnapshot
   FROM dbo.OpportunityItem c JOIN dbo.Product p ON p.ID=c.ProductID
   LEFT JOIN dbo.v_ProductActiveGradeSnapshot g ON g.ProductID=c.ProductID
   WHERE c.ParentItemID=s.ParentItemID ORDER BY c.MixChildNumber,c.ID FOR JSON PATH),N'[]')) items
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) StructureJSON
 FROM dbo.OpportunityMixSnapshot s;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityMixLookup_Read'));
IF @D IS NULL THROW 52992,'Mix lookup procedure is missing.',1;
IF CHARINDEX(N'v_ProductActiveGradeSnapshot',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'p.WeightGrams,p.Category',N'p.WeightGrams,p.Category,(SELECT ProductGradeSnapshot FROM dbo.v_ProductActiveGradeSnapshot WHERE ProductID=p.ID) ProductGradeSnapshot');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Shipping final request.',@D)=0 THROW 52992,'Shipping request validation is missing.',1;
IF CHARINDEX(N'-- Mix parent logistics.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'WHERE i.ID=@ID AND v.TypeID IS NOT NULL',N'WHERE i.ID=@ID AND i.ParentItemID IS NULL AND v.TypeID IS NOT NULL');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'-- Mix parent logistics.
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN
   (''ContainerRequest'',''ConfigurationRequest'',''PalletSize'',''PalletStacking'',''MaxPalletHeightM'',''MaxPalletHeightMM''))
  THROW 52957,''Container, Configuration and Pallet requirements belong to the parent mix.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Shipping height container layers.',@D)=0 THROW 52992,'Apply migration 85 first.',1;
IF CHARINDEX(N'-- Mix parent response logistics.',@D)=0
 OR CHARINDEX(N'-- Mix parent response logistics.',@D)>CHARINDEX(N'-- Container type profiles:',@D) BEGIN
 SET @D=REPLACE(@D,CHAR(13),N'');
 SET @D=REPLACE(@D,N'WHERE i.ID=@ID AND v.TypeName IS NOT NULL',
  N'WHERE i.ID=@ID AND EXISTS(SELECT 1 FROM dbo.OpportunityItem oi WHERE oi.ID=i.OpportunityItemID AND oi.ParentItemID IS NULL) AND v.TypeName IS NOT NULL');
 DECLARE @Guard NVARCHAR(MAX)=N'-- Mix parent response logistics.
 IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
   WHERE i.ID=@ID AND oi.ParentItemID IS NOT NULL)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN
   (''ResponsePalletSize'',''ResponsePalletStacking'',''ResponseMaxPalletHeightMM'',''HeightMM'',''CartonsPerLayer'',
    ''LayersPerPallet'',''PacksPerPallet'',''CartonsPerContainer'',''LayersPerContainer'',''PalletsPerContainer'',
    ''CartonsPerContainerFloor'',''SelectedContainerType'',''ContainerLoadProfiles''))
  THROW 52961,''Shipping and Palletization response fields belong to the parent mix.'',1;
 ';
 -- Check the original payload before container profiles add server-owned fields.
 SET @D=REPLACE(@D,@Guard,N'');
 SET @D=REPLACE(@D,N'-- Container type profiles:',@Guard+N'-- Container type profiles:');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'ProductGradeSnapshot',@D)=0 THROW 52992,'Request snapshot creation is missing.',1;
IF CHARINDEX(N'ProductMixSnapshot',@D)=0 BEGIN
 DECLARE @Columns NVARCHAR(MAX)=N'NumberOfSecondary,MaxPalletHeightMM,ProductGradeSnapshot',
  @Values NVARCHAR(MAX)=N'i.NumberOfSecondary,i.MaxPalletHeightMM,COALESCE(i.ProductGradeSnapshot',
  @Logistics NVARCHAR(MAX)=N'i.PalletSize,i.PalletStacking,i.MaxPalletHeightM,i.ContainerRequest,i.ConfigurationRequest';
 IF CHARINDEX(@Columns,@D)=0 OR CHARINDEX(@Values,@D)=0
  OR (CHARINDEX(@Logistics,@D)=0 AND CHARINDEX(N'CASE WHEN i.ParentItemID IS NULL THEN i.PalletSize END',@D)=0)
  THROW 52992,'Unexpected request snapshot creation signature.',1;
 SET @D=REPLACE(@D,@Columns,N'NumberOfSecondary,ProductMixSnapshot,MaxPalletHeightMM,ProductGradeSnapshot');
 SET @D=REPLACE(@D,@Values,N'i.NumberOfSecondary,(SELECT StructureJSON FROM dbo.v_OpportunityMixStructure WHERE ParentItemID=i.ID),
  (SELECT MaxPalletHeightMM FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID)),COALESCE(i.ProductGradeSnapshot');
 IF CHARINDEX(@Logistics,@D)>0 SET @D=REPLACE(@D,@Logistics,N'(SELECT PalletSize FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID)),
  (SELECT PalletStacking FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID)),
  (SELECT MaxPalletHeightM FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID)),
  (SELECT ContainerRequest FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID)),
  (SELECT ConfigurationRequest FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID))');
 ELSE BEGIN
  SET @D=REPLACE(@D,N'CASE WHEN i.ParentItemID IS NULL THEN i.PalletSize END',N'(SELECT PalletSize FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID))');
  SET @D=REPLACE(@D,N'CASE WHEN i.ParentItemID IS NULL THEN i.PalletStacking END',N'(SELECT PalletStacking FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID))');
  SET @D=REPLACE(@D,N'CASE WHEN i.ParentItemID IS NULL THEN i.MaxPalletHeightM END',N'(SELECT MaxPalletHeightM FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID))');
  SET @D=REPLACE(@D,N'CASE WHEN i.ParentItemID IS NULL THEN i.MaxPalletHeightMM END',N'(SELECT MaxPalletHeightMM FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID))');
  SET @D=REPLACE(@D,N'CASE WHEN i.ParentItemID IS NULL THEN i.ContainerRequest END',N'(SELECT ContainerRequest FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID))');
  SET @D=REPLACE(@D,N'i.ConfigurationRequest',N'(SELECT ConfigurationRequest FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID))');
 END;
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingRequestItem_MixSnapshotImmutable
ON dbo.PackagingConfigurationRequestItem AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE EXISTS(SELECT CONVERT(VARBINARY(MAX),i.ProductMixSnapshot)
   EXCEPT SELECT CONVERT(VARBINARY(MAX),d.ProductMixSnapshot)))
  THROW 52992,'The requested Product Mix structure is immutable.',1;
END;
GO
COMMIT;
GO
-- END MIGRATION 86_mix_parent_logistics.sql

-- BEGIN MIGRATION 87_mix_packaging_type_orders.sql
PRINT N'Applying 87_mix_packaging_type_orders.sql';
GO
-- After 86: mix parent layers use Secondary/Tertiary master types.
-- Preserve saved choices and all request/pricing history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ProductMixSnapshot') IS NULL
 THROW 52993,'Apply migration 86 before mix packaging type orders.',1;
GO
CREATE OR ALTER FUNCTION dbo.fn_OpportunityIsMixParent(@ItemID INT)
RETURNS BIT
AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM dbo.OpportunityItem i
  JOIN dbo.OpportunityMixSnapshot m ON m.ParentItemID=i.ID
  WHERE i.ID=@ItemID AND i.ParentItemID IS NULL) THEN 1 ELSE 0 END;
END;
GO
CREATE OR ALTER FUNCTION dbo.fn_PackagingTypeOrderAllowed(
 @TypeID INT,@LayerOrder VARCHAR(20),@MixParent BIT)
RETURNS BIT
AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o
  WHERE o.PackagingTypeID=@TypeID AND
   ((@MixParent=1 AND o.PackagingOrder IN('Secondary','Tertiary'))
    OR (@MixParent=0 AND o.PackagingOrder=@LayerOrder))) THEN 1 ELSE 0 END;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Mix parent logistics.',@D)=0
 THROW 52993,'Apply migration 86 request validation first.',1;
IF CHARINDEX(N'-- Mix parent packaging orders.',@D)=0 BEGIN
 DECLARE @Choice NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID AND o.PackagingOrder=CASE [key] WHEN ''PrimaryTypeID'' THEN ''Primary'' WHEN ''SecondaryTypeID'' THEN ''Secondary'' ELSE ''Tertiary'' END)',
  @Final NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)';
 IF CHARINDEX(@Choice,@D)=0 OR CHARINDEX(@Final,@D)=0
  THROW 52993,'Unexpected Opportunity type validation signature.',1;
 SET @D=REPLACE(@D,@Choice,N'dbo.fn_PackagingTypeOrderAllowed(p.ID,CASE [key] WHEN ''PrimaryTypeID'' THEN ''Primary'' WHEN ''SecondaryTypeID'' THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(@ID))=1');
 SET @D=REPLACE(@D,@Final,N'dbo.fn_PackagingTypeOrderAllowed(t.ID,CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(i.ID))=1');
 SET @D=REPLACE(@D,N'-- Shipping final request.',N'-- Mix parent packaging orders.
 -- Shipping final request.');
 SET @D=REPLACE(@D,N'Choose an active top-level Packaging Type with the matching Order.',N'Choose an active top-level Packaging Type: Secondary/Tertiary for mix parents, matching order for other Products.');
 SET @D=REPLACE(@D,N'The final packaging layer requires a Shipping type in the matching order.',N'The final packaging layer requires an eligible Shipping type.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Mix parent response logistics.',@D)=0
 THROW 52993,'Apply migration 86 response validation first.',1;
IF CHARINDEX(N'-- Mix parent packaging orders.',@D)=0 BEGIN
 DECLARE @Choice NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=v.PackagingOrder)',
  @Final NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)';
 IF CHARINDEX(@Choice,@D)=0 OR CHARINDEX(@Final,@D)=0
  THROW 52993,'Unexpected response type validation signature.',1;
 SET @D=REPLACE(@D,@Choice,N'dbo.fn_PackagingTypeOrderAllowed(dbo.PackagingType.ID,v.PackagingOrder,(SELECT dbo.fn_OpportunityIsMixParent(OpportunityItemID) FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID))=1');
 SET @D=REPLACE(@D,@Final,N'dbo.fn_PackagingTypeOrderAllowed(t.ID,CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(i.OpportunityItemID))=1');
 SET @D=REPLACE(@D,N'-- Shipping final response.',N'-- Mix parent packaging orders.
 -- Shipping final response.');
 SET @D=REPLACE(@D,N'Choose an active Primary, Secondary or Tertiary Type in the matching Packaging Type Master order.',N'Choose an active top-level Packaging Type: Secondary/Tertiary for mix parents, matching order for other Products.');
 SET @D=REPLACE(@D,N'The final packaging layer requires a Shipping type in the matching order.',N'The final packaging layer requires an eligible Shipping type.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PkgPricing_Save'));
IF @D IS NULL THROW 52993,'Pricing save procedure is missing.',1;
IF CHARINDEX(N'fn_PackagingTypeOrderAllowed',@D)=0 BEGIN
 DECLARE @Choice NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=@Order)';
 IF CHARINDEX(@Choice,@D)=0 THROW 52993,'Unexpected pricing type validation signature.',1;
 SET @D=REPLACE(@D,@Choice,N'dbo.fn_PackagingTypeOrderAllowed(dbo.PackagingType.ID,@Order,(SELECT dbo.fn_OpportunityIsMixParent(OpportunityItemID) FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID))=1');
 SET @D=REPLACE(@D,N'Choose an active Packaging Type in the matching order.',N'Choose an active Packaging Type: Secondary/Tertiary for mix parents, matching order for other Products.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
-- END MIGRATION 87_mix_packaging_type_orders.sql

-- BEGIN MIGRATION 88_mix_same_config.sql
PRINT N'Applying 88_mix_same_config.sql';
GO
-- After 87. A saved UI linkage, without altering requests, prices or master data.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.fn_OpportunityIsMixParent') IS NULL
 OR COL_LENGTH('dbo.PackagingConfigurationRequestItem','ProductMixSnapshot') IS NULL
 THROW 52994,'Apply migrations through 87 before Same config.',1;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SameConfig') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SameConfig BIT NOT NULL
 CONSTRAINT DF_PCRItem_SameConfig DEFAULT(0) WITH VALUES;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Mix parent response logistics.',@D)=0
 THROW 52994,'Mix response validation is missing.',1;
IF CHARINDEX(N'-- Mix Same config.',@D)=0 BEGIN
 IF CHARINDEX(N'WHERE [key] NOT IN(',@D)=0 OR CHARINDEX(N'UPDATE t SET',@D)=0
  THROW 52994,'Unexpected response fields signature.',1;
 SET @D=REPLACE(@D,N'WHERE [key] NOT IN(',N'WHERE [key] NOT IN(''SameConfig'',');
 SET @D=REPLACE(@D,N'-- Mix parent response logistics.',N'-- Mix Same config.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SameConfig'')
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem
    WHERE ID=@ID AND dbo.fn_OpportunityIsMixParent(OpportunityItemID)=1)
   THROW 52994,''Same config applies only to a Mix Product parent response.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SameConfig'' AND [type]<>3)
   THROW 52994,''Same config must be true or false.'',1;
 END;
 -- Mix parent response logistics.');
 SET @D=REPLACE(@D,N'UPDATE t SET',N'UPDATE t SET
 SameConfig=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SameConfig'')
 THEN CASE WHEN JSON_VALUE(@Fields,''$.SameConfig'')=''true'' THEN 1 ELSE 0 END ELSE t.SameConfig END,');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL THROW 52994,'Response change log trigger is missing.',1;
IF CHARINDEX(N'''SameConfig''',@D)=0 BEGIN
 IF CHARINDEX(N'(''SelectedContainerType''',@D)=0
  THROW 52994,'Unexpected response change log signature.',1;
 SET @D=REPLACE(@D,N'(''SelectedContainerType''',N'(''SameConfig'',CONVERT(NVARCHAR(MAX),d.SameConfig),CONVERT(NVARCHAR(MAX),i.SameConfig),1),
 (''SelectedContainerType''');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
-- END MIGRATION 88_mix_same_config.sql
-- VERIFY UPGRADE
IF @@TRANCOUNT<>0
 THROW 52995,'Unexpected open transaction after VM upgrade; investigate before restarting the API.',1;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ProductMixSnapshot') IS NULL
 OR COL_LENGTH('dbo.PackagingConfigurationRequestItem','SameConfig') IS NULL
 OR OBJECT_ID('dbo.v_OpportunityMixStructure','V') IS NULL
 OR OBJECT_ID('dbo.fn_PackagingTypeOrderAllowed','FN') IS NULL
 OR CHARINDEX(N'-- Mix Same config.',
    COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),N''))=0
 OR CHARINDEX(N'''SameConfig''',
    COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog')),N''))=0
 THROW 52995,'Upgrade verification failed. Do not start the new API until resolved.',1;
PRINT N'PythonBridge migrations 86-88 complete. Deploy matching core and webapp/dist, then restart the API.';
GO
