USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Product','IsMix') IS NULL THROW 52960,'Apply migration 29 first.',1;
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
  (SELECT COUNT(*) FROM OPENJSON(j.value))<>4 OR
  (SELECT COUNT(DISTINCT [key]) FROM OPENJSON(j.value) WHERE [key] COLLATE Latin1_General_100_BIN2 IN('ParentID','ID','Grade','RatioPct'))<>4)
  THROW 52960,'Each grade item requires ParentID, ID, Grade and RatioPct.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
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
 DECLARE @Tree TABLE(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),NodePath NVARCHAR(66));
 INSERT @Tree
 SELECT ParentID,ID,LTRIM(RTRIM(Grade)),RatioPct,ParentID+N'/'+CONVERT(NVARCHAR(4),ID)
 FROM OPENJSON(@Items) WITH(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2));
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
  INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct)
   SELECT @VersionID,ParentID,ID,Grade,RatioPct FROM @Tree;
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

CREATE OR ALTER PROCEDURE dbo.usp_ProductMix_Grades_Read @ProductID INT,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Product'))
  THROW 52954,'Product access is required for this action.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ProductID AND IsMix=1)
  THROW 52960,'Choose a Product Mix to view child grades.',1;
 SELECT ID,ProductCode,ProductName FROM dbo.Product WHERE ID=@ProductID;
 SELECT ID,Version,Status FROM dbo.ProductMixVersion WHERE ProductID=@ProductID ORDER BY Version DESC;
 -- Current active child grades, not a historical snapshot of the mix version.
 SELECT mv.ID AS MixVersionID,mi.ProductID,p.ProductCode,p.ProductName,mi.UnitQuantity,
  gv.Version AS GradeVersion,gv.Status AS GradeStatus,gi.ParentID,gi.ID,gi.Grade,gi.RatioPct
 FROM dbo.ProductMixVersion mv JOIN dbo.ProductMixItem mi ON mi.VersionID=mv.ID
 JOIN dbo.Product p ON p.ID=mi.ProductID
 LEFT JOIN dbo.ProductGradeVersion gv ON gv.ProductID=p.ID AND gv.Status='Active'
 LEFT JOIN dbo.ProductGradeItem gi ON gi.VersionID=gv.ID
 WHERE mv.ProductID=@ProductID
 ORDER BY mv.Version DESC,p.ProductCode,LEN(gi.ParentID),gi.ParentID,gi.ID;
END
GO
