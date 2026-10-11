-- Administrator workspace: roles supplement the existing UserAccess/SQL scopes.
-- Existing users and scopes are intentionally left unchanged.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.WorkspaceRole','U') IS NULL
 CREATE TABLE dbo.WorkspaceRole(
 ID INT IDENTITY PRIMARY KEY,RoleName NVARCHAR(100) NOT NULL UNIQUE,
 IsActive BIT NOT NULL DEFAULT(1),CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),UpdatedBy INT NULL REFERENCES dbo.Users(ID),
 UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION NOT NULL);
IF OBJECT_ID('dbo.WorkspaceRolePermission','U') IS NULL
 CREATE TABLE dbo.WorkspaceRolePermission(
 RoleID INT NOT NULL REFERENCES dbo.WorkspaceRole(ID),PageKey VARCHAR(40) NOT NULL,
 AccessLevel VARCHAR(10) NOT NULL CHECK(AccessLevel IN('none','display','edit')),
 PRIMARY KEY(RoleID,PageKey));
IF OBJECT_ID('dbo.WorkspaceUserRole','U') IS NULL
 CREATE TABLE dbo.WorkspaceUserRole(
 UserID INT NOT NULL REFERENCES dbo.Users(ID),RoleID INT NOT NULL REFERENCES dbo.WorkspaceRole(ID),
 PRIMARY KEY(UserID,RoleID));
-- Tracks only SQL scopes introduced by a workspace role (never direct access).
IF OBJECT_ID('dbo.WorkspaceRoleScope','U') IS NULL
 CREATE TABLE dbo.WorkspaceRoleScope(
 UserID INT NOT NULL REFERENCES dbo.Users(ID),Scope NVARCHAR(50) NOT NULL,
 PRIMARY KEY(UserID,Scope));
COMMIT TRANSACTION;

GO
CREATE OR ALTER FUNCTION dbo.fn_WorkspaceAccess(@UserID INT,@PageKey VARCHAR(40),@Edit BIT)
RETURNS BIT
AS
BEGIN
 DECLARE @Allowed BIT=0;
 IF EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@UserID AND IsActive=1)
 AND (EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@UserID AND Scope=N'Admin')
 OR EXISTS(SELECT 1 FROM dbo.WorkspaceUserRole ur JOIN dbo.WorkspaceRole r ON r.ID=ur.RoleID AND r.IsActive=1
 JOIN dbo.WorkspaceRolePermission p ON p.RoleID=r.ID
 WHERE ur.UserID=@UserID AND p.PageKey=@PageKey AND (p.AccessLevel='edit' OR (@Edit=0 AND p.AccessLevel='display'))))
 SET @Allowed=1;
 RETURN @Allowed;
END;
GO
-- Extend the four previously Admin-only workspace masters without granting
-- blanket Admin scope. Keep all existing validation and concurrency behavior.
DECLARE @Procedure SYSNAME,@Page VARCHAR(40),@Definition NVARCHAR(MAX),@Old NVARCHAR(MAX),@New NVARCHAR(MAX);
DECLARE master_auth CURSOR LOCAL FAST_FORWARD FOR SELECT * FROM (VALUES
 ('dbo.usp_ProductCategory_Save','categories'),('dbo.usp_LossProcessMaster_Save','loss-processes'),
 ('dbo.usp_PortOfEntry_Save','ports'),('dbo.usp_UoM_Batch','uoms')) v(ProcedureName,PageKey);
OPEN master_auth; FETCH NEXT FROM master_auth INTO @Procedure,@Page;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @Definition=OBJECT_DEFINITION(OBJECT_ID(@Procedure));
 IF @Definition IS NULL THROW 52996,'Required master procedure is missing. Apply earlier migrations first.',1;
 IF CHARINDEX('fn_WorkspaceAccess',@Definition)=0
 BEGIN
  IF @Page='uoms'
  BEGIN
   SET @Old=N'IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope=''Admin'')';
   SET @New=N'IF dbo.fn_WorkspaceAccess(@Actor,''uoms'',1)=0';
  END
  ELSE
  BEGIN
   SET @Old=N'WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope=''Admin'';';
   SET @New=N'WHERE u.UserName=@Username AND u.IsActive=1 AND dbo.fn_WorkspaceAccess(u.ID,'''+@Page+N''',1)=1;';
  END
  IF CHARINDEX(@Old,@Definition)=0 THROW 52996,'Unexpected master authorization definition; review migration before applying.',1;
  SET @Definition=REPLACE(@Definition,@Old,@New);
  SET @Definition=STUFF(@Definition,1,CHARINDEX(N'PROCEDURE',UPPER(@Definition))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @Definition;
 END;
 FETCH NEXT FROM master_auth INTO @Procedure,@Page;
END;
CLOSE master_auth;DEALLOCATE master_auth;
GO
