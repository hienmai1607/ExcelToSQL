USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Extend the existing field-patch procedure without changing its signature.
CREATE OR ALTER PROCEDURE dbo.usp_Product_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Product')
 THROW 52954,'Product access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('Category','Grade','MixRatioPct','ProductCode','ProductName','WeightGrams','Status'))
 THROW 52957,'Unknown additional field.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE
 ([key]='ProductCode' AND (LEN(LTRIM(RTRIM(COALESCE([value],''))))=0 OR LEN([value])>20)) OR
 ([key]='ProductName' AND (LEN(LTRIM(RTRIM(COALESCE([value],''))))=0 OR LEN([value])>200)) OR
 ([key]='WeightGrams' AND (TRY_CONVERT(DECIMAL(10,2),[value]) IS NULL OR TRY_CONVERT(DECIMAL(10,2),[value])<=0)) OR
 ([key]='Status' AND ([value] IS NULL OR [value] NOT IN('Active','Block'))) OR
 ([key]='Category' AND LEN([value])>100) OR ([key]='Grade' AND LEN([value])>100) OR
 ([key]='MixRatioPct' AND [value] IS NOT NULL AND (TRY_CONVERT(DECIMAL(5,2),[value]) IS NULL OR TRY_CONVERT(DECIMAL(5,2),[value]) NOT BETWEEN 0 AND 100)) OR
 [type] IN(4,5))
 THROW 52957,'Invalid Product field value.',1;
 IF EXISTS(SELECT [key] FROM OPENJSON(@Fields) GROUP BY [key] HAVING COUNT(*)>1)
 THROW 52957,'Duplicate Product field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 IF @IsCreate=1 AND NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,'$.Category'))),'') IS NULL
 THROW 52959,'Category is required when creating a Product.',1;
 
 
 
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 ProductCode=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ProductCode') THEN UPPER(LTRIM(RTRIM(j.ProductCode))) ELSE t.ProductCode END,
 ProductName=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ProductName') THEN LTRIM(RTRIM(j.ProductName)) ELSE t.ProductName END,
 WeightGrams=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='WeightGrams') THEN j.WeightGrams ELSE t.WeightGrams END,
 Status=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Status') THEN j.Status ELSE t.Status END,
 Category=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Category') THEN NULLIF(LTRIM(RTRIM(j.Category)),N'') ELSE t.Category END,
 Grade=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Grade') THEN NULLIF(LTRIM(RTRIM(j.Grade)),N'') ELSE t.Grade END,
 MixRatioPct=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MixRatioPct') THEN j.MixRatioPct ELSE t.MixRatioPct END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.Product t CROSS APPLY OPENJSON(@Fields) WITH(ProductCode VARCHAR(20),ProductName VARCHAR(200),WeightGrams DECIMAL(10,2),Status VARCHAR(10),Category NVARCHAR(100),Grade NVARCHAR(100),MixRatioPct DECIMAL(5,2)) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.Product WHERE ID=@ID;
END;
GO
