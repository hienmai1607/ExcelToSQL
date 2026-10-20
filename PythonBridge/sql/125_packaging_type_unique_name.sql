-- After 124. Globally unique Packaging Type names; qualify legacy duplicates by parent.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.PackagingType','U') IS NULL THROW 52997,'Packaging Type table is missing.',1;
 IF COL_LENGTH('dbo.PackagingType','NormalizedTypeName') IS NULL
  ALTER TABLE dbo.PackagingType ADD NormalizedTypeName AS (LTRIM(RTRIM(PackagingType)) COLLATE Latin1_General_100_CI_AS) PERSISTED;
 -- Refresh SELECT * metadata before existing dimension triggers read root IDs.
 EXEC sys.sp_refreshview N'dbo.v_PackagingTypeDimensionContext';
 EXEC sys.sp_refreshview N'dbo.v_PackagingTypeWeb';
 EXEC sys.sp_executesql N' IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.PackagingType'') AND name=''IX_PackagingType_NormalizedName'')
  CREATE INDEX IX_PackagingType_NormalizedName ON dbo.PackagingType(NormalizedTypeName);
 -- Approved legacy cleanup: preserve IDs and foreign keys, change duplicate display names only.
 DECLARE @Names TABLE(ID INT PRIMARY KEY,OldName NVARCHAR(100),NewName NVARCHAR(100));
 INSERT @Names(ID,OldName,NewName)
 SELECT t.ID,t.PackagingType,LEFT(LTRIM(RTRIM(t.PackagingType)),60)+N'' - ''+LEFT(COALESCE(p.PackagingType,t.PackagingOrder),37)
 FROM dbo.PackagingType t LEFT JOIN dbo.PackagingType p ON p.ID=t.ParentTypeID
 WHERE EXISTS(SELECT 1 FROM dbo.PackagingType other WHERE other.NormalizedTypeName=t.NormalizedTypeName AND other.ID<>t.ID)
 AND (t.ParentTypeID IS NOT NULL OR EXISTS(SELECT 1 FROM dbo.PackagingType other WHERE other.ParentTypeID IS NULL AND other.NormalizedTypeName=t.NormalizedTypeName AND other.ID<>t.ID));
 IF EXISTS(SELECT 1 FROM dbo.PackagingType a JOIN dbo.PackagingType b ON a.ID<b.ID
  LEFT JOIN @Names na ON na.ID=a.ID LEFT JOIN @Names nb ON nb.ID=b.ID
  WHERE LTRIM(RTRIM(COALESCE(na.NewName,a.PackagingType))) COLLATE Latin1_General_100_CI_AS
      =LTRIM(RTRIM(COALESCE(nb.NewName,b.PackagingType))) COLLATE Latin1_General_100_CI_AS)
  THROW 52997,''Qualified Packaging Type names still collide. Review names before migrating.'',1;
 UPDATE t SET PackagingType=n.NewName,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.PackagingType t JOIN @Names n ON n.ID=t.ID;
';
 -- All names, including blocked types, are reserved globally.
 EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.tr_PackagingType_UniqueName ON dbo.PackagingType AFTER INSERT,UPDATE AS
 BEGIN
  SET NOCOUNT ON;
  IF EXISTS(SELECT 1 FROM inserted WHERE LEN(LTRIM(RTRIM(PackagingType)))=0)
   THROW 52997,''Packaging Type is required.'',1;
  IF EXISTS(
   SELECT 1 FROM inserted i JOIN dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK,INDEX(IX_PackagingType_NormalizedName))
    ON p.NormalizedTypeName=i.NormalizedTypeName AND p.ID<>i.ID
   WHERE NOT EXISTS(SELECT 1 FROM deleted d WHERE d.ID=i.ID AND d.NormalizedTypeName=i.NormalizedTypeName))
   THROW 52997,''Packaging Type must be unique. Edit the existing type or choose a different name.'',1;
 END;';
 -- The unique index is the final database-wide concurrency boundary.
 EXEC sys.sp_executesql N'IF NOT EXISTS(SELECT NormalizedTypeName FROM dbo.PackagingType GROUP BY NormalizedTypeName HAVING COUNT(*)>1)
 AND NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.PackagingType'') AND name=''UX_PackagingType_GlobalName'')
 CREATE UNIQUE INDEX UX_PackagingType_GlobalName ON dbo.PackagingType(NormalizedTypeName);';
 -- Keep API and Excel batch errors explicit before the unique-index boundary.
 DECLARE @Writer NVARCHAR(MAX)=REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch')),CHAR(13)+CHAR(10),CHAR(10));
 DECLARE @OldWhere NVARCHAR(MAX)=N'WHERE @Parent IS NULL AND ParentTypeID IS NULL AND PackagingType=@Name AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o JOIN @ChosenOrders c ON c.PackagingOrder=o.PackagingOrder WHERE o.PackagingTypeID=dbo.PackagingType.ID) AND (@Cmd=''C'' OR ID<>@ID)';
 IF CHARINDEX(@OldWhere,@Writer)>0
 BEGIN
  SET @Writer=REPLACE(@Writer,@OldWhere,N'WHERE NormalizedTypeName=LTRIM(RTRIM(@Name)) COLLATE Latin1_General_100_CI_AS AND (@Cmd=''C'' OR ID<>@ID)');
  SET @Writer=REPLACE(@Writer,N'This Packaging Type already exists for this Order. Edit the existing record instead.',N'Packaging Type must be unique. Edit the existing type or choose a different name.');
  SET @Writer=STUFF(@Writer,1,CHARINDEX(N'PROCEDURE',UPPER(@Writer))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @Writer;
 END
 ELSE IF @Writer IS NULL OR CHARINDEX(N'WHERE NormalizedTypeName=LTRIM(RTRIM(@Name))',@Writer)=0
  THROW 52997,'Unexpected Packaging Type writer. Review global name validation before migrating.',1;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
