:on error exit
/*
PythonBridge VM upgrade: migrations 105-116, generated 2026-10-15.
Existing application database already through migration 104 only.
Back up the database and stop the API before executing.
SSMS: select the application database and enable Query > SQLCMD Mode.
sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_105_to_116_vm.sql
No external includes, workstation USE directives, credentials or test fixtures.
Source transaction boundaries are preserved. This upgrade is NOT atomic:
earlier migrations can remain committed if a later migration fails.
Migration 110 additively copies legacy pallets to packaging materials/pricing;
legacy records and immutable response/plan history are retained.
Migrated pallet height and material tare require deliberate maintenance.
Deploy matching core/ and webapp/dist/ from the same release before restarting.
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
IF OBJECT_ID('dbo.WorkspaceRoleScope','U') IS NULL
 OR OBJECT_ID('dbo.fn_WorkspaceAccess','FN') IS NULL
 OR OBJECT_ID('dbo.PkgPricingMaster','U') IS NULL
 OR COL_LENGTH('dbo.PackagingType','FinalComponent') IS NULL
 OR COL_LENGTH('dbo.PackagingDimension','ConversionOutputUoMID') IS NULL
 OR COL_LENGTH('dbo.Pallet','PalletPriceUSDPerEA') IS NULL
 OR COL_LENGTH('dbo.PackagingConfigurationRequestItem','ApplicableNetWeightGrams') IS NULL
 THROW 52956,'Apply migrations through 104 first; this is not a fresh database installer.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode=N'EA' AND Status='Active')
 OR NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode=N'MM' AND Status='Active')
 OR NOT EXISTS(SELECT 1 FROM dbo.Currency WHERE CurrencyCode=N'USD')
 THROW 52956,'Maintain active EA/MM units and USD currency before this upgrade.',1;
PRINT N'Applying PythonBridge migrations 105-116 to '+QUOTENAME(DB_NAME());
GO
-- BEGIN MIGRATION 105_packaging_pic_ownership.sql
PRINT N'Applying 105_packaging_pic_ownership.sql';
GO
-- Apply after migration 104, in the application database.
-- No user/role records are changed. All definitions update atomically.
-- Persist safe module settings even when SQLCMD starts with them OFF.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.WorkspaceRoleScope','U') IS NULL
  OR OBJECT_ID('dbo.fn_WorkspaceAccess','FN') IS NULL
  THROW 52996,'Apply migration 104 before Packaging PIC ownership.',1;

 EXEC sys.sp_executesql N'
 CREATE OR ALTER FUNCTION dbo.fn_PackagingPICMember(@UserID INT)
 RETURNS BIT AS
 BEGIN
  DECLARE @Allowed BIT=0;
  IF EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@UserID AND IsActive=1)
  AND EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@UserID AND Scope=N''Packaging'')
  AND (dbo.fn_WorkspaceAccess(@UserID,''requests'',1)=1
   OR EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=@UserID AND a.Scope=N''Packaging''
    AND NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRoleScope d WHERE d.UserID=a.UserID AND d.Scope=a.Scope)))
   SET @Allowed=1;
  RETURN @Allowed;
 END;';
 EXEC sys.sp_executesql N'
 CREATE OR ALTER FUNCTION dbo.fn_PackagingManagerAccess(@UserID INT)
 RETURNS BIT AS
 BEGIN
  DECLARE @Allowed BIT=0;
  IF EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@UserID AND IsActive=1)
  AND (EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@UserID AND Scope=N''Admin'')
   OR EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=@UserID AND a.Scope=N''PackagingManager''
    AND NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRoleScope d WHERE d.UserID=a.UserID AND d.Scope=a.Scope)))
   SET @Allowed=1;
  RETURN @Allowed;
 END;';

 -- Patch existing audited implementations, preserving all later response fields,
 -- validation, transactions, optimistic concurrency, mix behavior and audit hooks.
 DECLARE @P SYSNAME,@Old NVARCHAR(MAX),@New NVARCHAR(MAX),@D NVARCHAR(MAX),@NeedsAlter BIT;
 DECLARE changes CURSOR LOCAL FAST_FORWARD FOR SELECT * FROM (VALUES
 (N'dbo.usp_Packaging_Authorize',
  N'(@Action=''Review'' AND Scope=N''PackagingManager'')',
  N'(@Action=''Review'' AND Scope=N''PackagingManager'' AND dbo.fn_PackagingManagerAccess(@ActorID)=1)'),
 (N'dbo.usp_PackagingRequestItem_Assign_AuditImplementation',
  N'a.Scope IN(N''Packaging'',N''Admin'')',
  N'a.Scope=N''Packaging'' AND dbo.fn_PackagingPICMember(u.ID)=1'),
 (N'dbo.usp_PackagingRequestItem_Assign_AuditImplementation',
  N'PIC must be active with Packaging or Admin access.',
  N'PIC must be an active Packaging member with Packaging Request edit access.'),
 (N'dbo.usp_PackagingResponse_Batch_AuditImplementation',
  N'(i.PICUserID=@ActorID OR @IsAdmin=1)',
  N'(i.PICUserID=@ActorID AND (@IsAdmin=1 OR dbo.fn_PackagingPICMember(@ActorID)=1))'),
 (N'dbo.usp_PackagingRequestItem_Transition_AuditImplementation',
  N'IF @IsAdmin=0 AND @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID)',
  N'IF @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID OR (@IsAdmin=0 AND dbo.fn_PackagingPICMember(@ActorID)=0))'),
 (N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation',
  N'(@Admin=1 OR PICUserID=@Actor)',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))'),
 (N'dbo.usp_PkgPricing_ItemAuthorize',
  N'(@Admin=1 OR PICUserID=@Actor)',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))'),
 (N'dbo.usp_PkgPricing_ItemAuthorize',
  N'Only the assigned PIC or Admin can save pricing on an unlocked item.',
  N'Only the assigned PIC can save pricing on an unlocked item.'),
 (N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation',
  N'Only the assigned PIC or Admin can edit an unlocked response.',
  N'Only the assigned PIC can edit an unlocked response.')
 ) v(ProcedureName,OldText,NewText);
 OPEN changes;
 FETCH NEXT FROM changes INTO @P,@Old,@New;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @D=OBJECT_DEFINITION(OBJECT_ID(@P));
  IF @D IS NULL THROW 52996,'Required Packaging procedure missing; apply earlier migrations.',1;
  SET @NeedsAlter=0;
  IF CHARINDEX(@New,@D)=0 AND CHARINDEX(N'-- Admin response ownership override (113)',@D)=0
  BEGIN
   IF CHARINDEX(@Old,@D)=0 THROW 52996,'Unexpected Packaging authorization definition; migration rolled back.',1;
   SET @D=REPLACE(@D,@Old,@New);
   SET @NeedsAlter=1;
  END;
  -- Reapplying also repairs previously captured OFF settings without
  -- changing the already-patched ownership rules or any business data.
  IF @NeedsAlter=1 OR EXISTS(SELECT 1 FROM sys.sql_modules
   WHERE object_id=OBJECT_ID(@P) AND (uses_quoted_identifier=0 OR uses_ansi_nulls=0))
  BEGIN
   SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
   EXEC sys.sp_executesql @D;
  END;
  FETCH NEXT FROM changes INTO @P,@Old,@New;
 END;
 CLOSE changes;
 DEALLOCATE changes;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
GO
-- END MIGRATION 105_packaging_pic_ownership.sql
GO
-- BEGIN MIGRATION 106_packaging_copy_dimensions.sql
PRINT N'Applying 106_packaging_copy_dimensions.sql';
GO
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
GO
-- END MIGRATION 106_packaging_copy_dimensions.sql
GO
-- BEGIN MIGRATION 107_packaging_copy_dim_root_only.sql
PRINT N'Applying 107_packaging_copy_dim_root_only.sql';
GO
-- After 106. Copy Dim. implies Single and no Parent Type.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.PackagingType','CopyDim') IS NULL
  THROW 52996,'Apply migration 106 first.',1;
 IF EXISTS(SELECT 1 FROM dbo.PackagingType WHERE CopyDim=1 AND (FinalComponent=0 OR ParentTypeID IS NOT NULL))
  THROW 52996,'Existing Copy Dim. types must be Single with no parent. Correct them before applying 107.',1;
 IF OBJECT_ID('dbo.CK_PackagingType_CopyDim','C') IS NOT NULL
  ALTER TABLE dbo.PackagingType DROP CONSTRAINT CK_PackagingType_CopyDim;
 ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_CopyDim
  CHECK(CopyDim=0 OR (FinalComponent=1 AND ParentTypeID IS NULL));
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
 IF @D IS NULL THROW 52996,'Packaging Type procedure is missing.',1;
 IF CHARINDEX(N'Copy Dim. requires Single with no parent.',@D)=0
 BEGIN
  DECLARE @Old NVARCHAR(MAX)=N'IF @CopyDim=1 AND @FinalComponent=0 THROW 51111,''Copy Dim. requires Single.'',1;';
  IF CHARINDEX(@Old,@D)=0 THROW 52996,'Unexpected Copy Dim. procedure; migration rolled back.',1;
  SET @D=REPLACE(@D,@Old,N'IF @CopyDim=1 AND (@FinalComponent=0 OR @Parent IS NOT NULL) THROW 51111,''Copy Dim. requires Single with no parent.'',1;');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
GO
-- END MIGRATION 107_packaging_copy_dim_root_only.sql
GO
-- BEGIN MIGRATION 108_container_load_plans.sql
PRINT N'Applying 108_container_load_plans.sql';
GO
-- Run after 107 in the application database. No historical responses are rewritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ContainerTypeMaster','U') IS NULL
 CREATE TABLE dbo.ContainerTypeMaster(
 ID INT IDENTITY PRIMARY KEY,Code NVARCHAR(30) NOT NULL UNIQUE,
 Family VARCHAR(10) NOT NULL CHECK(Family IN('Dry','Reefer')),
 SizeFT INT NOT NULL CHECK(SizeFT BETWEEN 1 AND 100),
 Specifications NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Specifications)=1),
 Status VARCHAR(10) NOT NULL CHECK(Status IN('Active','Block')),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION);
IF OBJECT_ID('dbo.ContainerLoadPlan','U') IS NULL
 CREATE TABLE dbo.ContainerLoadPlan(
 ID INT IDENTITY PRIMARY KEY,ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 ContainerID INT NOT NULL REFERENCES dbo.ContainerTypeMaster(ID),
 Inputs NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Inputs)=1),
 Result NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Result)=1),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.ContainerLoadPlan') AND name='IX_ContainerLoadPlan_Item')
 CREATE INDEX IX_ContainerLoadPlan_Item ON dbo.ContainerLoadPlan(ItemID,ID DESC);
COMMIT;
GO
-- END MIGRATION 108_container_load_plans.sql
GO
-- BEGIN MIGRATION 109_pallet_packaging_order.sql
PRINT N'Applying 109_pallet_packaging_order.sql';
GO
-- Pallet is an exclusive packaging use, separate from the three product layers.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.CK_PackagingType_Order','C') IS NOT NULL ALTER TABLE dbo.PackagingType DROP CONSTRAINT CK_PackagingType_Order;
ALTER TABLE dbo.PackagingType ADD CONSTRAINT CK_PackagingType_Order CHECK(PackagingOrder IN(N'Primary',N'Secondary',N'Tertiary',N'Pallet'));
IF OBJECT_ID('dbo.CK_PackagingTypeOrder_Order','C') IS NOT NULL ALTER TABLE dbo.PackagingTypeOrder DROP CONSTRAINT CK_PackagingTypeOrder_Order;
ALTER TABLE dbo.PackagingTypeOrder ADD CONSTRAINT CK_PackagingTypeOrder_Order CHECK(PackagingOrder IN(N'Primary',N'Secondary',N'Tertiary',N'Pallet'));
IF OBJECT_ID('dbo.CK_PackagingType_Pallet','C') IS NULL
 ALTER TABLE dbo.PackagingType ADD CONSTRAINT CK_PackagingType_Pallet CHECK(PackagingOrder<>N'Pallet' OR (ParentTypeID IS NULL AND FinalComponent=1 AND CopyDim=1 AND Shipping=0));
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF CHARINDEX(N'-- Pallet exclusive use',@D)=0
BEGIN
 IF CHARINDEX(N'IF @Basis IS NULL OR @Basis',@D)=0 THROW 52996,'Unexpected Packaging Type procedure.',1;
 SET @D=REPLACE(@D,N'NOT IN(N''Primary'',N''Secondary'',N''Tertiary'')',N'NOT IN(N''Primary'',N''Secondary'',N''Tertiary'',N''Pallet'')');
 SET @D=REPLACE(@D,N'IF @Basis IS NULL OR @Basis',N'-- Pallet exclusive use
    IF EXISTS(SELECT 1 FROM @ChosenOrders WHERE PackagingOrder=N''Pallet'')
      AND ((SELECT COUNT(*) FROM @ChosenOrders)<>1 OR @Parent IS NOT NULL OR @Shipping=1 OR @FinalComponent=0 OR @CopyDim=0)
      THROW 51111,''Pallet must be Single, Copy Dim., no parent, and have no other packaging orders or Shipping flag.'',1;
    IF @Parent IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@Parent AND PackagingOrder=N''Pallet'')
      THROW 51111,''A pallet cannot be a component parent.'',1;
    IF @Basis IS NULL OR @Basis');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
-- END MIGRATION 109_pallet_packaging_order.sql
GO
-- BEGIN MIGRATION 110_migrate_pallet_materials.sql
PRINT N'Applying 110_migrate_pallet_materials.sql';
GO
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
GO
-- END MIGRATION 110_migrate_pallet_materials.sql
GO
-- BEGIN MIGRATION 111_response_load_plan.sql
PRINT N'Applying 111_response_load_plan.sql';
GO
-- After 110. Existing responses retain their original calculations.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','LoadPlanID') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD LoadPlanID INT NULL REFERENCES dbo.ContainerLoadPlan(ID);
IF OBJECT_ID('dbo.ResponseLoadPlanHistory','U') IS NULL
 CREATE TABLE dbo.ResponseLoadPlanHistory(
 ID BIGINT IDENTITY PRIMARY KEY,ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 PreviousPlanID INT NULL,LoadPlanID INT NULL,ChangedBy INT NOT NULL REFERENCES dbo.Users(ID),
 ChangedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
-- END MIGRATION 111_response_load_plan.sql
GO
-- BEGIN MIGRATION 112_material_tare_weight.sql
PRINT N'Applying 112_material_tare_weight.sql';
GO
-- After 111. Tare is maintained on material, independently of vendor price.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingMaterial','TareWeight') IS NULL
 ALTER TABLE dbo.PackagingMaterial ADD TareWeight DECIMAL(18,9) NULL,TareWeightBasis VARCHAR(10) NULL;
EXEC(N'IF OBJECT_ID(''dbo.CK_PackagingMaterial_TareWeight'',''C'') IS NULL
 ALTER TABLE dbo.PackagingMaterial ADD CONSTRAINT CK_PackagingMaterial_TareWeight CHECK(
 (TareWeight IS NULL AND TareWeightBasis IS NULL) OR
 (TareWeight IS NOT NULL AND TareWeight>=0 AND TareWeightBasis IS NOT NULL AND TareWeightBasis IN(''kg/EA'',''kg/m2'')))');
COMMIT;
GO
-- END MIGRATION 112_material_tare_weight.sql
GO
-- BEGIN MIGRATION 113_admin_response_override.sql
PRINT N'Applying 113_admin_response_override.sql';
GO
-- After 112. Admin may respond without taking over the PIC assignment.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @OverrideP SYSNAME,@OverrideOld NVARCHAR(MAX),@OverrideNew NVARCHAR(MAX),@OverrideD NVARCHAR(MAX);
 DECLARE override_changes CURSOR LOCAL FAST_FORWARD FOR SELECT * FROM (VALUES
 (N'dbo.usp_PackagingResponse_Batch_AuditImplementation',
  N'(i.PICUserID=@ActorID AND (@IsAdmin=1 OR dbo.fn_PackagingPICMember(@ActorID)=1))',
  N'(@IsAdmin=1 OR (i.PICUserID=@ActorID AND dbo.fn_PackagingPICMember(@ActorID)=1))'),
 (N'dbo.usp_PackagingRequestItem_Transition_AuditImplementation',
  N'IF @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID OR (@IsAdmin=0 AND dbo.fn_PackagingPICMember(@ActorID)=0))',
  N'IF @IsAdmin=0 AND @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID OR dbo.fn_PackagingPICMember(@ActorID)=0)'),
 (N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))',
  N'(@Admin=1 OR (PICUserID=@Actor AND dbo.fn_PackagingPICMember(@Actor)=1))'),
 (N'dbo.usp_PkgPricing_ItemAuthorize',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))',
  N'(@Admin=1 OR (PICUserID=@Actor AND dbo.fn_PackagingPICMember(@Actor)=1))')
 ) v(ProcedureName,OldText,NewText);
 OPEN override_changes;
 FETCH NEXT FROM override_changes INTO @OverrideP,@OverrideOld,@OverrideNew;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @OverrideD=OBJECT_DEFINITION(OBJECT_ID(@OverrideP));
  IF @OverrideD IS NULL THROW 52996,'Apply earlier Packaging migrations first.',1;
  IF CHARINDEX(@OverrideNew,@OverrideD)=0
  BEGIN
   IF CHARINDEX(@OverrideOld,@OverrideD)=0 THROW 52996,'Unexpected Packaging authorization definition; migration rolled back.',1;
   SET @OverrideD=REPLACE(@OverrideD,@OverrideOld,@OverrideNew);
  END;
  SET @OverrideD=REPLACE(@OverrideD,N'Only the assigned PIC can',N'Only the assigned PIC or Admin can');
  IF CHARINDEX(N'-- Admin response ownership override (113)',@OverrideD)=0
   SET @OverrideD=@OverrideD+CHAR(10)+N'-- Admin response ownership override (113)';
  SET @OverrideD=STUFF(@OverrideD,1,CHARINDEX(N'PROCEDURE',UPPER(@OverrideD))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @OverrideD;
  FETCH NEXT FROM override_changes INTO @OverrideP,@OverrideOld,@OverrideNew;
 END;
 CLOSE override_changes;
 DEALLOCATE override_changes;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
GO
-- END MIGRATION 113_admin_response_override.sql
GO
-- BEGIN MIGRATION 114_pallet_dimension_choices.sql
PRINT N'Applying 114_pallet_dimension_choices.sql';
GO
-- After 113. Request footprint choices from current Pallet material dimensions.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC sys.sp_executesql N'
 CREATE OR ALTER VIEW dbo.v_PalletSizeChoice AS
 WITH Measurements AS (
  SELECT p.ID PriceID,m.ID MaterialID,
   MAX(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''length'' THEN TRY_CONVERT(DECIMAL(18,6),v.Value*CASE WHEN u.UoMCode=''mm'' THEN 1 ELSE c.Factor END) END) LengthMM,
   MAX(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''width'' THEN TRY_CONVERT(DECIMAL(18,6),v.Value*CASE WHEN u.UoMCode=''mm'' THEN 1 ELSE c.Factor END) END) WidthMM,
   SUM(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''length'' THEN 1 ELSE 0 END) LengthCount,
   SUM(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''width'' THEN 1 ELSE 0 END) WidthCount
  FROM dbo.PackagingPrice p
  JOIN dbo.PackagingMaterial m ON m.ID=p.MaterialID AND m.Status=''Active''
  JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID AND t.Status=''Active'' AND t.PackagingOrder=''Pallet''
  JOIN dbo.PackagingDimension d ON d.ID=p.MaterialDimensionID AND d.PackagingTypeID=t.ID AND d.Status=''Active'' AND d.RowVersion=p.MaterialDimensionRowVersion
  CROSS APPLY(VALUES(d.D1Name,p.MaterialD1,d.D1UoMID),(d.D2Name,p.MaterialD2,d.D2UoMID),(d.D3Name,p.MaterialD3,d.D3UoMID)) v(Name,Value,UnitID)
  JOIN dbo.UoM u ON u.ID=v.UnitID AND u.Status=''Active''
  OUTER APPLY dbo.fn_UnitConversion(u.UoMCode,N''mm'',NULL,NULL,NULL) c
  LEFT JOIN dbo.Vendor vendor ON vendor.ID=p.VendorID
  WHERE p.Status=''Active'' AND p.EffectiveFrom<=CONVERT(DATE,SYSUTCDATETIME())
   AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=CONVERT(DATE,SYSUTCDATETIME()))
   AND (p.VendorID IS NULL OR vendor.Status=''Active'')
  GROUP BY p.ID,m.ID
 ), Footprints AS (
  SELECT MIN(MaterialID) ID,LengthMM,WidthMM FROM Measurements
  WHERE LengthMM>0 AND LengthMM<=20000 AND WidthMM>0 AND WidthMM<=20000 AND LengthCount=1 AND WidthCount=1
  GROUP BY LengthMM,WidthMM
 ), Names AS (
  SELECT ID,LengthMM,WidthMM,
   RTRIM(REPLACE(RTRIM(REPLACE(CONVERT(VARCHAR(30),LengthMM),''0'','' '')), '' '',''0'')) L,
   RTRIM(REPLACE(RTRIM(REPLACE(CONVERT(VARCHAR(30),WidthMM),''0'','' '')), '' '',''0'')) W
  FROM Footprints
 )
 SELECT n.ID,CONVERT(NVARCHAR(100),CONCAT(CASE WHEN RIGHT(n.L,1)=''.'' THEN LEFT(n.L,LEN(n.L)-1) ELSE n.L END,N''x'',CASE WHEN RIGHT(n.W,1)=''.'' THEN LEFT(n.W,LEN(n.W)-1) ELSE n.W END,N''mm'')) PalletSize,
  n.LengthMM,n.WidthMM,n.LengthMM*n.WidthMM PalletAreaMM2,mm.ID UoMID,CONVERT(VARCHAR(10),''Active'') Status,
  CONVERT(VARCHAR(10),''Material'') ChoiceSource,
  CONVERT(INT,NULL) PalletsPer20DC,CONVERT(INT,NULL) PalletsPer40DC,CONVERT(INT,NULL) PalletsPer40HC,CONVERT(INT,NULL) PalletsPer20RC,CONVERT(INT,NULL) PalletsPer40RHC
 FROM Names n JOIN dbo.UoM mm ON mm.UoMCode=''mm'' AND mm.Status=''Active''
 UNION ALL
 SELECT -p.ID,p.PalletSize,TRY_CONVERT(DECIMAL(18,6),p.Length*p.FactorToMM),TRY_CONVERT(DECIMAL(18,6),p.Width*p.FactorToMM),
  p.PalletAreaMM2,p.UoMID,p.Status,''Legacy'',p.PalletsPer20DC,p.PalletsPer40DC,p.PalletsPer40HC,p.PalletsPer20RC,p.PalletsPer40RHC
 FROM dbo.v_PalletMaster p;';
 DECLARE @ChoiceProc SYSNAME,@ChoiceDefinition NVARCHAR(MAX);
 DECLARE choice_procedures CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES
 (N'usp_OpportunityItem_Fields_Save'),(N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')
 ) p(name);
 OPEN choice_procedures;FETCH NEXT FROM choice_procedures INTO @ChoiceProc;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @ChoiceDefinition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@ChoiceProc));
  IF @ChoiceDefinition IS NULL THROW 52996,'Apply earlier field migrations first.',1;
  IF CHARINDEX('v_PalletSizeChoice',@ChoiceDefinition)=0 BEGIN
   IF CHARINDEX('v_PalletMaster',@ChoiceDefinition)=0 THROW 52996,'Unexpected pallet validation; migration rolled back.',1;
   -- Only validation uses alias p. Keep legacy profile-capacity joins intact.
   SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID',N'dbo.v_PalletSizeChoice p JOIN dbo.UoM u ON u.ID=p.UoMID');
   SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'Choose an active pallet size from Pallet Master.',N'Choose an active pallet footprint from Packaging Pricing.');
   SET @ChoiceDefinition=STUFF(@ChoiceDefinition,1,CHARINDEX(N'PROCEDURE',UPPER(@ChoiceDefinition))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
   EXEC sys.sp_executesql @ChoiceDefinition;
  END;
  FETCH NEXT FROM choice_procedures INTO @ChoiceProc;
 END;
 CLOSE choice_procedures;DEALLOCATE choice_procedures;
 SET @ChoiceDefinition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_OpportunityPalletLookup_Read'));
 IF @ChoiceDefinition IS NULL THROW 52996,'Opportunity pallet lookup is missing.',1;
 IF CHARINDEX(N'p.LengthMM',@ChoiceDefinition)=0
  SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'SELECT p.ID,p.PalletSize',N'SELECT p.ID,p.PalletSize,p.LengthMM,p.WidthMM');
 SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'dbo.v_PalletMaster p',N'dbo.v_PalletSizeChoice p');
 IF CHARINDEX(N'p.ChoiceSource',@ChoiceDefinition)=0
  SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'WHERE p.Status=',N'WHERE p.ChoiceSource=''Material'' AND p.Status=');
 SET @ChoiceDefinition=STUFF(@ChoiceDefinition,1,CHARINDEX(N'PROCEDURE',UPPER(@ChoiceDefinition))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @ChoiceDefinition;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
GO
-- END MIGRATION 114_pallet_dimension_choices.sql
GO
-- BEGIN MIGRATION 115_pallet_pricing.sql
PRINT N'Applying 115_pallet_pricing.sql';
GO
-- After 114. Immutable pallet and accessory pricing snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.PalletPricingSnapshot','U') IS NULL
 CREATE TABLE dbo.PalletPricingSnapshot(
 ID INT IDENTITY PRIMARY KEY,ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 SnapshotJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(SnapshotJSON)=1),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletPricingID') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletPricingID INT NULL REFERENCES dbo.PalletPricingSnapshot(ID);
GO
-- END MIGRATION 115_pallet_pricing.sql
GO
-- BEGIN MIGRATION 116_response_container_plans.sql
PRINT N'Applying 116_response_container_plans.sql';
GO
-- After 115. Current response load plan per physical container type.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ResponseContainerLoadPlan','U') IS NULL
 CREATE TABLE dbo.ResponseContainerLoadPlan(
 ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 ContainerID INT NOT NULL REFERENCES dbo.ContainerTypeMaster(ID),
 PlanID INT NOT NULL REFERENCES dbo.ContainerLoadPlan(ID),
 UpdatedBy INT NOT NULL REFERENCES dbo.Users(ID),
 UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_ResponseContainerLoadPlan PRIMARY KEY(ItemID,ContainerID));
INSERT dbo.ResponseContainerLoadPlan(ItemID,ContainerID,PlanID,UpdatedBy)
 SELECT i.ID,p.ContainerID,p.ID,p.CreatedBy FROM dbo.PackagingConfigurationRequestItem i
 JOIN dbo.ContainerLoadPlan p ON p.ID=i.LoadPlanID AND p.ItemID=i.ID
 WHERE NOT EXISTS(SELECT 1 FROM dbo.ResponseContainerLoadPlan r WHERE r.ItemID=i.ID AND r.ContainerID=p.ContainerID);

-- Feedback may evaluate every standard container, irrespective of request family/size.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL THROW 52996,'Apply preceding Packaging field migrations first.',1;
IF CHARINDEX(N'-- Independent container feedback (116)',@D)=0
BEGIN
 IF CHARINDEX(N'IF @ShipmentType IS NOT NULL AND ((@ShipmentSize=',@D)=0 OR CHARINDEX(N'IF (@ContainerFamily=N''Dry''',@D)=0
  THROW 52996,'Unexpected container validation definition; migration not applied.',1;
 SET @D=REPLACE(@D,N'IF @ShipmentType IS NOT NULL AND ((@ShipmentSize=',N'SET @ShipmentSize=NULL; -- Independent container feedback (116)
 IF @ShipmentType IS NOT NULL AND ((@ShipmentSize=');
 SET @D=REPLACE(@D,N'IF (@ContainerFamily=N''Dry''',N'SET @ContainerFamily=NULL;
 IF (@ContainerFamily=N''Dry''');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;

COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
GO
-- END MIGRATION 116_response_container_plans.sql
GO
-- VERIFY UPGRADE
IF @@TRANCOUNT<>0
 THROW 52956,'Upgrade left an open transaction. Stop and investigate.',1;
IF OBJECT_ID('dbo.fn_PackagingPICMember','FN') IS NULL
 OR OBJECT_ID('dbo.fn_PackagingManagerAccess','FN') IS NULL
 OR COL_LENGTH('dbo.PackagingType','CopyDim') IS NULL
 OR COL_LENGTH('dbo.PackagingPrice','MaterialDimensionID') IS NULL
 OR OBJECT_ID('dbo.usp_PackagingPrice_BatchV6','P') IS NULL
 OR OBJECT_ID('dbo.ContainerTypeMaster','U') IS NULL
 OR OBJECT_ID('dbo.ContainerLoadPlan','U') IS NULL
 OR OBJECT_ID('dbo.PalletMaterialMigration','U') IS NULL
 OR COL_LENGTH('dbo.PackagingConfigurationRequestItem','LoadPlanID') IS NULL
 OR OBJECT_ID('dbo.ResponseLoadPlanHistory','U') IS NULL
 OR COL_LENGTH('dbo.PackagingMaterial','TareWeight') IS NULL
 OR COL_LENGTH('dbo.PackagingMaterial','TareWeightBasis') IS NULL
 OR OBJECT_ID('dbo.v_PalletSizeChoice','V') IS NULL
 OR OBJECT_ID('dbo.PalletPricingSnapshot','U') IS NULL
 OR COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletPricingID') IS NULL
 OR OBJECT_ID('dbo.ResponseContainerLoadPlan','U') IS NULL
 THROW 52956,'Upgrade verification failed: required loading, tare, pallet or permission objects are missing.',1;
IF CHARINDEX(N'-- Admin response ownership override (113)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PkgPricing_ItemAuthorize')),N''))=0
 OR CHARINDEX(N'-- Independent container feedback (116)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),N''))=0
 THROW 52956,'Upgrade verification failed: current response permission/container definitions are missing.',1;
PRINT N'PythonBridge upgrade 105-116 verified. Deploy matching application files before restarting.';
PRINT N'Container Type Master is not seeded by this bundle: Admin must verify or maintain active container specifications and payloads.';
PRINT N'Verify migrated pallet height, active EA vendor pricing, and pallet/accessory tare before planning.';
GO
