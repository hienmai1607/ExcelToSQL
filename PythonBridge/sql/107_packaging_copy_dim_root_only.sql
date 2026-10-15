-- After 106. Copy Dim. implies Single and no Parent Type.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.PackagingType','CopyDim') IS NULL
  THROW 52996,'Apply migration 106 first.',1;
 IF EXISTS(SELECT 1 FROM dbo.PackagingType WHERE CopyDim=1 AND (FinalComponent=0 OR ParentTypeID IS NOT NULL))
  THROW 52996,'Existing Copy Dim. types must be Single with no parent. Correct them before applying 107.',1;
 IF OBJECT_ID('dbo.CK_PackagingType_CopyDim','C') IS NOT NULL
  ALTER TABLE dbo.PackagingType DROP CONSTRAINT CK_PackagingType_CopyDim;
 ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_CopyDim
  CHECK(CopyDim=0 OR (FinalComponent=1 AND ParentTypeID IS NULL));
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
 IF @D IS NULL THROW 52996,'Packaging Type procedure is missing.',1;
 IF CHARINDEX(N'Copy Dim. requires Single with no parent.',@D)=0
 BEGIN
  DECLARE @Old NVARCHAR(MAX)=N'IF @CopyDim=1 AND @FinalComponent=0 THROW 51111,''Copy Dim. requires Single.'',1;';
  IF CHARINDEX(@Old,@D)=0 THROW 52996,'Unexpected Copy Dim. procedure; migration rolled back.',1;
  SET @D=REPLACE(@D,@Old,N'IF @CopyDim=1 AND (@FinalComponent=0 OR @Parent IS NOT NULL) THROW 51111,''Copy Dim. requires Single with no parent.'',1;');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
