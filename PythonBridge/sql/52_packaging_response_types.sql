USE [test];
GO
-- Run after 51. Preserve historical PalletType, Cost and CurrencyID columns.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingResponseTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@Actor OUTPUT;
 SELECT ID,PackagingOrder,PackagingType FROM dbo.PackagingType
 WHERE Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('FirstPMType','SecondPMType','UnitsPerCarton','PackagingDescription','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer'))
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
   CASE j.[key] WHEN 'FirstPMType' THEN i.FirstPMType ELSE i.SecondPMType END OldType,
   CASE j.[key] WHEN 'FirstPMType' THEN N'Primary' ELSE N'Secondary' END PackagingOrder) v
  WHERE j.[key] IN('FirstPMType','SecondPMType') AND v.NewType IS NOT NULL
  AND (v.OldType IS NULL OR v.NewType COLLATE Latin1_General_100_BIN2<>v.OldType COLLATE Latin1_General_100_BIN2)
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
   WHERE PackagingOrder=v.PackagingOrder AND PackagingType COLLATE Latin1_General_100_BIN2=v.NewType COLLATE Latin1_General_100_BIN2 AND Status='Active'))
  THROW 52961,'Choose an active Primary Type or Secondary Type in the matching Packaging Type Master order.',1;

 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 FirstPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMType') THEN NULLIF(LTRIM(RTRIM(j.FirstPMType)),N'') ELSE t.FirstPMType END,
 SecondPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMType') THEN NULLIF(LTRIM(RTRIM(j.SecondPMType)),N'') ELSE t.SecondPMType END,
 UnitsPerCarton=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerCarton') THEN j.UnitsPerCarton ELSE t.UnitsPerCarton END,
 PackagingDescription=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingDescription') THEN NULLIF(LTRIM(RTRIM(j.PackagingDescription)),N'') ELSE t.PackagingDescription END,
 FirstPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMMOQ') THEN j.FirstPMMOQ ELSE t.FirstPMMOQ END,
 SecondPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMMOQ') THEN j.SecondPMMOQ ELSE t.SecondPMMOQ END,
 CartonsPerLayer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerLayer') THEN j.CartonsPerLayer ELSE t.CartonsPerLayer END,
 LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='LayersPerPallet') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,
 PacksPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PacksPerPallet') THEN j.PacksPerPallet ELSE t.PacksPerPallet END,
 CartonsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerContainer') THEN j.CartonsPerContainer ELSE t.CartonsPerContainer END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.PackagingConfigurationRequestItem t CROSS APPLY OPENJSON(@Fields) WITH(FirstPMType NVARCHAR(100),SecondPMType NVARCHAR(100),UnitsPerCarton INT,PackagingDescription NVARCHAR(500),FirstPMMOQ DECIMAL(18,4),SecondPMMOQ DECIMAL(18,4),CartonsPerLayer INT,LayersPerPallet INT,PacksPerPallet INT,CartonsPerContainer INT) j
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
CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID());
 BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'User';
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',NULL;
 EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation @Username,@ID,@ExpectedRowVersion,@Fields,@IsCreate;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO
