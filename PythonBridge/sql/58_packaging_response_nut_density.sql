USE [test];
GO
-- Run after 57. New web response fields; no legacy TVP/Layout/Excel changes.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'NutDensity') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD NutDensity DECIMAL(18,6) NULL;
GO
IF OBJECT_ID(N'dbo.CK_PackagingRequestItem_NutDensity',N'C') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK
 ADD CONSTRAINT CK_PackagingRequestItem_NutDensity CHECK(NutDensity IS NULL OR NutDensity>0);
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'UsedVolumeML') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem
 ADD UsedVolumeML AS CONVERT(DECIMAL(28,6),WeightGrams / NULLIF(NutDensity,0));
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('FirstPMType','SecondPMType','UnitsPerCarton','PackagingDescription','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer','NutDensity'))
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

 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='NutDensity' AND j.[type]<>0 AND
  (TRY_CONVERT(DECIMAL(18,6),j.value) IS NULL OR TRY_CONVERT(DECIMAL(18,6),j.value)<=0
   OR TRY_CONVERT(DECIMAL(38,18),j.value)<>TRY_CONVERT(DECIMAL(18,6),j.value)))
  THROW 52961,'Nut Density must be positive with at most 6 decimal places.',1;


 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 NutDensity=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NutDensity') THEN j.NutDensity ELSE t.NutDensity END,
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
 FROM dbo.PackagingConfigurationRequestItem t CROSS APPLY OPENJSON(@Fields) WITH(FirstPMType NVARCHAR(100),SecondPMType NVARCHAR(100),UnitsPerCarton INT,PackagingDescription NVARCHAR(500),FirstPMMOQ DECIMAL(18,4),SecondPMMOQ DECIMAL(18,4),CartonsPerLayer INT,LayersPerPallet INT,PacksPerPallet INT,CartonsPerContainer INT,NutDensity DECIMAL(18,6)) j
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
CREATE OR ALTER TRIGGER dbo.tr_PackagingRequestItem_Volume_ChangeLog
ON dbo.PackagingConfigurationRequestItem AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID()),
 @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'PackagingChangeUser')),
 @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'PackagingChangeSource'));
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System' WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason,IsResponse)
 SELECT @Event,COALESCE(i.RequestID,d.RequestID),'Item',COALESCE(i.ID,d.ID),COALESCE(i.ProductCode,d.ProductCode),
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),@Source,
 CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason')),1
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 CROSS APPLY(VALUES
  ('NutDensity',CONVERT(NVARCHAR(MAX),d.NutDensity),CONVERT(NVARCHAR(MAX),i.NutDensity)),
  ('UsedVolumeML',CONVERT(NVARCHAR(MAX),d.UsedVolumeML),CONVERT(NVARCHAR(MAX),i.UsedVolumeML))
 ) v(FieldName,OldValue,NewValue)
 WHERE (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END;
GO
COMMIT;
GO
