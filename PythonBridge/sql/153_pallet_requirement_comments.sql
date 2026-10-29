-- After 152. Palletization comments belong to captured Packaging requirements.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.OpportunityItem','PalletSpecialComments') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PalletSpecialComments NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletSpecialComments') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletSpecialComments NVARCHAR(1000) NULL;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL THROW 52996,'Opportunity fields procedure is missing.',1;
IF CHARINDEX('PalletSpecialComments',@D)=0
BEGIN
 IF CHARINDEX('WHERE [key] NOT IN(',@D)=0 OR CHARINDEX('UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',@D)=0
  THROW 52996,'Unexpected Opportunity fields procedure. Review migration 153.',1;
 SET @D=REPLACE(@D,N'WHERE [key] NOT IN(',N'WHERE [key] NOT IN(''PalletSpecialComments'',');
 SET @D=REPLACE(@D,N'UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',N'PalletSpecialComments=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''PalletSpecialComments'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.PalletSpecialComments''))),N'''') ELSE t.PalletSpecialComments END,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''PalletSpecialComments'' AND ([type] NOT IN(0,1) OR DATALENGTH([value])>2000)) THROW 52996,''Pallet special comments must be text up to 1000 characters.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52996,'Packaging request creation implementation is missing.',1;
IF CHARINDEX('PalletSpecialComments',@D)=0
BEGIN
 IF CHARINDEX('QuaternarySpecialComments,ResponseLayerCount',@D)=0 OR CHARINDEX('i.QuaternarySpecialComments,i.PackagingLayerCount',@D)=0
  THROW 52996,'Unexpected Packaging request INSERT. Review migration 153.',1;
 SET @D=REPLACE(@D,N'QuaternarySpecialComments,ResponseLayerCount',N'QuaternarySpecialComments,PalletSpecialComments,ResponseLayerCount');
 SET @D=REPLACE(@D,N'i.QuaternarySpecialComments,i.PackagingLayerCount',N'i.QuaternarySpecialComments,i.PalletSpecialComments,i.PackagingLayerCount');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
DECLARE @Name SYSNAME;
DECLARE locks CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers WHERE name IN('tr_OpportunityItem_ProcessingLock','tr_PackagingRequestItem_LayerSnapshotImmutable');
OPEN locks;FETCH NEXT FROM locks INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));
 IF CHARINDEX('PalletSpecialComments',@D)=0
 BEGIN
  IF CHARINDEX('CONVERT(VARBINARY(MAX),i.TertiarySpecialComments)',@D)=0 OR CHARINDEX('CONVERT(VARBINARY(MAX),d.TertiarySpecialComments)',@D)=0
   THROW 52996,'Unexpected requirement snapshot guard. Review migration 153.',1;
  SET @D=REPLACE(@D,N'CONVERT(VARBINARY(MAX),i.TertiarySpecialComments)',N'CONVERT(VARBINARY(MAX),i.TertiarySpecialComments),CONVERT(VARBINARY(MAX),i.PalletSpecialComments)');
  SET @D=REPLACE(@D,N'CONVERT(VARBINARY(MAX),d.TertiarySpecialComments)',N'CONVERT(VARBINARY(MAX),d.TertiarySpecialComments),CONVERT(VARBINARY(MAX),d.PalletSpecialComments)');
  SET @D=STUFF(@D,1,CHARINDEX(N'TRIGGER',UPPER(@D))+LEN(N'TRIGGER')-1,N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM locks INTO @Name;
END;
CLOSE locks;DEALLOCATE locks;
COMMIT TRANSACTION;
GO
