USE [test]
GO
SET XACT_ABORT ON;
GO

IF COL_LENGTH('dbo.Users','RowVersion') IS NULL ALTER TABLE dbo.Users ADD RowVersion ROWVERSION NOT NULL;
GO
IF COL_LENGTH('dbo.UserAccess','RowVersion') IS NULL ALTER TABLE dbo.UserAccess ADD RowVersion ROWVERSION NOT NULL;
GO
IF TYPE_ID(N'dbo.UserBatchType') IS NULL EXEC(N'CREATE TYPE dbo.UserBatchType AS TABLE(RowNum INT NOT NULL,Command CHAR(1) NOT NULL,ID INT NULL,UserName NVARCHAR(100) NULL,IsActive BIT NULL,RowVersionB64 VARBINARY(8) NULL)');
GO
IF TYPE_ID(N'dbo.UserAccessBatchType') IS NULL EXEC(N'CREATE TYPE dbo.UserAccessBatchType AS TABLE(RowNum INT NOT NULL,Command CHAR(1) NOT NULL,AccessID INT NULL,UserID INT NULL,Scope NVARCHAR(50) NULL,RowVersionB64 VARBINARY(8) NULL)');
GO
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.UserAccess') AND name=N'CK_UserAccess_Scope')
 ALTER TABLE dbo.UserAccess WITH CHECK ADD CONSTRAINT CK_UserAccess_Scope CHECK(Scope IN(N'Admin',N'Customer',N'Product',N'Opportunity'));
GO

CREATE OR ALTER PROCEDURE dbo.usp_User_Batch
 @Rows dbo.UserBatchType READONLY,@Username NVARCHAR(100),@IsAdmin BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @R TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
 DECLARE @ActorID INT;
 SELECT @ActorID=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin'
 WHERE u.UserName=@Username AND u.IsActive=1;
 IF @ActorID IS NULL BEGIN INSERT @R SELECT RowNum,'ERROR','Admin access is required for this action.',NULL,NULL FROM @Rows;SELECT * FROM @R ORDER BY RowNum;RETURN;END;
 DECLARE @rn INT,@cmd CHAR(1),@id INT,@name NVARCHAR(100),@active BIT,@rv VARBINARY(8),@OwnTran BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(UserName)),N''),IsActive,RowVersionB64 FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @rn,@cmd,@id,@name,@active,@rv;
 WHILE @@FETCH_STATUS=0 BEGIN
  BEGIN TRY
   SET @OwnTran=0;
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @OwnTran=1;END;
   IF @cmd='C' BEGIN
    IF @name IS NULL THROW 51001,'User Name is required.',1;
    INSERT dbo.Users(UserName,IsActive) VALUES(@name,ISNULL(@active,1));
    DECLARE @newid INT=SCOPE_IDENTITY();
    INSERT @R SELECT @rn,'OK','Created',ID,RowVersion FROM dbo.Users WHERE ID=@newid;
   END
   ELSE IF @cmd IN('U','D') BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@id) INSERT @R VALUES(@rn,'ERROR','Row not found',NULL,NULL);
    ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@id AND RowVersion=@rv) INSERT @R VALUES(@rn,'ERROR','Concurrency conflict',NULL,NULL);
    ELSE IF @id=@ActorID AND (@cmd='D' OR ISNULL(@active,0)=0) INSERT @R VALUES(@rn,'ERROR','You cannot deactivate your own user account.',NULL,NULL);
    ELSE IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@id AND Scope=N'Admin') AND EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@id AND IsActive=1)
      AND (@cmd='D' OR ISNULL(@active,0)=0)
      AND (SELECT COUNT(*) FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope=N'Admin')<=1
      INSERT @R VALUES(@rn,'ERROR','The final active Admin cannot be deactivated.',NULL,NULL);
    ELSE BEGIN
     IF @cmd='U' AND @name IS NULL THROW 51002,'User Name is required.',1;
     UPDATE dbo.Users SET UserName=CASE WHEN @cmd='U' THEN @name ELSE UserName END,
       IsActive=CASE WHEN @cmd='D' THEN 0 ELSE ISNULL(@active,IsActive) END
       WHERE ID=@id AND RowVersion=@rv;
     INSERT @R SELECT @rn,'OK',CASE WHEN @cmd='D' THEN 'Deactivated' ELSE 'Updated' END,ID,RowVersion FROM dbo.Users WHERE ID=@id;
    END
   END
   ELSE INSERT @R VALUES(@rn,'ERROR','Invalid command; use C, U, or D.',NULL,NULL);
   IF @OwnTran=1 COMMIT;
  END TRY BEGIN CATCH IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;INSERT @R VALUES(@rn,'ERROR',ERROR_MESSAGE(),NULL,NULL);END CATCH;
  FETCH NEXT FROM c INTO @rn,@cmd,@id,@name,@active,@rv;
 END
 CLOSE c;DEALLOCATE c;SELECT * FROM @R ORDER BY RowNum;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_UserAccess_Batch
 @Rows dbo.UserAccessBatchType READONLY,@Username NVARCHAR(100),@IsAdmin BIT=0
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT OFF;
 DECLARE @R TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
 DECLARE @ActorID INT;
 SELECT @ActorID=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.UserName=@Username AND u.IsActive=1;
 IF @ActorID IS NULL BEGIN INSERT @R SELECT RowNum,'ERROR','Admin access is required for this action.',NULL,NULL FROM @Rows;SELECT * FROM @R ORDER BY RowNum;RETURN;END;
 DECLARE @rn INT,@cmd CHAR(1),@aid INT,@uid INT,@scope NVARCHAR(50),@rv VARBINARY(8),@oldUid INT,@oldScope NVARCHAR(50),@OwnTran BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),AccessID,UserID,NULLIF(LTRIM(RTRIM(Scope)),N''),RowVersionB64 FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @rn,@cmd,@aid,@uid,@scope,@rv;
 WHILE @@FETCH_STATUS=0 BEGIN
  BEGIN TRY
   SET @OwnTran=0;
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @OwnTran=1;END;
   IF @cmd='C' BEGIN
    IF @scope IS NULL OR @scope NOT IN(N'Admin',N'Customer',N'Product',N'Opportunity') THROW 51010,'Invalid Scope.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@uid AND IsActive=1) THROW 51011,'User not found or inactive.',1;
    INSERT dbo.UserAccess(UserID,Scope) VALUES(@uid,@scope);DECLARE @newaid INT=SCOPE_IDENTITY();
    INSERT @R SELECT @rn,'OK','Created',AccessID,RowVersion FROM dbo.UserAccess WHERE AccessID=@newaid;
   END ELSE IF @cmd IN('U','D') BEGIN
    SET @oldUid=NULL;SET @oldScope=NULL;SELECT @oldUid=UserID,@oldScope=Scope FROM dbo.UserAccess WHERE AccessID=@aid;
    IF @oldUid IS NULL INSERT @R VALUES(@rn,'ERROR','Row not found',NULL,NULL);
    ELSE IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE AccessID=@aid AND RowVersion=@rv) INSERT @R VALUES(@rn,'ERROR','Concurrency conflict',NULL,NULL);
    ELSE IF @oldUid=@ActorID AND @oldScope=N'Admin' AND (@cmd='D' OR @scope<>N'Admin' OR @uid<>@ActorID) INSERT @R VALUES(@rn,'ERROR','You cannot remove your own Admin access.',NULL,NULL);
    ELSE IF @oldScope=N'Admin' AND (@cmd='D' OR @scope<>N'Admin') AND
      (SELECT COUNT(*) FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope=N'Admin')<=1
      INSERT @R VALUES(@rn,'ERROR','The final active Admin access cannot be removed.',NULL,NULL);
    ELSE IF @cmd='D' BEGIN DELETE dbo.UserAccess WHERE AccessID=@aid AND RowVersion=@rv;INSERT @R VALUES(@rn,'OK','Deleted',@aid,NULL);END
    ELSE BEGIN
     IF @scope IS NULL OR @scope NOT IN(N'Admin',N'Customer',N'Product',N'Opportunity') THROW 51012,'Invalid Scope.',1;
     IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@uid AND IsActive=1) THROW 51013,'User not found or inactive.',1;
     UPDATE dbo.UserAccess SET UserID=@uid,Scope=@scope WHERE AccessID=@aid AND RowVersion=@rv;
     INSERT @R SELECT @rn,'OK','Updated',AccessID,RowVersion FROM dbo.UserAccess WHERE AccessID=@aid;
    END
   END ELSE INSERT @R VALUES(@rn,'ERROR','Invalid command; use C, U, or D.',NULL,NULL);
   IF @OwnTran=1 COMMIT;
  END TRY BEGIN CATCH IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;INSERT @R VALUES(@rn,'ERROR',ERROR_MESSAGE(),NULL,NULL);END CATCH;
  FETCH NEXT FROM c INTO @rn,@cmd,@aid,@uid,@scope,@rv;
 END
 CLOSE c;DEALLOCATE c;SELECT * FROM @R ORDER BY RowNum;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_User_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope=N'Admin') THROW 51020,'Admin access is required for this action.',1;
 SELECT ID,UserName,IsActive,RowVersion FROM dbo.Users ORDER BY UserName;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_UserAccess_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope=N'Admin') THROW 51021,'Admin access is required for this action.',1;
 SELECT a.AccessID,a.UserID,u.UserName,a.Scope,a.RowVersion FROM dbo.UserAccess a JOIN dbo.Users u ON u.ID=a.UserID ORDER BY u.UserName,a.Scope;
END
GO
