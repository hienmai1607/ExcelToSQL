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
