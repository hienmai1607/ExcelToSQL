-- After 138. Adds a default only; existing master rows and saved TCB JSON are not rewritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.LossProcessMaster','U') IS NULL
  THROW 52996,'Apply Loss Process Master migrations before migration 139.',1;
 IF COL_LENGTH('dbo.LossProcessMaster','Shared') IS NULL
  ALTER TABLE dbo.LossProcessMaster ADD Shared BIT NOT NULL CONSTRAINT DF_LossProcessMaster_Shared DEFAULT(0);
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_LossProcessMaster_Save'));
 IF @D IS NULL THROW 52996,'Loss Process Master save procedure is missing.',1;
 IF CHARINDEX(N'@Shared',@D)=0
 BEGIN
  SET @D=REPLACE(@D,N'@Status VARCHAR(10)=''Active''',N'@Status VARCHAR(10)=''Active'',@Shared BIT=0');
  SET @D=REPLACE(@D,N'LossPct,Status,CreatedBy)',N'LossPct,Status,CreatedBy,Shared)');
  SET @D=REPLACE(@D,N'@LossPct,@Status,@Actor)',N'@LossPct,@Status,@Actor,ISNULL(@Shared,0))');
  SET @D=REPLACE(@D,N'SET ProcessType=@ProcessType,Status=@Status,',N'SET ProcessType=@ProcessType,Status=@Status,Shared=ISNULL(@Shared,0),');
  IF CHARINDEX(N'Shared=ISNULL(@Shared,0)',@D)=0
   THROW 52996,'Unexpected Loss Process Master save definition; migration not applied.',1;
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
