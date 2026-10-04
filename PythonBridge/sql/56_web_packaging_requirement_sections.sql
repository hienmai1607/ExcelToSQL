USE [test];
GO
-- After 55. Web-only requirement sections. Existing Excel/Layout contracts remain.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF COL_LENGTH('dbo.OpportunityItem','PrimaryTypeID') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PrimaryTypeID INT NULL,SecondaryTypeID INT NULL,
 SecondaryTransparency NVARCHAR(100) NULL,NumberOfPrimary INT NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PrimaryTypeID') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PrimaryTypeID INT NULL,PrimaryTypeName NVARCHAR(100) NULL,
 SecondaryTypeID INT NULL,SecondaryTypeName NVARCHAR(100) NULL,SecondaryTransparency NVARCHAR(100) NULL,NumberOfPrimary INT NULL;
GO
IF OBJECT_ID('dbo.FK_OpportunityItem_PrimaryType','F') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT FK_OpportunityItem_PrimaryType FOREIGN KEY(PrimaryTypeID) REFERENCES dbo.PackagingType(ID);
IF OBJECT_ID('dbo.FK_OpportunityItem_SecondaryType','F') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT FK_OpportunityItem_SecondaryType FOREIGN KEY(SecondaryTypeID) REFERENCES dbo.PackagingType(ID);
IF OBJECT_ID('dbo.CK_OpportunityItem_NumberOfPrimary','C') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT CK_OpportunityItem_NumberOfPrimary CHECK(NumberOfPrimary>=1);
IF OBJECT_ID('dbo.CK_OpportunityItem_SecondaryTransparency','C') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT CK_OpportunityItem_SecondaryTransparency CHECK(SecondaryTransparency IN(N'Transparent',N'Opaque',N'NA'));
IF OBJECT_ID('dbo.CK_PackagingRequestItem_NumberOfPrimary','C') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK ADD CONSTRAINT CK_PackagingRequestItem_NumberOfPrimary CHECK(NumberOfPrimary>=1);
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityPackagingTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT ID,PackagingOrder,PackagingType,ParentTypeID,Status FROM dbo.PackagingType
 WHERE ParentTypeID IS NULL AND Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest','ConfigurationRequest','PackagingType','RecyclableRequirement','RecycledContent','Transparency','MetalizedAluminum','SpecialComments','PrimaryTypeID','SecondaryTypeID','SecondaryTransparency','NumberOfPrimary','WebPackagingRequirements'))
  THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
  THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=@ID AND (i.Stage<>'Draft' OR o.Stage<>'Draft'))
  THROW 52960,'Only Draft Opportunity items can be edited.',1;
 -- Parent-only logistics: preserve the established mix-child restriction.
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest'))
  THROW 52960,'Pallet and Container requirements belong to the parent item only.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID','NumberOfPrimary') AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52957,'Type IDs and Number of Primary must be positive whole numbers.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency' AND [type]<>0
  AND ([type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Transparent',N'Opaque',N'NA')))
  THROW 52957,'Choose Transparent, Opaque or NA for Secondary transparency.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID') AND [type]<>0
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK) WHERE p.ID=TRY_CONVERT(INT,[value])
   AND ((p.Status='Active' AND p.ParentTypeID IS NULL AND p.PackagingOrder=CASE WHEN [key]='PrimaryTypeID' THEN 'Primary' ELSE 'Secondary' END)
    OR EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND CASE WHEN [key]='PrimaryTypeID' THEN i.PrimaryTypeID ELSE i.SecondaryTypeID END=p.ID))))
  THROW 52957,'Choose an active top-level Packaging Type with the matching Order.',1;
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
   PrimaryTypeID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PrimaryTypeID') THEN j.PrimaryTypeID ELSE t.PrimaryTypeID END,
   SecondaryTypeID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTypeID') THEN j.SecondaryTypeID ELSE t.SecondaryTypeID END,
   SecondaryTransparency=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency') THEN j.SecondaryTransparency ELSE t.SecondaryTransparency END,
   NumberOfPrimary=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NumberOfPrimary') THEN j.NumberOfPrimary ELSE t.NumberOfPrimary END,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
  FROM dbo.OpportunityItem t CROSS APPLY OPENJSON(@Fields) WITH(
   PalletSize NVARCHAR(100),PalletStacking NVARCHAR(100),MaxPalletHeightM DECIMAL(9,3),ContainerRequest NVARCHAR(200),
   ConfigurationRequest NVARCHAR(500),PackagingType NVARCHAR(100),RecyclableRequirement NVARCHAR(200),RecycledContent NVARCHAR(200),
   Transparency NVARCHAR(100),MetalizedAluminum NVARCHAR(100),SpecialComments NVARCHAR(1000),
   PrimaryTypeID INT,SecondaryTypeID INT,SecondaryTransparency NVARCHAR(100),NumberOfPrimary INT) j
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
-- Extend processing locks without weakening their established comparisons.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_ProcessingLock'));
IF @D IS NULL THROW 52957,'Processing lock trigger is missing.',1;
IF CHARINDEX(N'i.PrimaryTypeID',@D)=0
BEGIN
 IF CHARINDEX(N'CONVERT(VARBINARY(MAX),i.SpecialComments)',@D)=0 THROW 52957,'Unexpected processing lock trigger.',1;
 SET @D=REPLACE(@D,N'CONVERT(VARBINARY(MAX),i.SpecialComments)',N'CONVERT(VARBINARY(MAX),i.SpecialComments),i.PrimaryTypeID,i.SecondaryTypeID,CONVERT(VARBINARY(MAX),i.SecondaryTransparency),i.NumberOfPrimary');
 SET @D=REPLACE(@D,N'CONVERT(VARBINARY(MAX),d.SpecialComments)',N'CONVERT(VARBINARY(MAX),d.SpecialComments),d.PrimaryTypeID,d.SecondaryTypeID,CONVERT(VARBINARY(MAX),d.SecondaryTransparency),d.NumberOfPrimary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
GO
-- Record new requirement fields with the existing actor/event audit contexts.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Rows NVARCHAR(MAX),@Field SYSNAME;
DECLARE triggers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN(N'tr_OpportunityItem_ChangeLog',N'tr_PackagingConfigurationRequestItem_ChangeLog');
OPEN triggers;FETCH NEXT FROM triggers INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));SET @Rows=N'';
 IF CHARINDEX(N'''PrimaryTypeID''',@D)=0
 BEGIN
  DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
   WHERE object_id=OBJECT_ID(CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'dbo.OpportunityItem' ELSE N'dbo.PackagingConfigurationRequestItem' END)
    AND name IN(N'PrimaryTypeID',N'SecondaryTypeID',N'SecondaryTransparency',N'NumberOfPrimary',N'PrimaryTypeName',N'SecondaryTypeName');
  OPEN fields;FETCH NEXT FROM fields INTO @Field;
  WHILE @@FETCH_STATUS=0
  BEGIN
   SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N')'+CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'' ELSE N',0' END+N'),';
   FETCH NEXT FROM fields INTO @Field;
  END;
  CLOSE fields;DEALLOCATE fields;
  IF CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52957,'Unexpected change log trigger.',1;
  SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM triggers INTO @Name;
END;
CLOSE triggers;DEALLOCATE triggers;
GO
-- New requests snapshot the requested types independently from response types.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52957,'Request snapshot implementation is missing.',1;
IF CHARINDEX(N'PrimaryTypeName',@D)=0
BEGIN
 IF CHARINDEX(N'SourceProductRowVersion,SnapshotCapturedAt,SnapshotOrigin)',@D)=0 THROW 52957,'Unexpected request snapshot implementation.',1;
 SET @D=REPLACE(@D,N'WHERE NULLIF(LTRIM(RTRIM(i.PackagingType)),N'''') IS NULL',N'WHERE NULLIF(LTRIM(RTRIM(i.PackagingType)),N'''') IS NULL AND i.PrimaryTypeID IS NULL');
 SET @D=REPLACE(@D,N'Packaging type is required for every selected item before creating a request.',N'Primary Type is required for every selected item before creating a request.');
 SET @D=REPLACE(@D,N'SourceProductRowVersion,SnapshotCapturedAt,SnapshotOrigin)',N'SourceProductRowVersion,SnapshotCapturedAt,SnapshotOrigin,PrimaryTypeID,PrimaryTypeName,SecondaryTypeID,SecondaryTypeName,SecondaryTransparency,NumberOfPrimary)');
 SET @D=REPLACE(@D,N'p.RowVersion,@SnapshotAt,''Request''',N'p.RowVersion,@SnapshotAt,''Request'',i.PrimaryTypeID,(SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.PrimaryTypeID),i.SecondaryTypeID,(SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.SecondaryTypeID),i.SecondaryTransparency,i.NumberOfPrimary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
