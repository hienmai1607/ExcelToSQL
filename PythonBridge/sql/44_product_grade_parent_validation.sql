USE [test];
GO
-- After 43. Validate direct Raw Grade parent relationships for Product tree children.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductGrade_Save
 @ProductID INT,@Username NVARCHAR(100),@VersionID INT=NULL,
 @ExpectedRowVersion VARBINARY(8)=NULL,@ExpectedProductRowVersion VARBINARY(8)=NULL,
 @Status VARCHAR(10)='Draft',@Items NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 DECLARE @Actor INT,@OwnTran BIT=0,@Version INT;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Admin','Product'))
  THROW 52954,'Product access is required for this action.',1;
 IF @Status IS NULL OR @Status NOT IN('Draft','Active')
  THROW 52960,'Grade status must be Draft or Active.',1;
 IF @Items IS NULL OR ISJSON(@Items)<>1 OR LEFT(LTRIM(@Items),1)<>'['
  THROW 52960,'Grade items must be a JSON array.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@Items)) NOT BETWEEN 1 AND 1000
  THROW 52960,'Enter between 1 and 1000 grade items.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) WHERE type<>5)
  THROW 52960,'Each grade item must be an object.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
  (SELECT COUNT(*) FROM OPENJSON(j.value))<>5 OR
  (SELECT COUNT(DISTINCT [key]) FROM OPENJSON(j.value) WHERE [key] COLLATE Latin1_General_100_BIN2 IN('ParentID','ID','Grade','RatioPct','RawGradeID'))<>5)
  THROW 52960,'Each grade item requires ParentID, ID, Grade, RatioPct and RawGradeID.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID')) IS NULL OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID'))<1 OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RawGradeID'))<>TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID')) OR
  JSON_VALUE(j.value,'$.ParentID') IS NULL OR LEN(JSON_VALUE(j.value,'$.ParentID'))>60 OR
  JSON_VALUE(j.value,'$.Grade') IS NULL OR LEN(LTRIM(RTRIM(JSON_VALUE(j.value,'$.Grade'))))=0 OR LEN(JSON_VALUE(j.value,'$.Grade'))>100 OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.ID')) IS NULL OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.ID')) NOT BETWEEN 1 AND 9999 OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.ID'))<>TRY_CONVERT(INT,JSON_VALUE(j.value,'$.ID')) OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RatioPct')) IS NULL OR
  JSON_VALUE(j.value,'$.RatioPct') COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9.]%' OR
  (CHARINDEX('.',JSON_VALUE(j.value,'$.RatioPct'))>0 AND LEN(JSON_VALUE(j.value,'$.RatioPct'))-CHARINDEX('.',JSON_VALUE(j.value,'$.RatioPct'))>2) OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RatioPct')) NOT BETWEEN 0.01 AND 100 OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RatioPct'))<>TRY_CONVERT(DECIMAL(5,2),JSON_VALUE(j.value,'$.RatioPct')))
  THROW 52960,'Invalid grade, ID or ratio. Use positive percentages with at most 2 decimals.',1;
 DECLARE @Tree TABLE(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),NodePath NVARCHAR(66),RawGradeID INT);
 INSERT @Tree
 SELECT ParentID,ID,LTRIM(RTRIM(Grade)),RatioPct,ParentID+N'/'+CONVERT(NVARCHAR(4),ID),RawGradeID
 FROM OPENJSON(@Items) WITH(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),RawGradeID INT);
 IF EXISTS(SELECT 1 FROM @Tree WHERE ParentID COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9/]%' OR (ParentID<>'0' AND (
  LEFT(ParentID,2)<>'0/' OR RIGHT(ParentID,1)='/' OR ParentID LIKE '%//%' OR
  ParentID COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9/]%' OR
  LEN(ParentID)-LEN(REPLACE(ParentID,'/',''))>11 OR
  EXISTS(SELECT 1 FROM STRING_SPLIT(SUBSTRING(ParentID,3,60),'/') WHERE
   TRY_CONVERT(INT,value) IS NULL OR TRY_CONVERT(INT,value) NOT BETWEEN 1 AND 9999 OR
   value<>CONVERT(VARCHAR(4),TRY_CONVERT(INT,value))))))
  THROW 52960,'Invalid parent path.',1;
 IF EXISTS(SELECT NodePath FROM @Tree GROUP BY NodePath HAVING COUNT(*)>1)
  THROW 52960,'Duplicate grade ID under the same parent.',1;
 IF EXISTS(SELECT 1 FROM @Tree t WHERE ParentID<>'0' AND NOT EXISTS(SELECT 1 FROM @Tree p WHERE p.NodePath=t.ParentID))
  THROW 52960,'Every parent must exist in this grade version.',1;
 IF EXISTS(SELECT ParentID FROM @Tree GROUP BY ParentID HAVING SUM(RatioPct)<>100)
  THROW 52960,'Ratios under each parent must total exactly 100%.',1;
 BEGIN TRY
  IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
  ELSE SAVE TRANSACTION ProductGradeSave;
  IF EXISTS(SELECT 1 FROM @Tree t WHERE NOT EXISTS(
   SELECT 1 FROM dbo.RawGrade g WITH(UPDLOCK,HOLDLOCK)
   LEFT JOIN dbo.RawMaterial m WITH(UPDLOCK,HOLDLOCK) ON m.ID=g.MaterialID
   WHERE g.ID=t.RawGradeID AND g.Status='Active' AND (g.MaterialID IS NULL OR m.Status='Active')))
   THROW 52960,'Select an active Raw Grade for every item; any assigned Raw Material must be active.',1;
  IF EXISTS(
   SELECT 1 FROM @Tree child JOIN @Tree parent ON parent.NodePath=child.ParentID
   JOIN dbo.RawGrade g ON g.ID=child.RawGradeID
   WHERE g.ParentGradeID IS NULL OR g.ParentGradeID<>parent.RawGradeID)
   THROW 52960,'Each child grade must belong to its selected parent in Raw Grade Master.',1;
  UPDATE t SET Grade=g.GradeName FROM @Tree t JOIN dbo.RawGrade g ON g.ID=t.RawGradeID;
  -- Serializes all version allocation, edits and activation for one Product.
  IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ProductID AND RowVersion=@ExpectedProductRowVersion)
   THROW 52958,'Product or its grade versions changed. Refresh before saving.',1;
  IF EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ProductID AND IsMix=1)
   THROW 52960,'Product Mix cannot maintain its own grades. Maintain grades on its child Products.',1;
  IF @VersionID IS NULL
  BEGIN
   IF @ExpectedRowVersion IS NOT NULL THROW 52960,'New grade versions cannot have a RowVersion.',1;
   SELECT @Version=COALESCE(MAX(Version),0)+1 FROM dbo.ProductGradeVersion WHERE ProductID=@ProductID;
   INSERT dbo.ProductGradeVersion(ProductID,Version,Status,CreatedBy) VALUES(@ProductID,@Version,'Draft',@Actor);
   SET @VersionID=SCOPE_IDENTITY();
  END
  ELSE
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.ProductGradeVersion WHERE ID=@VersionID AND ProductID=@ProductID AND RowVersion=@ExpectedRowVersion)
    THROW 52958,'Grade version changed. Refresh before saving.',1;
   IF EXISTS(SELECT 1 FROM dbo.ProductGradeVersion WHERE ID=@VersionID AND Status<>'Draft')
    THROW 52961,'Create a new version to change an Active or Inactive grade structure.',1;
   DELETE dbo.ProductGradeItem WHERE VersionID=@VersionID;
  END;
  INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct,RawGradeID)
   SELECT @VersionID,ParentID,ID,Grade,RatioPct,RawGradeID FROM @Tree;
  IF @Status='Active'
   UPDATE dbo.ProductGradeVersion SET Status='Inactive',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
   WHERE ProductID=@ProductID AND Status='Active' AND ID<>@VersionID;
  UPDATE dbo.ProductGradeVersion SET Status=@Status,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@VersionID;
  UPDATE dbo.Product SET UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ProductID;
  SELECT ID,ProductID,Version,Status,RowVersion,
   (SELECT RowVersion FROM dbo.Product WHERE ID=@ProductID) AS ProductRowVersion
  FROM dbo.ProductGradeVersion WHERE ID=@VersionID;
  IF @OwnTran=1 COMMIT;
 END TRY
 BEGIN CATCH
  IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
  ELSE IF @OwnTran=0 AND XACT_STATE()=1 ROLLBACK TRANSACTION ProductGradeSave;
  THROW;
 END CATCH
END;
GO
