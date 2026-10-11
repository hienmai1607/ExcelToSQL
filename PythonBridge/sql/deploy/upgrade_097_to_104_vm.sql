:on error exit
/*
PythonBridge VM upgrade: migrations 97-104, generated 2026-10-11.
Existing application database only; apply migrations through 96 first.
Back up the database and stop the API before executing.
SSMS: select the application database and enable Query > SQLCMD Mode.
sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i upgrade_097_to_104_vm.sql
No external includes, credentials, local USE directives or sample records.
Source transaction boundaries are preserved. This upgrade is NOT atomic;
earlier committed changes remain if a later batch fails. Stop and investigate.
Existing Users, UserAccess, business records and historical snapshots are retained.
Migration 101 rebuilds a derived computed column, not stored historical values.
Deploy matching core/, webapp/dist/ and templates/ together before restarting.
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
 THROW 52956,'Select the existing PythonBridge application database, not a system database.',1;
IF @@TRANCOUNT<>0
 THROW 52956,'Run this upgrade on a new connection without an existing transaction.',1;
IF (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID())<130
 THROW 52956,'PythonBridge requires database compatibility level 130 or higher.',1;
IF COL_LENGTH('dbo.OpportunityItem','TCBCostInfo') IS NULL
 OR COL_LENGTH('dbo.OpportunityItem','ShipmentCostInfo') IS NULL
 OR OBJECT_ID('dbo.LossProcessMaster','U') IS NULL
 OR CHARINDEX(N'DirectUSDPerLb',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityTCB_Save')),N''))=0
 THROW 52956,'Apply migrations through 96 before this upgrade; it is not a fresh-install script.',1;
PRINT N'Applying PythonBridge migrations 97-104 to '+QUOTENAME(DB_NAME());
GO
-- BEGIN MIGRATION 97_product_category_master.sql
PRINT N'Applying 97_product_category_master.sql';
GO
-- Apply after 96 in the intended application database.
-- Additive migration: preserves Product.Category strings, IDs and history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.Product','U') IS NULL OR COL_LENGTH('dbo.Product','Category') IS NULL
 OR OBJECT_ID('dbo.Users','U') IS NULL OR OBJECT_ID('dbo.UserAccess','U') IS NULL
 THROW 52964,'Apply the existing Product migrations before Category Master.',1;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ProductCategory','U') IS NULL
BEGIN
 CREATE TABLE dbo.ProductCategory(
  ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductCategory PRIMARY KEY,
  CategoryName NVARCHAR(100) COLLATE Latin1_General_100_CI_AS NOT NULL,
  Status VARCHAR(10) NOT NULL CONSTRAINT DF_ProductCategory_Status DEFAULT 'Active',
  CreatedBy INT NULL CONSTRAINT FK_ProductCategory_CreatedBy REFERENCES dbo.Users(ID),
  CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_ProductCategory_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL CONSTRAINT FK_ProductCategory_UpdatedBy REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT UQ_ProductCategory_Name UNIQUE(CategoryName),
  CONSTRAINT CK_ProductCategory_Status CHECK(Status IN('Active','Block')),
  CONSTRAINT CK_ProductCategory_Name CHECK(LEN(LTRIM(RTRIM(CategoryName)))>0)
 );
END;
-- Seed legacy names only; rerunning must not reactivate blocked categories.
INSERT dbo.ProductCategory(CategoryName)
 SELECT MIN(LTRIM(RTRIM(p.Category)) COLLATE Latin1_General_100_CI_AS)
 FROM dbo.Product p
 WHERE NULLIF(LTRIM(RTRIM(p.Category)),N'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM dbo.ProductCategory c WITH(UPDLOCK,HOLDLOCK)
  WHERE c.CategoryName=LTRIM(RTRIM(p.Category)) COLLATE Latin1_General_100_CI_AS)
 GROUP BY LTRIM(RTRIM(p.Category)) COLLATE Latin1_General_100_CI_AS;
COMMIT;
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductCategory_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),
 @CategoryName NVARCHAR(100),@Status VARCHAR(10)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldName NVARCHAR(100);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain categories.',1;
 SET @CategoryName=LTRIM(RTRIM(@CategoryName));
 IF NULLIF(@CategoryName,N'') IS NULL OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 52964,'Enter a Category name and valid status.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  IF @ID IS NOT NULL
  BEGIN
   SELECT @OldName=CategoryName FROM dbo.ProductCategory WITH(UPDLOCK,HOLDLOCK)
    WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
   IF @OldName IS NULL THROW 52997,'Category changed. Refresh and retry.',1;
   IF @OldName COLLATE Latin1_General_100_BIN2<>@CategoryName COLLATE Latin1_General_100_BIN2
    AND EXISTS(SELECT 1 FROM dbo.Product WITH(HOLDLOCK)
      WHERE LTRIM(RTRIM(Category)) COLLATE Latin1_General_100_CI_AS=@OldName COLLATE Latin1_General_100_CI_AS)
    THROW 52964,'This Category is used by Products. Create a new Category instead of renaming it.',1;
  END;
  IF EXISTS(SELECT 1 FROM dbo.ProductCategory WITH(UPDLOCK,HOLDLOCK)
    WHERE CategoryName=@CategoryName COLLATE Latin1_General_100_CI_AS AND (@ID IS NULL OR ID<>@ID))
   THROW 52964,'That Category name already exists.',1;
  IF @ID IS NULL
  BEGIN
   INSERT dbo.ProductCategory(CategoryName,Status,CreatedBy) VALUES(@CategoryName,@Status,@Actor);
   SET @ID=CONVERT(INT,SCOPE_IDENTITY());
  END ELSE
   UPDATE dbo.ProductCategory SET CategoryName=@CategoryName,Status=@Status,
    UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
  COMMIT;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK;
  THROW;
 END CATCH;
 SELECT ID,CategoryName,Status,RowVersion FROM dbo.ProductCategory WHERE ID=@ID;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_Product_CategoryMaster ON dbo.Product AFTER INSERT,UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 -- Base Product inserts initially have NULL Category; enriched batch writes it
 -- in the same transaction. Blank legacy values may remain unchanged.
 IF NOT UPDATE(Category) RETURN;
 IF EXISTS(
  SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  WHERE NULLIF(LTRIM(RTRIM(i.Category)),N'') IS NOT NULL
   AND (d.ID IS NULL OR ISNULL(LTRIM(RTRIM(i.Category)),N'') COLLATE Latin1_General_100_CI_AS
     <>ISNULL(LTRIM(RTRIM(d.Category)),N'') COLLATE Latin1_General_100_CI_AS)
   AND NOT EXISTS(SELECT 1 FROM dbo.ProductCategory c WITH(HOLDLOCK)
     WHERE c.CategoryName=LTRIM(RTRIM(i.Category)) COLLATE Latin1_General_100_CI_AS AND c.Status='Active')
 )
  THROW 52964,'Choose an active Category from Category Master.',1;
END;
GO
-- END MIGRATION 97_product_category_master.sql
GO
-- BEGIN MIGRATION 98_required_container_type_pallet.sql
PRINT N'Applying 98_required_container_type_pallet.sql';
GO
-- After 97. Run in the intended application database, stopping on errors.
-- Retain legacy families and existing PCR snapshots; new requests use exact types.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Shipment cost information.',@D)=0
 THROW 52957,'Apply migrations through 97 before the Container Type upgrade.',1;
IF CHARINDEX(N'-- Required parent Container Type and Pallet size.',@D)=0
BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'(j.[key]=''ContainerRequest'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Dry'',N''Reefer'',N''Both''))';
 IF CHARINDEX(@Old,@D)=0 OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT',@D)=0
  THROW 52957,'Unexpected Opportunity field validation signature.',1;
 SET @D=REPLACE(@D,@Old,N'(j.[key]=''ContainerRequest'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Dry'',N''Reefer'',N''Both'',N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC''))');
 SET @D=REPLACE(@D,N'EXEC dbo.usp_OpportunityShipment_Validate @ID,@Shipment;',N'EXEC dbo.usp_OpportunityShipment_Validate @ID,@Shipment,@RequestedType;'); SET @D=REPLACE(@D,N'PalletSize=CASE WHEN @Web=1 AND @Configuration=''Floor load'' THEN NULL WHEN',N'PalletSize=CASE WHEN');
 SET @D=REPLACE(@D,N'-- Shipment cost information.',N'-- Required parent Container Type and Pallet size.
 DECLARE @RequestedType NVARCHAR(200),@RequiredPallet NVARCHAR(100);
 SELECT @RequestedType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ContainerRequest'')
  THEN JSON_VALUE(@Fields,''$.ContainerRequest'') ELSE ContainerRequest END,
  @RequiredPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''PalletSize'')
  THEN JSON_VALUE(@Fields,''$.PalletSize'') ELSE PalletSize END
 FROM dbo.OpportunityItem WHERE ID=@ID;
 IF (@IsCreate=1 OR @Web=1) AND EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NULL)
 BEGIN
  IF NULLIF(LTRIM(RTRIM(@RequiredPallet)),N'''') IS NULL
   THROW 52957,''Pallet size is required.'',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID
    WHERE p.PalletSize=@RequiredPallet AND p.Status=''Active'' AND u.Status=''Active'')
   AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND PalletSize=@RequiredPallet)
   THROW 52957,''Choose an active pallet size from Pallet Master.'',1;
  IF @RequestedType IS NULL OR @RequestedType COLLATE Latin1_General_100_BIN2 NOT IN(N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC'')
   THROW 52957,''Choose a required Container Type: 20DC, 20RC, 40DC, 40HC or 40RHC.'',1;
  -- Keep the legacy size snapshot consistent, without exposing a second input.
  DECLARE @TypeShipment NVARCHAR(MAX)=COALESCE(JSON_QUERY(@Fields,''$.ShipmentCostInfo''),
   (SELECT ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=@ID),N''{}'');
  SET @TypeShipment=JSON_MODIFY(@TypeShipment,''$.ContainerSizeFT'',LEFT(@RequestedType,2)+''FT'');
  SET @Fields=JSON_MODIFY(@Fields,''$.ShipmentCostInfo'',JSON_QUERY(@TypeShipment));
 END;
 -- Shipment cost information.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Container type profiles:',@D)=0
 THROW 52961,'Container response validation is missing.',1;
IF CHARINDEX(N'-- Exact requested container type.',@D)=0
BEGIN
 DECLARE @Anchor NVARCHAR(MAX)=N' IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ContainerLoadProfiles'' AND [type] NOT IN(0,5))';
 IF CHARINDEX(@Anchor,@D)=0 THROW 52961,'Unexpected response container profile signature.',1;
 SET @D=REPLACE(@D,@Anchor,N' -- Exact requested container type.
 IF @ContainerFamily COLLATE Latin1_General_100_BIN2 IN(N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC'')
 BEGIN
  IF @ContainerType IS NOT NULL AND @ContainerType COLLATE Latin1_General_100_BIN2<>@ContainerFamily COLLATE Latin1_General_100_BIN2
   THROW 52961,''Container type must match the exact requested Container Type.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(JSON_QUERY(@Fields,''$.ContainerLoadProfiles''))
    WHERE [key] COLLATE Latin1_General_100_BIN2<>@ContainerFamily COLLATE Latin1_General_100_BIN2)
   THROW 52961,''Container profiles must match the exact requested Container Type.'',1;
 END;
'+@Anchor);
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
IF @D IS NULL THROW 52996,'Shipment validation is missing.',1;
IF CHARINDEX(N'-- Exact type size guard.',@D)=0
BEGIN
 SET @D=REPLACE(@D,N'@ID INT,@Value NVARCHAR(MAX)',N'@ID INT,@Value NVARCHAR(MAX),@RequestedContainerType NVARCHAR(200)=NULL'); SET @D=REPLACE(@D,N' DECLARE @Port INT=',N' -- Exact type size guard.
 DECLARE @ExactType NVARCHAR(200)=COALESCE(@RequestedContainerType,(SELECT ContainerRequest FROM dbo.OpportunityItem WHERE ID=@ID));
 IF @ExactType IN(N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC'')
  AND JSON_VALUE(@Value,''$.ContainerSizeFT'') IS NOT NULL
  AND JSON_VALUE(@Value,''$.ContainerSizeFT'')<>LEFT(@ExactType,2)+''FT''
  THROW 52996,''Container size must match the requested Container Type.'',1;
 DECLARE @Port INT=');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
-- END MIGRATION 98_required_container_type_pallet.sql
GO
-- BEGIN MIGRATION 99_packaging_final_component.sql
PRINT N'Applying 99_packaging_final_component.sql';
GO
-- After 98. Run in the intended database, stopping on errors.
-- Explicit material-assignment eligibility; keep all saved pricing/PCR snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
-- The legacy hierarchy trigger must not reject flag-only edits because of unrelated old geometry.
DECLARE @Hierarchy NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingType_ShippingDimensions'));
IF @Hierarchy IS NOT NULL AND CHARINDEX(N'-- Actual hierarchy changes only.',@Hierarchy)=0
BEGIN
 DECLARE @OldHierarchy NVARCHAR(MAX)=N'IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t';
 IF CHARINDEX(@OldHierarchy,@Hierarchy)=0 THROW 52999,'Unexpected Packaging Type hierarchy trigger.',1;
 SET @Hierarchy=REPLACE(@Hierarchy,@OldHierarchy,N'-- Actual hierarchy changes only.
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID WHERE ISNULL(i.ParentTypeID,0)<>ISNULL(d.ParentTypeID,0))
 AND EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t');
 SET @Hierarchy=REPLACE(REPLACE(REPLACE(@Hierarchy,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @Hierarchy;
END;
IF COL_LENGTH('dbo.PackagingType','FinalComponent') IS NULL
BEGIN
 EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.tr_PackagingType_FormulaRoleScope
 ON dbo.PackagingType AFTER INSERT,UPDATE AS
 BEGIN
  SET NOCOUNT ON;
  DECLARE @Affected TABLE(ID INT PRIMARY KEY);
  ;WITH affected AS (
   SELECT i.ID FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
   WHERE ISNULL(i.ParentTypeID,0)<>ISNULL(d.ParentTypeID,0) OR i.Shipping<>ISNULL(d.Shipping,0)
   UNION ALL SELECT t.ID FROM dbo.PackagingType t JOIN affected a ON t.ParentTypeID=a.ID
  ) INSERT @Affected SELECT DISTINCT ID FROM affected OPTION(MAXRECURSION 100);
  IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
   JOIN @Affected a ON a.ID=t.ID
   WHERE (d.OccupiedM2Formula IS NOT NULL OR d.OccupiedM3Formula IS NOT NULL)
    AND (t.ParentTypeID IS NOT NULL OR t.RootShipping<>1))
   THROW 51111,''Clear occupied formulas before removing Shipping from their parent type.'',1;
 END;';
END;
IF COL_LENGTH('dbo.PackagingType','FinalComponent') IS NULL
BEGIN
 ALTER TABLE dbo.PackagingType ADD FinalComponent BIT NOT NULL
  CONSTRAINT DF_PackagingType_FinalComponent DEFAULT(0) WITH VALUES;
 -- Preserve the formerly eligible child leaves and historical leaf material assignments.
 EXEC sys.sp_executesql N'UPDATE t SET FinalComponent=1 FROM dbo.PackagingType t
 WHERE NOT EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=t.ID)
 AND (t.ParentTypeID IS NOT NULL OR EXISTS(SELECT 1 FROM dbo.PackagingMaterial m WHERE m.PackagingTypeID=t.ID));';
END;
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeWeb';
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeDimensionContext';
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF @D IS NULL OR CHARINDEX(N'-- Shipping root flag.',@D)=0
 THROW 52999,'Apply Packaging Type migrations through 98 first.',1;
IF CHARINDEX(N'-- Explicit final component.',@D)=0
BEGIN
 IF CHARINDEX(N'DECLARE @ChosenOrders TABLE',@D)=0 OR CHARINDEX(N'ParentTypeID=@Parent,Shipping=@Shipping,Status=@Status',@D)=0
  THROW 52999,'Unexpected Packaging Type procedure signature.',1;
 SET @D=REPLACE(@D,N'DECLARE @ChosenOrders TABLE',N'DECLARE @FinalComponent BIT,@FinalSet BIT;
 DECLARE @ChosenOrders TABLE');
 SET @D=REPLACE(@D,N'SET @Name=NULLIF',N'-- Explicit final component.
    SET @FinalSet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
     WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''FinalComponent'') THEN 1 ELSE 0 END;
    SET @FinalComponent=CASE WHEN @Parent IS NOT NULL THEN 1 ELSE 0 END;
    IF @FinalSet=1 BEGIN
     IF EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
      WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''FinalComponent'' AND j.[type]<>3)
      THROW 51111,''Final component must be True or False.'',1;
     SELECT @FinalComponent=CASE JSON_VALUE(r.value,''$.FinalComponent'') WHEN ''true'' THEN 1 ELSE 0 END
      FROM OPENJSON(@Rows) r WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row;
    END ELSE IF @Cmd=''U'' SELECT @FinalComponent=FinalComponent FROM dbo.PackagingType WHERE ID=@ID;
    IF @FinalComponent=1 AND EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ParentTypeID=@ID)
     THROW 51111,''A Final component cannot have child Packaging Types.'',1;
    IF @Cmd=''U'' AND @FinalComponent=0 AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND FinalComponent=1)
     AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK) WHERE PackagingTypeID=@ID)
     THROW 51111,''Remove Material assignments before clearing Final component.'',1;
    IF @Parent IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Parent AND FinalComponent=1)
     THROW 51111,''A Final component cannot be selected as Parent Type.'',1;
    -- Price Basis is retired from entry; preserve legacy values and default new types to Count.
    IF @Basis IS NULL BEGIN
     IF @Cmd=''U'' SELECT @Basis=PriceBasis FROM dbo.PackagingType WHERE ID=@ID;
     ELSE SET @Basis=N''Count'';
    END;
    SET @Name=NULLIF');
 SET @D=REPLACE(@D,N'ParentTypeID,Shipping)',N'ParentTypeID,Shipping,FinalComponent)');
 SET @D=REPLACE(@D,N'@Parent,@Shipping)',N'@Parent,@Shipping,@FinalComponent)');
 SET @D=REPLACE(@D,N'ParentTypeID=@Parent,Shipping=@Shipping,Status=@Status',N'ParentTypeID=@Parent,Shipping=@Shipping,FinalComponent=@FinalComponent,Status=@Status');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingMaterial_BatchV2'));
IF @D IS NULL OR CHARINDEX(N'-- Material child-only assignments.',@D)=0
 THROW 52999,'Apply Packaging Material migration 75 first.',1;
IF CHARINDEX(N'-- Material final-component assignments.',@D)=0
BEGIN
 IF CHARINDEX(N't.ID=@TypeID AND t.ParentTypeID IS NOT NULL',@D)=0
  THROW 52999,'Unexpected Material procedure signature.',1;
 SET @D=REPLACE(@D,N'-- Material child-only assignments.',N'-- Material final-component assignments.
                -- Material child-only assignments.');
 SET @D=REPLACE(@D,N't.ID=@TypeID AND t.ParentTypeID IS NOT NULL',N't.ID=@TypeID AND t.FinalComponent=1');
 SET @D=REPLACE(@D,N'Choose an active child Packaging Type with no children.',N'Choose an active Final component Packaging Type with no children.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_FinalComponent
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.PackagingType c WITH(UPDLOCK,HOLDLOCK) ON c.ParentTypeID=i.ID WHERE i.FinalComponent=1)
 OR EXISTS(SELECT 1 FROM inserted i JOIN dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK) ON p.ID=i.ParentTypeID WHERE p.FinalComponent=1)
  THROW 51111,'Final components cannot have child Packaging Types.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID JOIN dbo.PackagingMaterial m WITH(UPDLOCK,HOLDLOCK) ON m.PackagingTypeID=i.ID
  WHERE d.FinalComponent=1 AND i.FinalComponent=0)
  THROW 51111,'Remove Material assignments before clearing Final component.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingMaterial_FinalComponent
ON dbo.PackagingMaterial AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  JOIN dbo.PackagingType t WITH(UPDLOCK,HOLDLOCK) ON t.ID=i.PackagingTypeID
  WHERE (d.ID IS NULL OR ISNULL(d.PackagingTypeID,0)<>i.PackagingTypeID)
   AND (t.FinalComponent=0 OR t.Status<>'Active' OR EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=t.ID)))
  THROW 51111,'Materials require an active Final component Packaging Type with no children.',1;
END;
GO
COMMIT;
GO
-- END MIGRATION 99_packaging_final_component.sql
GO
-- BEGIN MIGRATION 100_packaging_conversion_output_uom.sql
PRINT N'Applying 100_packaging_conversion_output_uom.sql';
GO
-- After 99. Shared output unit for both child conversion formulas.
-- Existing definitions retain NULL (legacy implicit units) and snapshots are untouched.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingDimension','ConversionOutputUoMID') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD ConversionOutputUoMID INT NULL;
IF OBJECT_ID('dbo.FK_PackagingDimension_ConversionOutputUoM','F') IS NULL
 ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT FK_PackagingDimension_ConversionOutputUoM
 FOREIGN KEY(ConversionOutputUoMID) REFERENCES dbo.UoM(ID);
EXEC sys.sp_refreshview N'dbo.v_PackagingDimensionWeb';
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_SaveV2'));
IF @D IS NULL OR CHARINDEX(N'@ConvertFromSupplierFormula NVARCHAR(200)=NULL',@D)=0
 THROW 52999,'Apply formula-role migration 80 and migrations through 99 first.',1;
IF CHARINDEX(N'-- Shared conversion output unit.',@D)=0
BEGIN
 IF CHARINDEX(N'SET @AllFormulas=',@D)=0 OR CHARINDEX(N'ConvertFromSupplierFormula=@ConvertFromSupplierFormula,',@D)=0
  THROW 52999,'Unexpected Packaging Dimension save signature.',1;
 SET @D=REPLACE(@D,N'@ConvertFromSupplierFormula NVARCHAR(200)=NULL',N'@ConvertFromSupplierFormula NVARCHAR(200)=NULL,
 @ConversionOutputUoMID INT=NULL,@ConversionOutputUoMSet BIT=0');
 SET @D=REPLACE(@D,N'SET @AllFormulas=',N'-- Shared conversion output unit.
 IF @ID IS NOT NULL AND @ConversionOutputUoMSet=0
  SELECT @ConversionOutputUoMID=ConversionOutputUoMID FROM dbo.PackagingDimension WHERE ID=@ID;
 IF @ConversionOutputUoMSet=1 AND @ConversionOutputUoMID IS NULL AND @Status=''Active''
  AND (@ConvertFromParentFormula IS NOT NULL OR @ConvertFromSupplierFormula IS NOT NULL)
  THROW 51111,''Choose the shared formula output UoM for both conversion formulas.'',1;
 IF @ConversionOutputUoMID IS NOT NULL AND @Root=@PackagingTypeID
  THROW 51111,''Shared output UoM applies only to child conversion formulas.'',1;
 IF @ConversionOutputUoMID IS NOT NULL AND @Status=''Active'' AND NOT EXISTS(
  SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE ID=@ConversionOutputUoMID AND Status=''Active'')
  THROW 51111,''Choose an active shared formula output UoM.'',1;
 SET @AllFormulas=');
 SET @D=REPLACE(@D,N'ConvertFromSupplierFormula,Status,CreatedBy)',N'ConvertFromSupplierFormula,ConversionOutputUoMID,Status,CreatedBy)');
 SET @D=REPLACE(@D,N'@ConvertFromSupplierFormula,@Status,@Actor)',N'@ConvertFromSupplierFormula,@ConversionOutputUoMID,@Status,@Actor)');
 SET @D=REPLACE(@D,N'ConvertFromSupplierFormula=@ConvertFromSupplierFormula,',N'ConvertFromSupplierFormula=@ConvertFromSupplierFormula,ConversionOutputUoMID=@ConversionOutputUoMID,');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Supplier prices cannot freshly select a definition with a blocked output unit.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingPrice_BatchV5'));
IF @D IS NULL THROW 52999,'Apply Packaging Supplier Pricing migration 80 first.',1;
IF CHARINDEX(N'-- Shared supplier output unit.',@D)=0
BEGIN
 IF CHARINDEX(N'AND d.ConvertFromSupplierFormula IS NOT NULL)',@D)=0
  THROW 52999,'Unexpected supplier formula validation signature.',1;
 SET @D=REPLACE(@D,N'AND d.ConvertFromSupplierFormula IS NOT NULL)',N'-- Shared supplier output unit.
                   AND (d.ConversionOutputUoMID IS NULL OR EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE ID=d.ConversionOutputUoMID AND Status=''Active''))
                   AND d.ConvertFromSupplierFormula IS NOT NULL)');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
-- END MIGRATION 100_packaging_conversion_output_uom.sql
GO
-- BEGIN MIGRATION 101_response_weight_loading_density.sql
PRINT N'Applying 101_response_weight_loading_density.sql';
GO
-- After 100. Applicable response weight and reusable exact grade density defaults.
-- Historical product snapshots and retired loading columns are preserved.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ApplicableNetWeightGrams') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ApplicableNetWeightGrams DECIMAL(18,6) NULL
 CONSTRAINT CK_PCRItem_ApplicableWeight CHECK(ApplicableNetWeightGrams>=0);
IF EXISTS(SELECT 1 FROM sys.computed_columns WHERE object_id=OBJECT_ID('dbo.PackagingConfigurationRequestItem')
 AND name='UsedVolumeML' AND definition NOT LIKE '%ApplicableNetWeightGrams%')
BEGIN
 ALTER TABLE dbo.PackagingConfigurationRequestItem DROP COLUMN UsedVolumeML;
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD UsedVolumeML AS
 CONVERT(DECIMAL(28,6),COALESCE(ApplicableNetWeightGrams,WeightGrams)/NULLIF(NutDensity,0));
END;
IF OBJECT_ID('dbo.NutGradeDensity','U') IS NULL
 CREATE TABLE dbo.NutGradeDensity(
 ID INT IDENTITY PRIMARY KEY, CombinationHash CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL UNIQUE,
 CombinationJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(CombinationJSON)=1),
 NutDensity DECIMAL(18,6) NOT NULL CHECK(NutDensity>0),
 SourceResponseItemID INT NULL,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
 UpdatedAt DATETIME2 NULL,UpdatedBy INT NULL REFERENCES dbo.Users(ID),RowVersion ROWVERSION);
IF OBJECT_ID('dbo.NutGradeDensityHistory','U') IS NULL
 CREATE TABLE dbo.NutGradeDensityHistory(
 ID BIGINT IDENTITY PRIMARY KEY,DensityID INT NOT NULL REFERENCES dbo.NutGradeDensity(ID),
 OldDensity DECIMAL(18,6) NULL,NewDensity DECIMAL(18,6) NOT NULL,
 ResponseItemID INT NOT NULL,ChangedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 ChangedBy INT NOT NULL REFERENCES dbo.Users(ID));
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL THROW 52999,'Apply migrations through 100 first.',1;
IF CHARINDEX(N'-- Applicable response weight.',@D)=0
BEGIN
 SET @D=REPLACE(@D,CHAR(13),N'');
 IF CHARINDEX(N'WHERE [key] NOT IN(''SameConfig''',@D)=0 OR CHARINDEX(N'HeightMM DECIMAL(12,2)) j',@D)=0
  THROW 52999,'Unexpected response fields implementation.',1;
 SET @D=REPLACE(@D,N'WHERE [key] NOT IN(''SameConfig''',N'WHERE [key] NOT IN(''ApplicableNetWeightGrams'',''SameConfig''');
 SET @D=REPLACE(@D,N'-- Response pallet specifications',N'-- Applicable response weight.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ApplicableNetWeightGrams'' AND [type]<>0
 AND ([type] NOT IN(1,2) OR TRY_CONVERT(DECIMAL(18,6),[value]) IS NULL OR TRY_CONVERT(DECIMAL(18,6),[value])<0))
 THROW 52961,''Applicable net weight must be non-negative grams with up to six decimals.'',1;
 -- Response pallet specifications');
 SET @D=REPLACE(@D,N'HeightMM DECIMAL(12,2)) j',N'HeightMM DECIMAL(12,2),ApplicableNetWeightGrams DECIMAL(18,6)) j');
 SET @D=REPLACE(@D,N'NutDensity=CASE',N'ApplicableNetWeightGrams=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ApplicableNetWeightGrams'') THEN j.ApplicableNetWeightGrams ELSE t.ApplicableNetWeightGrams END,
 NutDensity=CASE');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingResponse_ApplicableWeight_Audit
ON dbo.PackagingConfigurationRequestItem AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason,IsResponse)
 SELECT COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID()),
 i.RequestID,'Item',i.ID,i.ProductCode,'Update','ApplicableNetWeightGrams',
 CONVERT(NVARCHAR(MAX),d.ApplicableNetWeightGrams),CONVERT(NVARCHAR(MAX),i.ApplicableNetWeightGrams),
 COALESCE(CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'PackagingChangeUser')),ORIGINAL_LOGIN()),
 COALESCE(CONVERT(VARCHAR(20),SESSION_CONTEXT(N'PackagingChangeSource')),'Database'),
 CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason')),1
 FROM inserted i JOIN deleted d ON d.ID=i.ID
 WHERE i.ApplicableNetWeightGrams<>d.ApplicableNetWeightGrams
 OR i.ApplicableNetWeightGrams IS NULL AND d.ApplicableNetWeightGrams IS NOT NULL
 OR i.ApplicableNetWeightGrams IS NOT NULL AND d.ApplicableNetWeightGrams IS NULL;
END;
GO
COMMIT;
GO
-- END MIGRATION 101_response_weight_loading_density.sql
GO
-- BEGIN MIGRATION 102_shipment_cost_units.sql
PRINT N'Applying 102_shipment_cost_units.sql';
GO
-- After 101. Select the intended application database. No saved costs are reinterpreted.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
IF @D IS NULL THROW 52996,'Apply migration 89 first.',1;
IF CHARINDEX(N'-- Shipment revised units.',@D)=0
BEGIN
 SET @D=REPLACE(@D,CHAR(13),N'');
 SET @D=REPLACE(@D,N'[key] NOT IN(''Incoterm''',N'[key] NOT IN(''FloorLoadUSDPerMT'',''ImportClearanceCustomerPerPallet'',''InterestDays'',''PaymentTermDays'',''MarginUSDPerLb'',''MarginMode'',''Incoterm''');
 SET @D=REPLACE(@D,N'[key] IN(''FreightUSDPerContainer''',N'[key] IN(''FloorLoadUSDPerMT'',''ImportClearanceCustomerPerPallet'',''InterestDays'',''PaymentTermDays'',''MarginUSDPerLb'',''FreightUSDPerContainer''');
 SET @D=REPLACE(@D,N'[key]=''InterestMonths''',N'[key] IN(''InterestMonths'',''InterestDays'',''PaymentTermDays'')');
 SET @D=REPLACE(@D,N'DECLARE @Port INT',N'-- Shipment revised units.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key]=''MarginMode'' AND [type]<>0 AND ([type]<>1 OR [value] NOT IN(''Percent'',''USDPerLb'')))
 THROW 52996,''Choose a valid Margin basis.'',1;
 IF JSON_VALUE(@Value,''$.MarginPct'') IS NOT NULL AND JSON_VALUE(@Value,''$.MarginUSDPerLb'') IS NOT NULL
 OR JSON_VALUE(@Value,''$.MarginMode'')=''Percent'' AND JSON_VALUE(@Value,''$.MarginUSDPerLb'') IS NOT NULL
 OR JSON_VALUE(@Value,''$.MarginMode'')=''USDPerLb'' AND JSON_VALUE(@Value,''$.MarginPct'') IS NOT NULL
 THROW 52996,''Choose one Margin basis with its matching value.'',1;
 DECLARE @Port INT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT TRANSACTION;
GO
-- END MIGRATION 102_shipment_cost_units.sql
GO
-- BEGIN MIGRATION 103_pallet_price.sql
PRINT N'Applying 103_pallet_price.sql';
GO
-- After 102. Select the application database. No price backfill.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Pallet','PalletPriceUSDPerEA') IS NULL
 ALTER TABLE dbo.Pallet ADD PalletPriceUSDPerEA DECIMAL(19,2) NULL
 CONSTRAINT CK_Pallet_Price CHECK(PalletPriceUSDPerEA IS NULL OR PalletPriceUSDPerEA>=0);
GO
EXEC sys.sp_refreshview N'dbo.v_PalletMaster';
GO
CREATE OR ALTER PROCEDURE dbo.usp_Pallet_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'['
  THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  UnitOfMeasure NVARCHAR(4000),WidthText NVARCHAR(100),LengthText NVARCHAR(100),Status VARCHAR(20),
  PalletsPer20DCText NVARCHAR(100),PalletsPer20DCSet BIT,
  PalletsPer40DCText NVARCHAR(100),PalletsPer40DCSet BIT,
  PalletsPer40HCText NVARCHAR(100),PalletsPer40HCSet BIT,
  PalletsPer20RCText NVARCHAR(100),PalletsPer20RCSet BIT,
  PalletsPer40RHCText NVARCHAR(100),PalletsPer40RHCSet BIT,PriceText NVARCHAR(100),PriceSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),
  UnitOfMeasure,Width,Length,Status,
  r.PalletsPer20DC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer20DC') THEN 1 ELSE 0 END),
  r.PalletsPer40DC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40DC') THEN 1 ELSE 0 END),
  r.PalletsPer40HC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40HC') THEN 1 ELSE 0 END),
  r.PalletsPer20RC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer20RC') THEN 1 ELSE 0 END),
  r.PalletsPer40RHC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40RHC') THEN 1 ELSE 0 END),r.PalletPriceUSDPerEA,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletPriceUSDPerEA') THEN 1 ELSE 0 END)
 FROM OPENJSON(@Rows) j CROSS APPLY OPENJSON(j.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,
  RowVersionHex VARCHAR(100),UnitOfMeasure NVARCHAR(4000),Width NVARCHAR(100),Length NVARCHAR(100),Status VARCHAR(20),
  PalletsPer20DC NVARCHAR(100),PalletsPer40DC NVARCHAR(100),PalletsPer40HC NVARCHAR(100),PalletsPer20RC NVARCHAR(100),PalletsPer40RHC NVARCHAR(100),PalletPriceUSDPerEA NVARCHAR(100)) r;
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Unit NVARCHAR(4000),
  @WText NVARCHAR(100),@LText NVARCHAR(100),@Status VARCHAR(20),@Own BIT,
  @UnitID INT,@W DECIMAL(12,4),@L DECIMAL(12,4),@Factor DECIMAL(24,9),@Area DECIMAL(38,8),
  @C0Text NVARCHAR(100),@C0Set BIT,@C0 INT,
  @C1Text NVARCHAR(100),@C1Set BIT,@C1 INT,
  @C2Text NVARCHAR(100),@C2Set BIT,@C2 INT,
  @C3Text NVARCHAR(100),@C3Set BIT,@C3 INT,
  @C4Text NVARCHAR(100),@C4Set BIT,@C4 INT,@PriceText NVARCHAR(100),@PriceSet BIT,@Price DECIMAL(19,2);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,UnitOfMeasure,WidthText,LengthText,Status,PalletsPer20DCText,PalletsPer20DCSet,PalletsPer40DCText,PalletsPer40DCSet,PalletsPer40HCText,PalletsPer40HCSet,PalletsPer20RCText,PalletsPer20RCSet,PalletsPer40RHCText,PalletsPer40RHCSet,PriceText,PriceSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status,@C0Text,@C0Set,@C1Text,@C1Set,@C2Text,@C2Set,@C3Text,@C3Set,@C4Text,@C4Set,@PriceText,@PriceSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END
   ELSE SAVE TRANSACTION PalletRow;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D')
    THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL)
    THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    SET @C0=TRY_CONVERT(INT,@C0Text);
    IF @C0Text IS NOT NULL AND (@C0 IS NULL OR @C0<0 OR LTRIM(RTRIM(@C0Text))='' OR @C0Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C0Set=0 SELECT @C0=PalletsPer20DC FROM dbo.Pallet WHERE ID=@ID;
    SET @C1=TRY_CONVERT(INT,@C1Text);
    IF @C1Text IS NOT NULL AND (@C1 IS NULL OR @C1<0 OR LTRIM(RTRIM(@C1Text))='' OR @C1Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C1Set=0 SELECT @C1=PalletsPer40DC FROM dbo.Pallet WHERE ID=@ID;
    SET @C2=TRY_CONVERT(INT,@C2Text);
    IF @C2Text IS NOT NULL AND (@C2 IS NULL OR @C2<0 OR LTRIM(RTRIM(@C2Text))='' OR @C2Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C2Set=0 SELECT @C2=PalletsPer40HC FROM dbo.Pallet WHERE ID=@ID;
    SET @C3=TRY_CONVERT(INT,@C3Text);
    IF @C3Text IS NOT NULL AND (@C3 IS NULL OR @C3<0 OR LTRIM(RTRIM(@C3Text))='' OR @C3Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C3Set=0 SELECT @C3=PalletsPer20RC FROM dbo.Pallet WHERE ID=@ID;
    SET @C4=TRY_CONVERT(INT,@C4Text);
    IF @C4Text IS NOT NULL AND (@C4 IS NULL OR @C4<0 OR LTRIM(RTRIM(@C4Text))='' OR @C4Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C4Set=0 SELECT @C4=PalletsPer40RHC FROM dbo.Pallet WHERE ID=@ID;
    SET @Price=TRY_CONVERT(DECIMAL(19,2),@PriceText);
    IF @PriceText IS NOT NULL AND (@Price IS NULL OR @Price<0 OR TRY_CONVERT(DECIMAL(38,18),@PriceText)<>@Price OR @PriceText LIKE '%[eE]%' OR LTRIM(RTRIM(@PriceText))='')
     THROW 51111,'Use nonnegative Pallet price USD with up to two decimals.',1;
    IF @Cmd='U' AND @PriceSet=0 SELECT @Price=PalletPriceUSDPerEA FROM dbo.Pallet WHERE ID=@ID;
    SET @UnitID=NULL; SET @Factor=NULL; SET @Area=NULL;
    SET @W=TRY_CONVERT(DECIMAL(12,4),@WText); SET @L=TRY_CONVERT(DECIMAL(12,4),@LText);
    IF @W IS NULL OR @L IS NULL OR @W<=0 OR @L<=0
     OR TRY_CONVERT(DECIMAL(38,18),@WText)<>@W OR TRY_CONVERT(DECIMAL(38,18),@LText)<>@L
     THROW 51111,'Width and Length must be positive, with at most 8 whole digits and 4 decimals.',1;
    IF @Status IS NULL AND @Cmd='U' SELECT @Status=Status FROM dbo.Pallet WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    SELECT @UnitID=ID FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=LTRIM(RTRIM(@Unit))
     AND (Status='Active' OR (@Status='Block' AND @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.Pallet WHERE ID=@ID AND UoMID=dbo.UoM.ID)));
    IF @UnitID IS NULL THROW 51111,'Choose an active UoM from UoM Master.',1;
    IF @Status='Active'
    BEGIN
     -- Lock the reference rows until this record is saved.
     SELECT @Factor=CASE WHEN u.UoMCode=N'MM' THEN CONVERT(DECIMAL(24,9),1) ELSE cv.Factor END
     FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
     LEFT JOIN dbo.UoM mm WITH(UPDLOCK,HOLDLOCK) ON mm.UoMCode=N'MM' AND mm.Status='Active'
     LEFT JOIN dbo.UnitConversion cv WITH(UPDLOCK,HOLDLOCK)
      ON cv.FromUoMID=u.ID AND cv.ToUoMID=mm.ID AND cv.Status='Active'
      AND cv.PackagingMaterialID IS NULL AND cv.RawMaterialID IS NULL AND cv.VendorID IS NULL
     WHERE u.ID=@UnitID AND u.Status='Active';
     IF @Factor IS NULL THROW 51111,'Admin must maintain an active general conversion from this UoM to MM.',1;
     SELECT @Area=PalletAreaMM2 FROM dbo.fn_PalletArea(@W,@L,@Factor);
     IF @Area IS NULL OR @Area<=0 THROW 51111,'Converted dimensions or area are out of range.',1;
    END;
    IF EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE UoMID=@UnitID AND Width=@W AND Length=@L AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This pallet size already exists. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.Pallet(UoMID,Width,Length,Status,CreatedBy,PalletsPer20DC,PalletsPer40DC,PalletsPer40HC,PalletsPer20RC,PalletsPer40RHC,PalletPriceUSDPerEA)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
    VALUES(@UnitID,@W,@L,@Status,@Actor,@C0,@C1,@C2,@C3,@C4,@Price);
   ELSE IF @Cmd='D'
    UPDATE dbo.Pallet SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.Pallet SET UoMID=@UnitID,Width=@W,Length=@L,Status=@Status,PalletsPer20DC=@C0,PalletsPer40DC=@C1,PalletsPer40HC=@C2,PalletsPer20RC=@C3,PalletsPer40RHC=@C4,PalletPriceUSDPerEA=@Price,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PalletRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status,@C0Text,@C0Set,@C1Text,@C1Set,@C2Text,@C2Set,@C3Text,@C3Set,@C4Text,@C4Set,@PriceText,@PriceSet;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO


COMMIT TRANSACTION;
GO
-- END MIGRATION 103_pallet_price.sql
GO
-- BEGIN MIGRATION 104_administrator_workspace.sql
PRINT N'Applying 104_administrator_workspace.sql';
GO
-- Administrator workspace: roles supplement the existing UserAccess/SQL scopes.
-- Existing users and scopes are intentionally left unchanged.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.WorkspaceRole','U') IS NULL
 CREATE TABLE dbo.WorkspaceRole(
 ID INT IDENTITY PRIMARY KEY,RoleName NVARCHAR(100) NOT NULL UNIQUE,
 IsActive BIT NOT NULL DEFAULT(1),CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),UpdatedBy INT NULL REFERENCES dbo.Users(ID),
 UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION NOT NULL);
IF OBJECT_ID('dbo.WorkspaceRolePermission','U') IS NULL
 CREATE TABLE dbo.WorkspaceRolePermission(
 RoleID INT NOT NULL REFERENCES dbo.WorkspaceRole(ID),PageKey VARCHAR(40) NOT NULL,
 AccessLevel VARCHAR(10) NOT NULL CHECK(AccessLevel IN('none','display','edit')),
 PRIMARY KEY(RoleID,PageKey));
IF OBJECT_ID('dbo.WorkspaceUserRole','U') IS NULL
 CREATE TABLE dbo.WorkspaceUserRole(
 UserID INT NOT NULL REFERENCES dbo.Users(ID),RoleID INT NOT NULL REFERENCES dbo.WorkspaceRole(ID),
 PRIMARY KEY(UserID,RoleID));
-- Tracks only SQL scopes introduced by a workspace role (never direct access).
IF OBJECT_ID('dbo.WorkspaceRoleScope','U') IS NULL
 CREATE TABLE dbo.WorkspaceRoleScope(
 UserID INT NOT NULL REFERENCES dbo.Users(ID),Scope NVARCHAR(50) NOT NULL,
 PRIMARY KEY(UserID,Scope));
COMMIT TRANSACTION;

GO
CREATE OR ALTER FUNCTION dbo.fn_WorkspaceAccess(@UserID INT,@PageKey VARCHAR(40),@Edit BIT)
RETURNS BIT
AS
BEGIN
 DECLARE @Allowed BIT=0;
 IF EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@UserID AND IsActive=1)
 AND (EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@UserID AND Scope=N'Admin')
 OR EXISTS(SELECT 1 FROM dbo.WorkspaceUserRole ur JOIN dbo.WorkspaceRole r ON r.ID=ur.RoleID AND r.IsActive=1
 JOIN dbo.WorkspaceRolePermission p ON p.RoleID=r.ID
 WHERE ur.UserID=@UserID AND p.PageKey=@PageKey AND (p.AccessLevel='edit' OR (@Edit=0 AND p.AccessLevel='display'))))
 SET @Allowed=1;
 RETURN @Allowed;
END;
GO
-- Extend the four previously Admin-only workspace masters without granting
-- blanket Admin scope. Keep all existing validation and concurrency behavior.
DECLARE @Procedure SYSNAME,@Page VARCHAR(40),@Definition NVARCHAR(MAX),@Old NVARCHAR(MAX),@New NVARCHAR(MAX);
DECLARE master_auth CURSOR LOCAL FAST_FORWARD FOR SELECT * FROM (VALUES
 ('dbo.usp_ProductCategory_Save','categories'),('dbo.usp_LossProcessMaster_Save','loss-processes'),
 ('dbo.usp_PortOfEntry_Save','ports'),('dbo.usp_UoM_Batch','uoms')) v(ProcedureName,PageKey);
OPEN master_auth; FETCH NEXT FROM master_auth INTO @Procedure,@Page;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @Definition=OBJECT_DEFINITION(OBJECT_ID(@Procedure));
 IF @Definition IS NULL THROW 52996,'Required master procedure is missing. Apply earlier migrations first.',1;
 IF CHARINDEX('fn_WorkspaceAccess',@Definition)=0
 BEGIN
  IF @Page='uoms'
  BEGIN
   SET @Old=N'IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope=''Admin'')';
   SET @New=N'IF dbo.fn_WorkspaceAccess(@Actor,''uoms'',1)=0';
  END
  ELSE
  BEGIN
   SET @Old=N'WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope=''Admin'';';
   SET @New=N'WHERE u.UserName=@Username AND u.IsActive=1 AND dbo.fn_WorkspaceAccess(u.ID,'''+@Page+N''',1)=1;';
  END
  IF CHARINDEX(@Old,@Definition)=0 THROW 52996,'Unexpected master authorization definition; review migration before applying.',1;
  SET @Definition=REPLACE(@Definition,@Old,@New);
  SET @Definition=STUFF(@Definition,1,CHARINDEX(N'PROCEDURE',UPPER(@Definition))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @Definition;
 END;
 FETCH NEXT FROM master_auth INTO @Procedure,@Page;
END;
CLOSE master_auth;DEALLOCATE master_auth;
GO
-- END MIGRATION 104_administrator_workspace.sql
GO
-- VERIFY UPGRADE
IF @@TRANCOUNT<>0
 THROW 52956,'Upgrade left an open transaction. Stop and investigate.',1;
IF OBJECT_ID('dbo.ProductCategory','U') IS NULL
 OR OBJECT_ID('dbo.usp_ProductCategory_Save','P') IS NULL
 OR OBJECT_ID('dbo.tr_Product_CategoryMaster','TR') IS NULL
 OR COL_LENGTH('dbo.PackagingType','FinalComponent') IS NULL
 OR OBJECT_ID('dbo.tr_PackagingType_FinalComponent','TR') IS NULL
 OR OBJECT_ID('dbo.tr_PackagingMaterial_FinalComponent','TR') IS NULL
 OR COL_LENGTH('dbo.PackagingDimension','ConversionOutputUoMID') IS NULL
 OR OBJECT_ID('dbo.FK_PackagingDimension_ConversionOutputUoM','F') IS NULL
 OR COL_LENGTH('dbo.PackagingConfigurationRequestItem','ApplicableNetWeightGrams') IS NULL
 OR OBJECT_ID('dbo.NutGradeDensity','U') IS NULL
 OR OBJECT_ID('dbo.NutGradeDensityHistory','U') IS NULL
 OR OBJECT_ID('dbo.tr_PackagingResponse_ApplicableWeight_Audit','TR') IS NULL
 OR COL_LENGTH('dbo.Pallet','PalletPriceUSDPerEA') IS NULL
 OR OBJECT_ID('dbo.WorkspaceRole','U') IS NULL
 OR OBJECT_ID('dbo.WorkspaceRolePermission','U') IS NULL
 OR OBJECT_ID('dbo.WorkspaceUserRole','U') IS NULL
 OR OBJECT_ID('dbo.WorkspaceRoleScope','U') IS NULL
 OR OBJECT_ID('dbo.fn_WorkspaceAccess','FN') IS NULL
 THROW 52956,'Upgrade verification failed: required schema objects are missing.',1;
IF NOT EXISTS(SELECT 1 FROM sys.computed_columns
 WHERE object_id=OBJECT_ID('dbo.PackagingConfigurationRequestItem')
 AND name=N'UsedVolumeML' AND definition LIKE N'%ApplicableNetWeightGrams%')
 THROW 52956,'Upgrade verification failed: applicable response volume calculation is missing.',1;
IF NOT EXISTS(SELECT 1 FROM sys.columns
 WHERE object_id=OBJECT_ID('dbo.v_PalletMaster') AND name=N'PalletPriceUSDPerEA')
 OR NOT EXISTS(SELECT 1 FROM sys.parameters
 WHERE object_id=OBJECT_ID('dbo.usp_PackagingDimension_SaveV2') AND name=N'@ConversionOutputUoMID')
 THROW 52956,'Upgrade verification failed: updated view or conversion parameter is missing.',1;
IF CHARINDEX(N'-- Explicit final component.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch')),N''))=0
 OR CHARINDEX(N'-- Material final-component assignments.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingMaterial_BatchV2')),N''))=0
 OR CHARINDEX(N'-- Shared conversion output unit.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_SaveV2')),N''))=0
 OR CHARINDEX(N'-- Shared supplier output unit.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingPrice_BatchV5')),N''))=0
 OR CHARINDEX(N'-- Required parent Container Type and Pallet size.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save')),N''))=0
 OR CHARINDEX(N'-- Exact requested container type.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),N''))=0
 OR CHARINDEX(N'-- Applicable response weight.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),N''))=0
 OR CHARINDEX(N'-- Shipment revised units.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate')),N''))=0
 OR CHARINDEX(N'PalletPriceUSDPerEA',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_Pallet_Batch')),N''))=0
 THROW 52956,'Upgrade verification failed: updated save/validation definitions are missing.',1;
DECLARE @VerifyProcedure SYSNAME;
DECLARE master_auth_verify CURSOR LOCAL FAST_FORWARD FOR SELECT ProcedureName FROM (VALUES
 ('dbo.usp_ProductCategory_Save'),('dbo.usp_LossProcessMaster_Save'),
 ('dbo.usp_PortOfEntry_Save'),('dbo.usp_UoM_Batch')) v(ProcedureName);
OPEN master_auth_verify;
FETCH NEXT FROM master_auth_verify INTO @VerifyProcedure;
WHILE @@FETCH_STATUS=0
BEGIN
 IF CHARINDEX(N'fn_WorkspaceAccess',COALESCE(OBJECT_DEFINITION(OBJECT_ID(@VerifyProcedure)),N''))=0
  THROW 52956,'Upgrade verification failed: workspace master authorization is missing.',1;
 FETCH NEXT FROM master_auth_verify INTO @VerifyProcedure;
END;
CLOSE master_auth_verify;
DEALLOCATE master_auth_verify;
PRINT N'PythonBridge upgrade 97-104 verified. Deploy matching application files before restarting.';
GO
