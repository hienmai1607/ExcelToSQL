-- After 140. Separate grade/type defaults and allow processing at multiple grade levels.
-- No saved grade trees, costing JSON, percentages or process type names are rewritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.GradeProcessLossMaster','U') IS NULL
 BEGIN
  CREATE TABLE dbo.GradeProcessLossMaster(
   ID INT IDENTITY PRIMARY KEY,
   RawGradeID INT NULL REFERENCES dbo.RawGrade(ID),
   ProcessTypeID INT NOT NULL REFERENCES dbo.LossProcessMaster(ID),
   LossPct DECIMAL(5,2) NOT NULL CHECK(LossPct>=0 AND LossPct<100),
   Status VARCHAR(10) NOT NULL CHECK(Status IN('Active','Block')),
   CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
   CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
   UpdatedBy INT NULL REFERENCES dbo.Users(ID),
   UpdatedAt DATETIME2 NULL,
   RowVersion ROWVERSION NOT NULL);
  CREATE UNIQUE INDEX UX_GradeProcessLoss_Grade ON dbo.GradeProcessLossMaster(RawGradeID,ProcessTypeID) WHERE RawGradeID IS NOT NULL;
  CREATE UNIQUE INDEX UX_GradeProcessLoss_All ON dbo.GradeProcessLossMaster(ProcessTypeID) WHERE RawGradeID IS NULL;
 END;
 DECLARE @D NVARCHAR(MAX)=REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_ProductGrade_Save')),CHAR(13),N'');
 IF @D IS NULL OR CHARINDEX(N'GradeProcess137',@D)=0 THROW 52996,'Apply grade process migration 137 first.',1;
 DECLARE @Guard NVARCHAR(MAX)=N'IF EXISTS(SELECT 1 FROM @Tree child JOIN @Tree parent ON child.NodePath LIKE parent.NodePath+''/%'' WHERE child.Process=1 AND parent.Process=1)
  THROW 52960,''A child under a Process grade cannot also be Process.'',1;';
 IF CHARINDEX(N'-- Nested grade processing (141)',@D)=0
 BEGIN
  IF CHARINDEX(@Guard,@D)=0 THROW 52996,'Unexpected Product Grade validation before migration 141.',1;
  SET @D=REPLACE(@D,@Guard,N'-- Nested grade processing (141): child and parent stages are independent.');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.usp_GradeProcessLoss_Save
 @Username NVARCHAR(100),@ID INT=NULL,@ExpectedRowVersion VARBINARY(8)=NULL,
 @RawGradeID INT=NULL,@ProcessTypeID INT=NULL,@LossPct DECIMAL(5,2)=NULL,@Status VARCHAR(10)=''Active''
 AS
 BEGIN
  SET NOCOUNT ON;SET XACT_ABORT ON;
  DECLARE @Actor INT=(SELECT ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1);
  IF @Actor IS NULL OR dbo.fn_WorkspaceAccess(@Actor,''loss-defaults'',1)<>1
   THROW 52998,''Loss Process Master edit access is required.'',1;
  IF @LossPct IS NULL OR @LossPct<0 OR @LossPct>=100 OR @Status NOT IN(''Active'',''Block'')
   THROW 52996,''Enter a loss below 100% and a valid status.'',1;
  BEGIN TRY
   BEGIN TRANSACTION;
   IF @ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.GradeProcessLossMaster WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
    THROW 52997,''Loss Process default changed. Refresh before saving.'',1;
   IF NOT EXISTS(SELECT 1 FROM dbo.LossProcessMaster WHERE ID=@ProcessTypeID AND (Status=''Active'' OR @Status=''Block''))
    THROW 52996,''Choose an active Process Type.'',1;
   IF @RawGradeID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade WHERE ID=@RawGradeID AND (Status=''Active'' OR @Status=''Block''))
    THROW 52996,''Choose an active Raw Grade.'',1;
   IF EXISTS(SELECT 1 FROM dbo.GradeProcessLossMaster WITH(UPDLOCK,HOLDLOCK)
    WHERE ProcessTypeID=@ProcessTypeID AND ISNULL(RawGradeID,0)=ISNULL(@RawGradeID,0) AND (@ID IS NULL OR ID<>@ID))
    THROW 52996,''A default already exists for this Grade and Process Type.'',1;
   IF @ID IS NULL
   BEGIN
    INSERT dbo.GradeProcessLossMaster(RawGradeID,ProcessTypeID,LossPct,Status,CreatedBy)
     VALUES(@RawGradeID,@ProcessTypeID,@LossPct,@Status,@Actor);
    SET @ID=CONVERT(INT,SCOPE_IDENTITY());
   END
   ELSE UPDATE dbo.GradeProcessLossMaster SET RawGradeID=@RawGradeID,ProcessTypeID=@ProcessTypeID,LossPct=@LossPct,Status=@Status,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
   COMMIT;
   SELECT ID,RowVersion FROM dbo.GradeProcessLossMaster WHERE ID=@ID;
  END TRY
  BEGIN CATCH
   IF XACT_STATE()<>0 ROLLBACK;
   THROW;
  END CATCH;
 END';
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
