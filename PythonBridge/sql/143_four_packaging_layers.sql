-- After 142. User-approved migration: four cumulative layer labels.
-- Relative per-item slots preserve quantities/prices and historical fingerprints.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.PackagingMaterial','MaxPayloadKG') IS NULL THROW 52996,'Apply migration 142 first.',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem p JOIN dbo.OpportunityItem c ON c.ParentItemID=p.ID
   GROUP BY p.ID,p.PackagingLayerCount HAVING p.PackagingLayerCount+MAX(c.PackagingLayerCount)>4)
  THROW 52996,'An existing Mix exceeds four layers. Resolve it; no configuration was removed.',1;
 IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem p JOIN dbo.OpportunityItem oi ON oi.ID=p.OpportunityItemID
   JOIN dbo.OpportunityItem ci ON ci.ParentItemID=oi.ID JOIN dbo.PackagingConfigurationRequestItem c ON c.RequestID=p.RequestID AND c.OpportunityItemID=ci.ID
   GROUP BY p.ID,p.ResponseLayerCount,p.RequestedLayerCount HAVING COALESCE(p.ResponseLayerCount,p.RequestedLayerCount)+MAX(COALESCE(c.ResponseLayerCount,c.RequestedLayerCount))>4)
  THROW 52996,'An existing packaging response exceeds four layers. Resolve it; no configuration was removed.',1;
 IF OBJECT_ID('dbo.PackagingLayerMigrationArchive','U') IS NULL
  CREATE TABLE dbo.PackagingLayerMigrationArchive(EntityName SYSNAME NOT NULL,OriginalJSON NVARCHAR(MAX) NOT NULL,
    ArchivedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),CONSTRAINT PK_PackagingLayerMigrationArchive PRIMARY KEY(EntityName));
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingLayerMigrationArchive WHERE EntityName='PackagingTypeOrder143')
  INSERT dbo.PackagingLayerMigrationArchive(EntityName,OriginalJSON)
  SELECT 'PackagingTypeOrder143',(SELECT * FROM dbo.PackagingTypeOrder FOR JSON PATH);
 IF COL_LENGTH('dbo.OpportunityItem','QuaternaryTypeID') IS NULL
  ALTER TABLE dbo.OpportunityItem ADD QuaternaryTypeID INT NULL REFERENCES dbo.PackagingType(ID),
    QuaternaryTransparency NVARCHAR(100) NULL,NumberOfTertiary INT NULL,
    QuaternaryRecyclableRequirement NVARCHAR(200) NULL,QuaternaryRecycledContent NVARCHAR(200) NULL,
    QuaternaryMetalizedAluminum NVARCHAR(100) NULL,QuaternarySpecialComments NVARCHAR(1000) NULL;
 IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','FourthPMType') IS NULL
  ALTER TABLE dbo.PackagingConfigurationRequestItem ADD QuaternaryTypeID INT NULL,QuaternaryTypeName NVARCHAR(100) NULL,
    QuaternaryTransparency NVARCHAR(100) NULL,NumberOfTertiary INT NULL,
    QuaternaryRecyclableRequirement NVARCHAR(200) NULL,QuaternaryRecycledContent NVARCHAR(200) NULL,
    QuaternaryMetalizedAluminum NVARCHAR(100) NULL,QuaternarySpecialComments NVARCHAR(1000) NULL,
    FourthPMType NVARCHAR(100) NULL,FourthPMMOQ DECIMAL(18,4) NULL,UnitsPerQuaternary INT NULL;
 IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_OpportunityItem_Quaternary')
 EXEC(N'ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_OpportunityItem_Quaternary CHECK((NumberOfTertiary IS NULL OR NumberOfTertiary>=1) AND (QuaternaryTransparency IS NULL OR QuaternaryTransparency IN(N''Transparent'',N''Opaque'',N''NA'')))');
 IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_PCRItem_Quaternary')
 EXEC(N'ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CONSTRAINT CK_PCRItem_Quaternary CHECK((UnitsPerQuaternary IS NULL OR UnitsPerQuaternary>=1) AND (FourthPMMOQ IS NULL OR FourthPMMOQ>=0))');
 -- Quaternary needs ten characters; the retired scalar column allowed nine.
 ALTER TABLE dbo.PackagingType ALTER COLUMN PackagingOrder NVARCHAR(16) NOT NULL;
 EXEC sys.sp_refreshview N'dbo.v_PackagingTypeWeb';
 EXEC sys.sp_refreshview N'dbo.v_PackagingTypeDimensionContext';
 DECLARE @Name SYSNAME,@Table SYSNAME,@SQL NVARCHAR(MAX),@D NVARCHAR(MAX);
 DECLARE limits CURSOR LOCAL FAST_FORWARD FOR SELECT OBJECT_NAME(parent_object_id),name FROM sys.check_constraints
 WHERE name IN('CK_OpportunityItem_PackagingLayers','CK_PackagingRequestItem_Layers','CK_PackagingTypeOrder_Order','CK_PackagingType_Order','CK_PkgPricingMaster_Order');
 OPEN limits;FETCH NEXT FROM limits INTO @Table,@Name;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @SQL=N'ALTER TABLE dbo.'+QUOTENAME(@Table)+N' DROP CONSTRAINT '+QUOTENAME(@Name);EXEC(@SQL);
  FETCH NEXT FROM limits INTO @Table,@Name;
 END;CLOSE limits;DEALLOCATE limits;
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_OpportunityItem_PackagingLayers CHECK(PackagingLayerCount BETWEEN 1 AND 4);
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CONSTRAINT CK_PackagingRequestItem_Layers CHECK(RequestedLayerCount BETWEEN 1 AND 4 AND (ResponseLayerCount IS NULL OR ResponseLayerCount BETWEEN 1 AND 4));
 INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
 SELECT DISTINCT old.PackagingTypeID,v.NewOrder FROM dbo.PackagingTypeOrder old
 CROSS APPLY(VALUES(N'Secondary'),(N'Tertiary'),(N'Quaternary')) v(NewOrder)
 WHERE old.PackagingOrder IN(N'Primary Mix',N'Secondary Mix',N'Tertiary Mix') AND
  (old.PackagingOrder=N'Primary Mix' OR old.PackagingOrder=N'Secondary Mix' AND v.NewOrder<>N'Secondary' OR old.PackagingOrder=N'Tertiary Mix' AND v.NewOrder=N'Quaternary')
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder x WHERE x.PackagingTypeID=old.PackagingTypeID AND x.PackagingOrder=v.NewOrder);
 DELETE dbo.PackagingTypeOrder WHERE PackagingOrder IN(N'Primary Mix',N'Secondary Mix',N'Tertiary Mix');
 ALTER TABLE dbo.PackagingTypeOrder ADD CONSTRAINT CK_PackagingTypeOrder_Order CHECK(PackagingOrder IN(N'Primary',N'Secondary',N'Tertiary',N'Quaternary',N'Pallet'));
 ALTER TABLE dbo.PackagingType ADD CONSTRAINT CK_PackagingType_Order CHECK(PackagingOrder IN(N'Primary',N'Secondary',N'Tertiary',N'Quaternary',N'Pallet'));
 ALTER TABLE dbo.PkgPricingMaster ADD CONSTRAINT CK_PkgPricingMaster_Order CHECK(PackagingOrder IN('Primary','Secondary','Tertiary','Quaternary'));
 EXEC(N'CREATE OR ALTER FUNCTION dbo.fn_OpportunityPackagingLayerStart(@ItemID INT) RETURNS INT AS BEGIN
 RETURN COALESCE((SELECT MAX(c.PackagingLayerCount)+1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=@ItemID),1); END');
 EXEC(N'CREATE OR ALTER FUNCTION dbo.fn_RequestPackagingLayerStart(@ItemID INT) RETURNS INT AS BEGIN
 DECLARE @Start INT;SELECT @Start=MAX(COALESCE(c.ResponseLayerCount,c.RequestedLayerCount))+1
 FROM dbo.PackagingConfigurationRequestItem p JOIN dbo.OpportunityItem oi ON oi.ID=p.OpportunityItemID
 JOIN dbo.OpportunityItem ch ON ch.ParentItemID=oi.ID JOIN dbo.PackagingConfigurationRequestItem c ON c.RequestID=p.RequestID AND c.OpportunityItemID=ch.ID WHERE p.ID=@ItemID;
 RETURN COALESCE(@Start,1); END');
 EXEC(N'CREATE OR ALTER FUNCTION dbo.fn_RequestRequestedPackagingLayerStart(@ItemID INT) RETURNS INT AS BEGIN
 DECLARE @Start INT;SELECT @Start=MAX(c.RequestedLayerCount)+1
 FROM dbo.PackagingConfigurationRequestItem p JOIN dbo.OpportunityItem oi ON oi.ID=p.OpportunityItemID
 JOIN dbo.OpportunityItem ch ON ch.ParentItemID=oi.ID JOIN dbo.PackagingConfigurationRequestItem c ON c.RequestID=p.RequestID AND c.OpportunityItemID=ch.ID WHERE p.ID=@ItemID;
 RETURN COALESCE(@Start,1); END');
 EXEC(N'CREATE OR ALTER FUNCTION dbo.fn_PackagingGlobalOrder(@Local VARCHAR(20),@Start INT) RETURNS VARCHAR(20) AS BEGIN
 DECLARE @N INT=CASE @Local WHEN ''Primary'' THEN 1 WHEN ''Secondary'' THEN 2 WHEN ''Tertiary'' THEN 3 WHEN ''Quaternary'' THEN 4 END+@Start-1;
 RETURN CASE @N WHEN 1 THEN ''Primary'' WHEN 2 THEN ''Secondary'' WHEN 3 THEN ''Tertiary'' WHEN 4 THEN ''Quaternary'' END; END');
 EXEC(N'CREATE OR ALTER FUNCTION dbo.fn_PackagingTypeOrderAllowed(@TypeID INT,@LayerOrder VARCHAR(20),@MixParent BIT) RETURNS BIT AS BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingType p JOIN dbo.PackagingTypeOrder o ON o.PackagingTypeID=p.ID
 WHERE p.ID=@TypeID AND p.ParentTypeID IS NULL AND o.PackagingOrder=@LayerOrder) THEN 1 ELSE 0 END; END');

 -- New counts are validated at the shared SQL save boundary as well as the API.
 EXEC(N'CREATE OR ALTER PROCEDURE dbo.usp_PackagingLayers_Validate @ID INT,@Request BIT AS
 BEGIN
 SET NOCOUNT ON;
 IF @Request=0 BEGIN
 DECLARE @Root INT=(SELECT COALESCE(ParentItemID,ID) FROM dbo.OpportunityItem WHERE ID=@ID);
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem p JOIN dbo.OpportunityItem c ON c.ParentItemID=p.ID WHERE p.ID=@Root
 GROUP BY p.ID,p.PackagingLayerCount HAVING p.PackagingLayerCount+MAX(c.PackagingLayerCount)>4)
 THROW 52961,''Child and parent packaging together cannot exceed four layers; reserve at least one parent layer.'',1;
 END ELSE BEGIN
 DECLARE @OppRoot INT,@Req INT;SELECT @OppRoot=COALESCE(oi.ParentItemID,oi.ID),@Req=i.RequestID
 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID WHERE i.ID=@ID;
 IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem p JOIN dbo.OpportunityItem co ON co.ParentItemID=@OppRoot
 JOIN dbo.PackagingConfigurationRequestItem c ON c.OpportunityItemID=co.ID AND c.RequestID=@Req
 WHERE p.RequestID=@Req AND p.OpportunityItemID=@OppRoot GROUP BY p.ID,p.ResponseLayerCount,p.RequestedLayerCount
 HAVING COALESCE(p.ResponseLayerCount,p.RequestedLayerCount)+MAX(COALESCE(c.ResponseLayerCount,c.RequestedLayerCount))>4)
 THROW 52961,''Child and parent packaging together cannot exceed four layers; reserve at least one parent layer.'',1;
 END END');

 IF (SELECT COUNT(*) FROM sys.procedures WHERE schema_id=SCHEMA_ID('dbo') AND name IN
 ('usp_OpportunityItem_Fields_Save','usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation','usp_PackagingType_Batch','usp_PkgPricing_Save','usp_PackagingRequest_Create_AuditImplementation','usp_PackagingRequestItem_Transition_AuditImplementation'))<>6
  THROW 52996,'Required packaging save/workflow procedures are missing. No configuration was changed.',1;
 DECLARE procedures CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.procedures WHERE name IN
 ('usp_OpportunityItem_Fields_Save','usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation','usp_PackagingType_Batch','usp_PkgPricing_Save','usp_PackagingRequest_Create_AuditImplementation','usp_PackagingRequestItem_Transition_AuditImplementation');
 OPEN procedures;FETCH NEXT FROM procedures INTO @Name;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @D=REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name)),CHAR(13),N'');
  IF @D IS NULL THROW 52996,'Required packaging procedure is missing.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingLayerMigrationArchive WHERE EntityName=@Name)
   INSERT dbo.PackagingLayerMigrationArchive(EntityName,OriginalJSON) SELECT @Name,(SELECT @D Definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF CHARINDEX(N'-- Four packaging layers (143)',@D)>0 AND CHARINDEX(N'-- Four packaging layers (143 final)',@D)=0
   SELECT @D=j.Definition FROM dbo.PackagingLayerMigrationArchive a CROSS APPLY OPENJSON(a.OriginalJSON) WITH(Definition NVARCHAR(MAX)) j WHERE a.EntityName=@Name;
  IF CHARINDEX(N'-- Four packaging layers (143 final)',@D)=0 BEGIN
   SET @D=REPLACE(@D,N'BETWEEN 1 AND 3',N'BETWEEN 1 AND 4');
   SET @D=REPLACE(@D,N'N''Primary'',N''Secondary'',N''Tertiary'',N''Primary Mix'',N''Secondary Mix'',N''Tertiary Mix'',N''Pallet''',N'N''Primary'',N''Secondary'',N''Tertiary'',N''Quaternary'',N''Pallet''');
   SET @D=REPLACE(@D,N'N''Primary'',N''Secondary'',N''Tertiary'',N''Pallet''',N'N''Primary'',N''Secondary'',N''Tertiary'',N''Quaternary'',N''Pallet''');
   SET @D=REPLACE(@D,N'''Primary'',''Secondary'',''Tertiary'')',N'''Primary'',''Secondary'',''Tertiary'',''Quaternary'')');
   IF @Name=N'usp_OpportunityItem_Fields_Save' BEGIN
    SET @D=REPLACE(@D,N'WHERE [key] NOT IN(',N'WHERE [key] NOT IN(''QuaternaryTypeID'',''QuaternaryTransparency'',''NumberOfTertiary'',''QuaternaryRecyclableRequirement'',''QuaternaryRecycledContent'',''QuaternaryMetalizedAluminum'',''QuaternarySpecialComments'',');
    SET @D=REPLACE(@D,N'NumberOfSecondary INT',N'NumberOfSecondary INT,QuaternaryTypeID INT,QuaternaryTransparency NVARCHAR(100),NumberOfTertiary INT,QuaternaryRecyclableRequirement NVARCHAR(200),QuaternaryRecycledContent NVARCHAR(200),QuaternaryMetalizedAluminum NVARCHAR(100),QuaternarySpecialComments NVARCHAR(1000)');
    SET @D=REPLACE(@D,N'PackagingLayerCount=@Layers,',N'PackagingLayerCount=@Layers,
     QuaternaryTypeID=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''QuaternaryTypeID'') THEN j.QuaternaryTypeID ELSE t.QuaternaryTypeID END,
     QuaternaryTransparency=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''QuaternaryTransparency'') THEN j.QuaternaryTransparency ELSE t.QuaternaryTransparency END,
     NumberOfTertiary=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''NumberOfTertiary'') THEN j.NumberOfTertiary ELSE t.NumberOfTertiary END,
     QuaternaryRecyclableRequirement=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''QuaternaryRecyclableRequirement'') THEN j.QuaternaryRecyclableRequirement ELSE t.QuaternaryRecyclableRequirement END,
     QuaternaryRecycledContent=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''QuaternaryRecycledContent'') THEN j.QuaternaryRecycledContent ELSE t.QuaternaryRecycledContent END,
     QuaternaryMetalizedAluminum=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''QuaternaryMetalizedAluminum'') THEN j.QuaternaryMetalizedAluminum ELSE t.QuaternaryMetalizedAluminum END,
     QuaternarySpecialComments=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''QuaternarySpecialComments'') THEN j.QuaternarySpecialComments ELSE t.QuaternarySpecialComments END,');
    SET @D=REPLACE(@D,N'IF @Web=1 AND @Layers>=2',N'IF @Web=1 AND @Layers BETWEEN 2 AND 3');
    SET @D=REPLACE(@D,N'END,dbo.fn_OpportunityIsMixParent(@ID))',N'END,dbo.fn_OpportunityIsMixParent(@ID))');
   END;
   IF @Name=N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation' BEGIN
    SET @D=REPLACE(@D,N'WHERE [key] NOT IN(',N'WHERE [key] NOT IN(''FourthPMType'',''FourthPMMOQ'',''UnitsPerQuaternary'',');
    SET @D=REPLACE(@D,N'UnitsPerTertiary INT',N'UnitsPerTertiary INT,FourthPMType NVARCHAR(100),FourthPMMOQ DECIMAL(18,4),UnitsPerQuaternary INT');
    SET @D=REPLACE(@D,N'ThirdPMType=CASE',N'FourthPMType=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''FourthPMType'') THEN NULLIF(LTRIM(RTRIM(j.FourthPMType)),N'''') ELSE t.FourthPMType END,
     FourthPMMOQ=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''FourthPMMOQ'') THEN j.FourthPMMOQ ELSE t.FourthPMMOQ END,
     UnitsPerQuaternary=CASE WHEN @Layers<4 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''UnitsPerQuaternary'') THEN j.UnitsPerQuaternary ELSE t.UnitsPerQuaternary END,
     ThirdPMType=CASE');
    SET @D=REPLACE(@D,N'IF @Layers>=2 AND EXISTS',N'IF @Layers BETWEEN 2 AND 3 AND EXISTS');
   END;
   IF @Name=N'usp_PkgPricing_Save' BEGIN
    SET @D=REPLACE(@D,N'ELSE ThirdPMType END',N'WHEN ''Tertiary'' THEN ThirdPMType ELSE FourthPMType END');
    SET @D=REPLACE(@D,N'WHEN ''Secondary'' THEN 2 ELSE 3 END',N'WHEN ''Secondary'' THEN 2 WHEN ''Tertiary'' THEN 3 ELSE 4 END');
   END;
   IF @Name=N'usp_PackagingRequest_Create_AuditImplementation' BEGIN
    SET @D=REPLACE(@D,N'TertiarySpecialComments,ResponseLayerCount',N'TertiarySpecialComments,QuaternaryTypeID,QuaternaryTypeName,QuaternaryTransparency,NumberOfTertiary,QuaternaryRecyclableRequirement,QuaternaryRecycledContent,QuaternaryMetalizedAluminum,QuaternarySpecialComments,ResponseLayerCount');
    SET @D=REPLACE(@D,N'i.TertiarySpecialComments,i.PackagingLayerCount',N'i.TertiarySpecialComments,i.QuaternaryTypeID,(SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.QuaternaryTypeID),i.QuaternaryTransparency,i.NumberOfTertiary,i.QuaternaryRecyclableRequirement,i.QuaternaryRecycledContent,i.QuaternaryMetalizedAluminum,i.QuaternarySpecialComments,i.PackagingLayerCount');
    SET @D=REPLACE(@D,N'ThirdPMType,UnitsPerCarton,UnitsPerTertiary,ResponsePalletSize',N'ThirdPMType,FourthPMType,UnitsPerCarton,UnitsPerTertiary,UnitsPerQuaternary,ResponsePalletSize');
    SET @D=REPLACE(@D,N'CASE WHEN i.PackagingLayerCount>=3 THEN (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.TertiaryTypeID) END,',N'CASE WHEN i.PackagingLayerCount>=3 THEN (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.TertiaryTypeID) END,
 CASE WHEN i.PackagingLayerCount>=4 THEN (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.QuaternaryTypeID) END,');
    SET @D=REPLACE(@D,N'CASE WHEN i.PackagingLayerCount>=3 THEN i.NumberOfSecondary END,',N'CASE WHEN i.PackagingLayerCount>=3 THEN i.NumberOfSecondary END,
 CASE WHEN i.PackagingLayerCount>=4 THEN i.NumberOfTertiary END,');
   END;
   IF @Name=N'usp_OpportunityItem_Fields_Save'
    SET @D=REPLACE(@D,N'SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;',N'EXEC dbo.usp_PackagingLayers_Validate @ID,0;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;');
   IF @Name=N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'
    SET @D=REPLACE(@D,N'SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;',N'EXEC dbo.usp_PackagingLayers_Validate @ID,1;
 SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;');
   IF @Name=N'usp_PackagingRequestItem_Transition_AuditImplementation' BEGIN
    SET @D=REPLACE(@D,N'OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=3 AND (NULLIF(LTRIM(RTRIM(ThirdPMType)),N'''') IS NULL OR UnitsPerTertiary IS NULL OR ThirdPMMOQ IS NULL))',N'OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=3 AND (NULLIF(LTRIM(RTRIM(ThirdPMType)),N'''') IS NULL OR UnitsPerTertiary IS NULL OR ThirdPMMOQ IS NULL))
 OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=4 AND (NULLIF(LTRIM(RTRIM(FourthPMType)),N'''') IS NULL OR UnitsPerQuaternary IS NULL OR FourthPMMOQ IS NULL))');
    SET @D=REPLACE(@D,N'IF @TargetStage IN(''Pending Review'',''Approved'') AND EXISTS(',N'EXEC dbo.usp_PackagingLayers_Validate @ID,1;
 IF @TargetStage IN(''Pending Review'',''Approved'') AND EXISTS(');
   END;
   -- Global positions are derived from the deepest saved child, never from a client flag.
   IF @Name=N'usp_OpportunityItem_Fields_Save' BEGIN
    SET @D=REPLACE(@D,N'''PrimaryTypeID'',''SecondaryTypeID'',''TertiaryTypeID''',N'''PrimaryTypeID'',''SecondaryTypeID'',''TertiaryTypeID'',''QuaternaryTypeID''');
    SET @D=REPLACE(@D,N'''TertiaryTypeID'',''NumberOfPrimary'',''NumberOfSecondary''',N'''TertiaryTypeID'',''QuaternaryTypeID'',''NumberOfPrimary'',''NumberOfSecondary'',''NumberOfTertiary''');
    SET @D=REPLACE(@D,N'WHEN ''SecondaryTypeID'' THEN ''Secondary'' ELSE ''Tertiary'' END',N'WHEN ''SecondaryTypeID'' THEN ''Secondary'' WHEN ''TertiaryTypeID'' THEN ''Tertiary'' ELSE ''Quaternary'' END');
    SET @D=REPLACE(@D,N'WHEN ''SecondaryTypeID'' THEN i.SecondaryTypeID ELSE i.TertiaryTypeID END',N'WHEN ''SecondaryTypeID'' THEN i.SecondaryTypeID WHEN ''TertiaryTypeID'' THEN i.TertiaryTypeID ELSE i.QuaternaryTypeID END');
    SET @D=REPLACE(@D,N'p.ID,CASE [key]',N'p.ID,dbo.fn_PackagingGlobalOrder(CASE [key]');
    SET @D=REPLACE(@D,N'END,dbo.fn_OpportunityIsMixParent(@ID))',N'END,dbo.fn_OpportunityPackagingLayerStart(@ID)),dbo.fn_OpportunityIsMixParent(@ID))');
    SET @D=REPLACE(@D,N'IF @Web=1 AND @Layers BETWEEN 2 AND 3',N'IF @Web=1 AND @Layers+dbo.fn_OpportunityPackagingLayerStart(@ID)-1>=2');
    SET @D=REPLACE(@D,N'ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryTypeID'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.TertiaryTypeID'')) ELSE i.TertiaryTypeID END END TypeID',N'WHEN @Layers=3 THEN CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryTypeID'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.TertiaryTypeID'')) ELSE i.TertiaryTypeID END ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''QuaternaryTypeID'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.QuaternaryTypeID'')) ELSE i.QuaternaryTypeID END END TypeID');
    SET @D=REPLACE(@D,N'WHEN @Layers=2 THEN i.SecondaryTypeID ELSE i.TertiaryTypeID END',N'WHEN @Layers=2 THEN i.SecondaryTypeID WHEN @Layers=3 THEN i.TertiaryTypeID ELSE i.QuaternaryTypeID END');
    SET @D=REPLACE(@D,N't.ID,CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(i.ID)',N't.ID,dbo.fn_PackagingGlobalOrder(CASE WHEN @Layers=2 THEN ''Secondary'' WHEN @Layers=3 THEN ''Tertiary'' ELSE ''Quaternary'' END,dbo.fn_OpportunityPackagingLayerStart(i.ID)),dbo.fn_OpportunityIsMixParent(i.ID)');
    SET @D=REPLACE(@D,N'WHERE j.[key]=''TertiaryTransparency''',N'WHERE j.[key] IN(''TertiaryTransparency'',''QuaternaryTransparency'')');
   END;
   IF @Name=N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation' BEGIN
    SET @D=REPLACE(@D,N'''FirstPMType'',''SecondPMType'',''ThirdPMType''',N'''FirstPMType'',''SecondPMType'',''ThirdPMType'',''FourthPMType''');
    SET @D=REPLACE(@D,N'WHEN ''SecondPMType'' THEN i.SecondPMType ELSE i.ThirdPMType END',N'WHEN ''SecondPMType'' THEN i.SecondPMType WHEN ''ThirdPMType'' THEN i.ThirdPMType ELSE i.FourthPMType END');
    SET @D=REPLACE(@D,N'WHEN ''SecondPMType'' THEN N''Secondary'' ELSE N''Tertiary'' END',N'WHEN ''SecondPMType'' THEN N''Secondary'' WHEN ''ThirdPMType'' THEN N''Tertiary'' ELSE N''Quaternary'' END');
    SET @D=REPLACE(@D,N'dbo.PackagingType.ID,v.PackagingOrder,',N'dbo.PackagingType.ID,dbo.fn_PackagingGlobalOrder(v.PackagingOrder,dbo.fn_RequestPackagingLayerStart(@ID)),');
    SET @D=REPLACE(@D,N'IF @Layers BETWEEN 2 AND 3 AND EXISTS',N'IF @Layers+dbo.fn_RequestPackagingLayerStart(@ID)-1>=2 AND EXISTS');
    SET @D=REPLACE(@D,N'ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ThirdPMType'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.ThirdPMType''))),N'''') ELSE i.ThirdPMType END END TypeName',N'WHEN @Layers=3 THEN CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ThirdPMType'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.ThirdPMType''))),N'''') ELSE i.ThirdPMType END ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''FourthPMType'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.FourthPMType''))),N'''') ELSE i.FourthPMType END END TypeName');
    SET @D=REPLACE(@D,N'WHEN @Layers=2 THEN i.SecondPMType ELSE i.ThirdPMType END',N'WHEN @Layers=2 THEN i.SecondPMType WHEN @Layers=3 THEN i.ThirdPMType ELSE i.FourthPMType END');
    SET @D=REPLACE(@D,N't.ID,CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(i.OpportunityItemID)',N't.ID,dbo.fn_PackagingGlobalOrder(CASE WHEN @Layers=2 THEN ''Secondary'' WHEN @Layers=3 THEN ''Tertiary'' ELSE ''Quaternary'' END,dbo.fn_RequestPackagingLayerStart(i.ID)),dbo.fn_OpportunityIsMixParent(i.OpportunityItemID)');
    SET @D=REPLACE(@D,N'WHEN 2 THEN ''SecondPMType'' ELSE ''ThirdPMType'' END',N'WHEN 2 THEN ''SecondPMType'' WHEN 3 THEN ''ThirdPMType'' ELSE ''FourthPMType'' END');
    SET @D=REPLACE(@D,N'WHEN 2 THEN i.SecondPMType ELSE i.ThirdPMType END',N'WHEN 2 THEN i.SecondPMType WHEN 3 THEN i.ThirdPMType ELSE i.FourthPMType END');
    SET @D=REPLACE(@D,N'''UnitsPerCarton'',''UnitsPerTertiary''',N'''UnitsPerCarton'',''UnitsPerTertiary'',''UnitsPerQuaternary''');
    SET @D=REPLACE(@D,N'''FirstPMMOQ'',''SecondPMMOQ'',''ThirdPMMOQ''',N'''FirstPMMOQ'',''SecondPMMOQ'',''ThirdPMMOQ'',''FourthPMMOQ''');
    SET @D=REPLACE(@D,N'IF @Height IS NOT NULL BEGIN',N'IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerPallet'') SET @PalletLayers=TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.LayersPerPallet''));
 ELSE IF @Height IS NOT NULL BEGIN');
   END;
   IF @Name=N'usp_PkgPricing_Save'
    SET @D=REPLACE(@D,N'dbo.PackagingType.ID,@Order,',N'dbo.PackagingType.ID,dbo.fn_PackagingGlobalOrder(@Order,dbo.fn_RequestPackagingLayerStart(@ItemID)),');

   SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
   SET @D=REPLACE(@D,N'SET NOCOUNT ON;',N'SET NOCOUNT ON; -- Four packaging layers (143 final)');
   EXEC sys.sp_executesql @D;
  END;
  -- Keep explicit pallet overrides on partial API/workbook saves too.
  IF @Name=N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'
   AND CHARINDEX(N'-- Maintain pallet overrides (143)',@D)=0 BEGIN
   SET @D=REPLACE(@D,N'ELSE IF @Height IS NOT NULL BEGIN',N'ELSE IF @GeometryChanged=0 AND @PalletLayers IS NOT NULL SET @PalletLayers=@PalletLayers;
 ELSE IF @Height IS NOT NULL BEGIN');
   SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
   SET @D=REPLACE(@D,N'SET NOCOUNT ON;',N'SET NOCOUNT ON; -- Maintain pallet overrides (143)');
   EXEC sys.sp_executesql @D;
  END;
  FETCH NEXT FROM procedures INTO @Name;
 END;CLOSE procedures;DEALLOCATE procedures;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
