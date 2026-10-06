USE [test];
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
