USE [test];
GO
-- After 66. Cumulative 1..3 packaging layers, frozen requests, independent responses.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.OpportunityItem','PackagingLayerCount') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PackagingLayerCount INT NOT NULL CONSTRAINT DF_OpportunityItem_PackagingLayers DEFAULT(2) WITH VALUES,
 TertiaryTypeID INT NULL REFERENCES dbo.PackagingType(ID),TertiaryTransparency NVARCHAR(100) NULL,NumberOfSecondary INT NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','RequestedLayerCount') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD RequestedLayerCount INT NOT NULL CONSTRAINT DF_PackagingRequestItem_Layers DEFAULT(2) WITH VALUES,
 ResponseLayerCount INT NULL,TertiaryTypeID INT NULL,TertiaryTypeName NVARCHAR(100) NULL,TertiaryTransparency NVARCHAR(100) NULL,NumberOfSecondary INT NULL,
 ThirdPMType NVARCHAR(100) NULL,ThirdPMMOQ DECIMAL(18,4) NULL,UnitsPerTertiary INT NULL;
GO
IF OBJECT_ID('dbo.CK_OpportunityItem_PackagingLayers','C') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_OpportunityItem_PackagingLayers CHECK(PackagingLayerCount BETWEEN 1 AND 3),
 CONSTRAINT CK_OpportunityItem_TertiaryTransparency CHECK(TertiaryTransparency IN(N'Transparent',N'Opaque',N'NA')),
 CONSTRAINT CK_OpportunityItem_NumberOfSecondary CHECK(NumberOfSecondary>=1);
IF OBJECT_ID('dbo.CK_PackagingRequestItem_Layers','C') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CONSTRAINT CK_PackagingRequestItem_Layers CHECK(RequestedLayerCount BETWEEN 1 AND 3 AND (ResponseLayerCount IS NULL OR ResponseLayerCount BETWEEN 1 AND 3)),
 CONSTRAINT CK_PackagingRequestItem_ThirdMOQ CHECK(ThirdPMMOQ>=0),
 CONSTRAINT CK_PackagingRequestItem_TertiaryUnits CHECK(UnitsPerTertiary>=1),
 CONSTRAINT CK_PackagingRequestItem_NumberOfSecondary CHECK(NumberOfSecondary>=1),
 CONSTRAINT CK_PackagingRequestItem_TertiaryTransparency CHECK(TertiaryTransparency IN(N'Transparent',N'Opaque',N'NA'));
DECLARE @Name SYSNAME,@DDL NVARCHAR(MAX);
DECLARE checks_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.check_constraints
 WHERE parent_object_id=OBJECT_ID('dbo.PkgPricingMaster') AND definition LIKE '%PackagingOrder%';
OPEN checks_cursor;FETCH NEXT FROM checks_cursor INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @DDL=N'ALTER TABLE dbo.PkgPricingMaster DROP CONSTRAINT '+QUOTENAME(@Name);EXEC sys.sp_executesql @DDL;
 FETCH NEXT FROM checks_cursor INTO @Name;
END;
CLOSE checks_cursor;DEALLOCATE checks_cursor;
ALTER TABLE dbo.PkgPricingMaster WITH CHECK ADD CONSTRAINT CK_PkgPricingMaster_Order CHECK(PackagingOrder IN('Primary','Secondary','Tertiary'));
COMMIT;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityPackagingTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT ID,PackagingOrder,PackagingOrdersJSON,PackagingType,ParentTypeID,Status FROM dbo.v_PackagingTypeWeb
 WHERE ParentTypeID IS NULL AND Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingResponseTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@Actor OUTPUT;
 SELECT ID,PackagingOrder,PackagingOrdersJSON,PackagingType,ParentTypeID FROM dbo.v_PackagingTypeWeb
 WHERE Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItem_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Opportunity')
  THROW 52954,'Opportunity access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest','ConfigurationRequest','PackagingType','RecyclableRequirement','RecycledContent','Transparency','MetalizedAluminum','SpecialComments','PrimaryTypeID','SecondaryTypeID','SecondaryTransparency','NumberOfPrimary','WebPackagingRequirements','PackagingLayerCount','TertiaryTypeID','TertiaryTransparency','NumberOfSecondary'))
  THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
  THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=@ID AND (i.Stage<>'Draft' OR o.Stage<>'Draft'))
  THROW 52960,'Only Draft Opportunity items can be edited.',1;
 -- Parent-only logistics: preserve the established mix-child restriction.
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest'))
  THROW 52960,'Pallet and Container requirements belong to the parent item only.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID','TertiaryTypeID','NumberOfPrimary','NumberOfSecondary') AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52957,'Type IDs and Number of Primary must be positive whole numbers.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency' AND [type]<>0
  AND ([type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Transparent',N'Opaque',N'NA')))
  THROW 52957,'Choose Transparent, Opaque or NA for Secondary transparency.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID','TertiaryTypeID') AND [type]<>0
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK) WHERE p.ID=TRY_CONVERT(INT,[value])
   AND ((p.Status='Active' AND p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID AND o.PackagingOrder=CASE [key] WHEN 'PrimaryTypeID' THEN 'Primary' WHEN 'SecondaryTypeID' THEN 'Secondary' ELSE 'Tertiary' END))
    OR EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND CASE [key] WHEN 'PrimaryTypeID' THEN i.PrimaryTypeID WHEN 'SecondaryTypeID' THEN i.SecondaryTypeID ELSE i.TertiaryTypeID END=p.ID))))
  THROW 52957,'Choose an active top-level Packaging Type with the matching Order.',1;
 DECLARE @Layers INT;
 SELECT @Layers=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingLayerCount')
  THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,'$.PackagingLayerCount')) ELSE PackagingLayerCount END FROM dbo.OpportunityItem WHERE ID=@ID;
 IF @Layers IS NULL OR @Layers NOT BETWEEN 1 AND 3 OR EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingLayerCount'
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%'))
  THROW 52957,'Packaging layers must be 1, 2 or 3.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='TertiaryTransparency' AND j.[type]<>0
  AND (j.[type]<>1 OR j.[value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Transparent',N'Opaque',N'NA')))
  THROW 52957,'Choose Transparent, Opaque or NA for Tertiary transparency.',1;

 DECLARE @Web BIT=CASE WHEN JSON_VALUE(@Fields,'$.WebPackagingRequirements')='true' THEN 1 ELSE 0 END,@Configuration NVARCHAR(500);
 SELECT @Configuration=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ConfigurationRequest')
  THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,'$.ConfigurationRequest'))),N'') ELSE ConfigurationRequest END FROM dbo.OpportunityItem WHERE ID=@ID;
 IF @Web=1
 BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key] IN('ContainerRequest','ConfigurationRequest','PalletStacking','Transparency')
   AND j.[type]<>0 AND NOT(
    (j.[key]='ContainerRequest' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Dry',N'Reefer')) OR
    (j.[key]='ConfigurationRequest' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Pallet load',N'Floor load',N'Both')) OR
    (j.[key]='PalletStacking' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Single',N'Double')) OR
    (j.[key]='Transparency' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Transparent',N'Opaque',N'NA')) OR
    EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND
     CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),CASE j.[key] WHEN 'ContainerRequest' THEN i.ContainerRequest WHEN 'ConfigurationRequest' THEN i.ConfigurationRequest WHEN 'PalletStacking' THEN i.PalletStacking ELSE i.Transparency END))))
   THROW 52957,'Choose valid Container, Configuration, Pallet stacking and Primary transparency options.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='PalletSize' AND j.[type]<>0
   AND NOT EXISTS(SELECT 1 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID WHERE p.PalletSize=j.[value] AND p.Status='Active' AND u.Status='Active')
   AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND i.PalletSize=j.[value]))
   THROW 52957,'Choose an active pallet size from Pallet Master.',1;
 END;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
  UPDATE t SET
   PalletSize=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletSize') THEN NULLIF(LTRIM(RTRIM(j.PalletSize)),N'') ELSE t.PalletSize END,
   PalletStacking=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletStacking') THEN NULLIF(LTRIM(RTRIM(j.PalletStacking)),N'') ELSE t.PalletStacking END,
   MaxPalletHeightM=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MaxPalletHeightM') THEN j.MaxPalletHeightM ELSE t.MaxPalletHeightM END,
   ContainerRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ContainerRequest') THEN NULLIF(LTRIM(RTRIM(j.ContainerRequest)),N'') ELSE t.ContainerRequest END,
   ConfigurationRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ConfigurationRequest') THEN NULLIF(LTRIM(RTRIM(j.ConfigurationRequest)),N'') ELSE t.ConfigurationRequest END,
   PackagingType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingType') THEN NULLIF(LTRIM(RTRIM(j.PackagingType)),N'') ELSE t.PackagingType END,
   RecyclableRequirement=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecyclableRequirement') THEN NULLIF(LTRIM(RTRIM(j.RecyclableRequirement)),N'') ELSE t.RecyclableRequirement END,
   RecycledContent=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecycledContent') THEN NULLIF(LTRIM(RTRIM(j.RecycledContent)),N'') ELSE t.RecycledContent END,
   Transparency=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Transparency') THEN NULLIF(LTRIM(RTRIM(j.Transparency)),N'') ELSE t.Transparency END,
   MetalizedAluminum=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MetalizedAluminum') THEN NULLIF(LTRIM(RTRIM(j.MetalizedAluminum)),N'') ELSE t.MetalizedAluminum END,
   SpecialComments=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SpecialComments') THEN NULLIF(LTRIM(RTRIM(j.SpecialComments)),N'') ELSE t.SpecialComments END,
   PackagingLayerCount=@Layers,
   TertiaryTypeID=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='TertiaryTypeID') THEN j.TertiaryTypeID ELSE t.TertiaryTypeID END,
   TertiaryTransparency=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='TertiaryTransparency') THEN j.TertiaryTransparency ELSE t.TertiaryTransparency END,
   NumberOfSecondary=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NumberOfSecondary') THEN j.NumberOfSecondary ELSE t.NumberOfSecondary END,
   PrimaryTypeID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PrimaryTypeID') THEN j.PrimaryTypeID ELSE t.PrimaryTypeID END,
   SecondaryTypeID=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTypeID') THEN j.SecondaryTypeID ELSE t.SecondaryTypeID END,
   SecondaryTransparency=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency') THEN j.SecondaryTransparency ELSE t.SecondaryTransparency END,
   NumberOfPrimary=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NumberOfPrimary') THEN j.NumberOfPrimary ELSE t.NumberOfPrimary END,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
  FROM dbo.OpportunityItem t CROSS APPLY OPENJSON(@Fields) WITH(
   PalletSize NVARCHAR(100),PalletStacking NVARCHAR(100),MaxPalletHeightM DECIMAL(9,3),ContainerRequest NVARCHAR(200),
   ConfigurationRequest NVARCHAR(500),PackagingType NVARCHAR(100),RecyclableRequirement NVARCHAR(200),RecycledContent NVARCHAR(200),
   Transparency NVARCHAR(100),MetalizedAluminum NVARCHAR(100),SpecialComments NVARCHAR(1000),
   PrimaryTypeID INT,SecondaryTypeID INT,SecondaryTransparency NVARCHAR(100),NumberOfPrimary INT,TertiaryTypeID INT,TertiaryTransparency NVARCHAR(100),NumberOfSecondary INT) j
  WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
  THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Packaging')
 THROW 52954,'Packaging access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('FirstPMType','SecondPMType','ThirdPMType','UnitsPerCarton','PackagingDescription','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer','NutDensity','ResponseLayerCount','ThirdPMType','ThirdPMMOQ','UnitsPerTertiary'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 
 
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND Stage IN('Assigned','Working','Returned') AND (@Admin=1 OR PICUserID=@Actor))
 THROW 52960,'Only the assigned PIC or Admin can edit an unlocked response.',1;

 -- New selections must be active types in the matching order. Unchanged legacy
 -- selections remain valid so unrelated edits do not rewrite historical data.
 IF EXISTS(
  SELECT 1 FROM OPENJSON(@Fields) j
  JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  CROSS APPLY(SELECT NULLIF(LTRIM(RTRIM(j.value)),N'') NewType,
   CASE j.[key] WHEN 'FirstPMType' THEN i.FirstPMType WHEN 'SecondPMType' THEN i.SecondPMType ELSE i.ThirdPMType END OldType,
   CASE j.[key] WHEN 'FirstPMType' THEN N'Primary' WHEN 'SecondPMType' THEN N'Secondary' ELSE N'Tertiary' END PackagingOrder) v
  WHERE j.[key] IN('FirstPMType','SecondPMType','ThirdPMType') AND v.NewType IS NOT NULL
  AND (v.OldType IS NULL OR v.NewType COLLATE Latin1_General_100_BIN2<>v.OldType COLLATE Latin1_General_100_BIN2)
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
   WHERE EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=v.PackagingOrder) AND PackagingType COLLATE Latin1_General_100_BIN2=v.NewType COLLATE Latin1_General_100_BIN2 AND Status='Active'))
  THROW 52961,'Choose an active Primary, Secondary or Tertiary Type in the matching Packaging Type Master order.',1;

 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='NutDensity' AND j.[type]<>0 AND
  (TRY_CONVERT(DECIMAL(18,6),j.value) IS NULL OR TRY_CONVERT(DECIMAL(18,6),j.value)<=0
   OR TRY_CONVERT(DECIMAL(38,18),j.value)<>TRY_CONVERT(DECIMAL(18,6),j.value)))
  THROW 52961,'Nut Density must be positive with at most 6 decimal places.',1;


 DECLARE @Layers INT;
 SELECT @Layers=COALESCE(CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ResponseLayerCount')
  THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,'$.ResponseLayerCount')) ELSE ResponseLayerCount END,RequestedLayerCount)
 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
 IF @Layers NOT BETWEEN 1 AND 3 OR EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ResponseLayerCount' AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) NOT BETWEEN 1 AND 3))
  THROW 52961,'Confirmed packaging layers must be 1, 2 or 3.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerTertiary' AND [type]<>0
  AND ([value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52961,'Secondary units per Tertiary must be a positive whole number.',1;

 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 ResponseLayerCount=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ResponseLayerCount') THEN j.ResponseLayerCount ELSE t.ResponseLayerCount END,
 ThirdPMType=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ThirdPMType') THEN NULLIF(LTRIM(RTRIM(j.ThirdPMType)),N'') ELSE t.ThirdPMType END,
 ThirdPMMOQ=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ThirdPMMOQ') THEN j.ThirdPMMOQ ELSE t.ThirdPMMOQ END,
 UnitsPerTertiary=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerTertiary') THEN j.UnitsPerTertiary ELSE t.UnitsPerTertiary END,
 NutDensity=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NutDensity') THEN j.NutDensity ELSE t.NutDensity END,
 FirstPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMType') THEN NULLIF(LTRIM(RTRIM(j.FirstPMType)),N'') ELSE t.FirstPMType END,
 SecondPMType=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMType') THEN NULLIF(LTRIM(RTRIM(j.SecondPMType)),N'') ELSE t.SecondPMType END,
 UnitsPerCarton=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerCarton') THEN j.UnitsPerCarton ELSE t.UnitsPerCarton END,
 PackagingDescription=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingDescription') THEN NULLIF(LTRIM(RTRIM(j.PackagingDescription)),N'') ELSE t.PackagingDescription END,
 FirstPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMMOQ') THEN j.FirstPMMOQ ELSE t.FirstPMMOQ END,
 SecondPMMOQ=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMMOQ') THEN j.SecondPMMOQ ELSE t.SecondPMMOQ END,
 CartonsPerLayer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerLayer') THEN j.CartonsPerLayer ELSE t.CartonsPerLayer END,
 LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='LayersPerPallet') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,
 PacksPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PacksPerPallet') THEN j.PacksPerPallet ELSE t.PacksPerPallet END,
 CartonsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerContainer') THEN j.CartonsPerContainer ELSE t.CartonsPerContainer END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.PackagingConfigurationRequestItem t CROSS APPLY OPENJSON(@Fields) WITH(FirstPMType NVARCHAR(100),SecondPMType NVARCHAR(100),UnitsPerCarton INT,PackagingDescription NVARCHAR(500),FirstPMMOQ DECIMAL(18,4),SecondPMMOQ DECIMAL(18,4),CartonsPerLayer INT,LayersPerPallet INT,PacksPerPallet INT,CartonsPerContainer INT,NutDensity DECIMAL(18,6),ResponseLayerCount INT,ThirdPMType NVARCHAR(100),ThirdPMMOQ DECIMAL(18,4),UnitsPerTertiary INT) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Transition_AuditImplementation
    @Username NVARCHAR(100), @ID INT, @ExpectedRowVersion VARBINARY(8),
    @TargetStage VARCHAR(20), @Comment NVARCHAR(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT,@Action VARCHAR(20),@Stage VARCHAR(20),@PIC INT;
    IF @TargetStage IS NULL OR @TargetStage NOT IN('Working','Pending Review','Approved','Returned','Canceled')
        THROW 51129,'Unsupported target stage.',1;
    SET @Action=CASE WHEN @TargetStage IN('Working','Pending Review') THEN 'Maintain' ELSE 'Review' END;
    EXEC dbo.usp_Packaging_Authorize @Username,@Action,@ActorID OUTPUT;
    DECLARE @IsAdmin BIT=0;
    IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND Scope=N'Admin') SET @IsAdmin=1;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @Stage=Stage,@PIC=PICUserID FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK)
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        IF @Stage IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
        IF @IsAdmin=0 AND @Action='Maintain' AND (@PIC IS NULL OR @PIC<>@ActorID)
            THROW 51130,'Only the assigned PIC can submit this response.',1;
        IF NOT ((@TargetStage='Working' AND @Stage IN('Assigned','Returned'))
            OR (@TargetStage='Pending Review' AND @Stage IN('Assigned','Working','Returned'))
            OR (@TargetStage IN('Approved','Returned') AND @Stage='Pending Review')
            OR (@TargetStage='Canceled' AND @Stage IN('Assigned','Working','Returned','Pending Review')))
            THROW 51131,'Invalid Packaging stage transition.',1;
        IF @TargetStage IN('Returned','Canceled') AND NULLIF(LTRIM(RTRIM(@Comment)),N'') IS NULL
            THROW 51132,'A reason is required for return or cancellation.',1;
        IF @IsAdmin=0 AND @TargetStage='Approved' AND @PIC=@ActorID
            THROW 51133,'The assigned PIC cannot approve their own response.',1;
        IF @TargetStage IN('Pending Review','Approved') AND EXISTS(
          SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND (
           NULLIF(LTRIM(RTRIM(FirstPMType)),N'') IS NULL OR FirstPMMOQ IS NULL
           OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=2 AND (NULLIF(LTRIM(RTRIM(SecondPMType)),N'') IS NULL OR UnitsPerCarton IS NULL OR SecondPMMOQ IS NULL))
           OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=3 AND (NULLIF(LTRIM(RTRIM(ThirdPMType)),N'') IS NULL OR UnitsPerTertiary IS NULL OR ThirdPMMOQ IS NULL))))
          THROW 52963,'Type, units in the next layer and calculated MOQ are required for each confirmed packaging layer.',1;
        UPDATE dbo.PackagingConfigurationRequestItem
        SET Stage=@TargetStage,IsOpen=CASE WHEN @TargetStage IN('Approved','Canceled') THEN 0 ELSE 1 END,
            SubmittedAt=CASE WHEN @TargetStage='Pending Review' THEN SYSUTCDATETIME() ELSE SubmittedAt END,
            SubmittedBy=CASE WHEN @TargetStage='Pending Review' THEN @ActorID ELSE SubmittedBy END,
            ReviewedAt=CASE WHEN @Action='Review' THEN SYSUTCDATETIME()
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedAt END,
            ReviewedBy=CASE WHEN @Action='Review' THEN @ActorID
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedBy END,
            ManagerComment=CASE WHEN @Action='Review' THEN @Comment
                                WHEN @TargetStage='Pending Review' THEN NULL ELSE ManagerComment END,
            UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT ID,Stage,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_Save
 @Username NVARCHAR(100),@ItemID INT,@ExpectedRowVersion VARBINARY(8),@Snapshot NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 -- Called by the API ONLY after server-side recalculation, in the response transaction.
 DECLARE @Actor INT,@Order VARCHAR(10)=JSON_VALUE(@Snapshot,'$.PackagingOrder'),
  @TypeID INT=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.PackagingTypeID')),
  @OpportunityItem INT,@Opportunity INT,@Product INT,@ProductRV VARBINARY(8),@GradeVersion INT,@MixVersion INT,@Reference INT,
  @TypeName NVARCHAR(100)=JSON_VALUE(@Snapshot,'$.PackagingTypeName'),@ID INT;
 EXEC dbo.usp_PkgPricing_ItemAuthorize @Username,@ItemID,1,@ExpectedRowVersion;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF ISJSON(@Snapshot)<>1 OR @Order IS NULL OR @Order NOT IN('Primary','Secondary','Tertiary') OR @TypeID IS NULL
  THROW 51111,'Invalid pricing snapshot.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@TypeID AND Status='Active' AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=@Order) AND PackagingType=@TypeName)
  THROW 51111,'Choose an active Packaging Type in the matching order.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID AND
  CASE @Order WHEN 'Primary' THEN FirstPMType WHEN 'Secondary' THEN SecondPMType ELSE ThirdPMType END=@TypeName AND CASE @Order WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END<=COALESCE(ResponseLayerCount,RequestedLayerCount))
  THROW 51111,'Calculator type must match the saved response type.',1;
 SELECT @OpportunityItem=i.OpportunityItemID,@Opportunity=h.OpportunityID,@Product=i.ProductID,@ProductRV=product.RowVersion
 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
 JOIN dbo.Product product ON product.ID=i.ProductID WHERE i.ID=@ItemID;
 SET @GradeVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductGradeVersion.ID'));
 SET @MixVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductMixVersion.ID'));
 SET @Reference=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.InputJSON.ReferencePricingMasterID'));
 IF @Reference IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.PkgPricingMaster WHERE ID=@Reference AND PackagingOrder=@Order)
  THROW 51111,'Invalid pricing reference.',1;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.components'))
  THROW 51111,'Select at least one component.',1;
 UPDATE dbo.PkgPricingMaster SET IsCurrent=0 WHERE RequestItemID=@ItemID AND PackagingOrder=@Order AND IsCurrent=1;
 INSERT dbo.PkgPricingMaster(RequestItemID,PackagingOrder,PackagingTypeID,PackagingTypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,CreatedBy,OpportunityItemID,OpportunityID,ProductID,ProductRowVersion,ProductGradeVersionID,ProductMixVersionID,SourcePricingMasterID,ContextSnapshotJSON,SnapshotJSON)
 SELECT @ItemID,@Order,@TypeID,@TypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,@Actor,@OpportunityItem,@Opportunity,@Product,@ProductRV,@GradeVersion,@MixVersion,@Reference,JSON_QUERY(@Snapshot,'$.Context'),@Snapshot
 FROM OPENJSON(@Snapshot) WITH(AsOfDate DATE,FinalMOQ DECIMAL(18,0),UnitPrice DECIMAL(28,9),CurrencyID INT,CurrencyCode NVARCHAR(20),UnitUSDPrice DECIMAL(28,9),Fingerprint CHAR(64),InputJSON NVARCHAR(MAX) AS JSON);
 SET @ID=SCOPE_IDENTITY();
 INSERT dbo.PkgPricingComponent(PricingMasterID,LineNumber,MaterialID,PackagingPriceID,DimensionID,QuantityPerProduct,AreaPerMaterial,BaseUnitsPerPriceUnit,PriceUnitsPerProduct,VendorMOQ,ProductMOQ,ProductUnitPrice,CurrencyID,ProductUnitUSDPrice,SnapshotJSON)
 SELECT @ID,CONVERT(INT,j.[key])+1,c.MaterialID,c.PriceID,c.DimensionID,c.Quantity,c.Area,c.Factor,c.Consumption,c.VendorMOQ,c.ProductMOQ,c.ProductUnitPrice,c.CurrencyID,c.ProductUnitUSDPrice,j.value
 FROM OPENJSON(@Snapshot,'$.components') j CROSS APPLY OPENJSON(j.value) WITH(MaterialID INT,PriceID INT,DimensionID INT,Quantity DECIMAL(18,6),Area DECIMAL(28,9),Factor DECIMAL(24,9),Consumption DECIMAL(28,12),VendorMOQ DECIMAL(18,4),ProductMOQ DECIMAL(18,0),ProductUnitPrice DECIMAL(28,9),CurrencyID INT,ProductUnitUSDPrice DECIMAL(28,9)) c;
 -- Keep a lightweight reference in the request's normal change log.
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,IsResponse)
 SELECT NEWID(),RequestID,'Item',ID,ProductCode,'Update',@Order+'Pricing',NULL,
  CONCAT('Pricing #',@ID,': MOQ ',JSON_VALUE(@Snapshot,'$.FinalMOQ'),', unit price ',JSON_VALUE(@Snapshot,'$.UnitPrice'),' ',JSON_VALUE(@Snapshot,'$.CurrencyCode')),@Username,'User',1
 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID;
END;
GO

-- Extend creation at INSERT time: never refresh a saved request from live source data.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52970,'Request creation implementation is missing.',1;
IF CHARINDEX(N'RequestedLayerCount',@D)=0
BEGIN
 IF CHARINDEX(N'SecondaryTransparency,NumberOfPrimary)',@D)=0 THROW 52970,'Unexpected request creation signature.',1;
 SET @D=REPLACE(@D,N'SecondaryTransparency,NumberOfPrimary)',N'SecondaryTransparency,NumberOfPrimary,RequestedLayerCount,TertiaryTypeID,TertiaryTypeName,TertiaryTransparency,NumberOfSecondary)');
 SET @D=REPLACE(@D,N'i.SecondaryTransparency,i.NumberOfPrimary',N'i.SecondaryTransparency,i.NumberOfPrimary,i.PackagingLayerCount,i.TertiaryTypeID,(SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.TertiaryTypeID),i.TertiaryTransparency,i.NumberOfSecondary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_ProcessingLock'));
IF @D IS NULL THROW 52970,'Opportunity processing lock is missing.',1;
IF CHARINDEX(N'i.PackagingLayerCount',@D)=0
BEGIN
 IF CHARINDEX(N'i.NumberOfPrimary',@D)=0 THROW 52970,'Unexpected Opportunity processing lock.',1;
 SET @D=REPLACE(@D,N'i.NumberOfPrimary',N'i.NumberOfPrimary,i.PackagingLayerCount,i.TertiaryTypeID,CONVERT(VARBINARY(MAX),i.TertiaryTransparency),i.NumberOfSecondary');
 SET @D=REPLACE(@D,N'd.NumberOfPrimary',N'd.NumberOfPrimary,d.PackagingLayerCount,d.TertiaryTypeID,CONVERT(VARBINARY(MAX),d.TertiaryTransparency),d.NumberOfSecondary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingRequestItem_LayerSnapshotImmutable
ON dbo.PackagingConfigurationRequestItem AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID WHERE EXISTS(
 SELECT i.RequestedLayerCount,i.PrimaryTypeID,CONVERT(VARBINARY(MAX),i.PrimaryTypeName),i.SecondaryTypeID,CONVERT(VARBINARY(MAX),i.SecondaryTypeName),
 CONVERT(VARBINARY(MAX),i.SecondaryTransparency),i.NumberOfPrimary,i.TertiaryTypeID,CONVERT(VARBINARY(MAX),i.TertiaryTypeName),CONVERT(VARBINARY(MAX),i.TertiaryTransparency),i.NumberOfSecondary
 EXCEPT
 SELECT d.RequestedLayerCount,d.PrimaryTypeID,CONVERT(VARBINARY(MAX),d.PrimaryTypeName),d.SecondaryTypeID,CONVERT(VARBINARY(MAX),d.SecondaryTypeName),
 CONVERT(VARBINARY(MAX),d.SecondaryTransparency),d.NumberOfPrimary,d.TertiaryTypeID,CONVERT(VARBINARY(MAX),d.TertiaryTypeName),CONVERT(VARBINARY(MAX),d.TertiaryTransparency),d.NumberOfSecondary))
  THROW 52981,'Request layers and specifications are immutable. Create a revised request instead.',1;
END;
GO
-- Use established actor/event contexts for both requested and confirmed layers.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Rows NVARCHAR(MAX),@Field SYSNAME,@Response BIT;
DECLARE triggers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN(N'tr_OpportunityItem_ChangeLog',N'tr_PackagingConfigurationRequestItem_ChangeLog');
OPEN triggers;FETCH NEXT FROM triggers INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));SET @Rows=N'';
 DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
 WHERE object_id=OBJECT_ID(CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'dbo.OpportunityItem' ELSE N'dbo.PackagingConfigurationRequestItem' END)
 AND name IN(N'PackagingLayerCount',N'RequestedLayerCount',N'ResponseLayerCount',N'TertiaryTypeID',N'TertiaryTypeName',N'TertiaryTransparency',N'NumberOfSecondary',N'ThirdPMType',N'ThirdPMMOQ',N'UnitsPerTertiary');
 OPEN fields;FETCH NEXT FROM fields INTO @Field;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Response=CASE WHEN @Field IN(N'ResponseLayerCount',N'ThirdPMType',N'ThirdPMMOQ',N'UnitsPerTertiary') THEN 1 ELSE 0 END;
  IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
   SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N')'+CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'' ELSE N','+CONVERT(NVARCHAR(1),@Response) END+N'),';
  FETCH NEXT FROM fields INTO @Field;
 END;
 CLOSE fields;DEALLOCATE fields;
 IF @Rows<>N''
 BEGIN
  IF CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52970,'Unexpected change log trigger.',1;
  SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM triggers INTO @Name;
END;
CLOSE triggers;DEALLOCATE triggers;
GO
