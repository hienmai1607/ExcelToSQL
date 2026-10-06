USE [test];
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
