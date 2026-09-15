/* Run through Invoke-FreshDatabaseDeployment.ps1 after identity format is approved. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @UserName NVARCHAR(100) = N'$(BootstrapUserName)';
IF NULLIF(LTRIM(RTRIM(@UserName)), N'') IS NULL
    THROW 52801, 'BootstrapUserName is required.', 1;

BEGIN TRANSACTION;

DECLARE @UserID INT = (SELECT ID FROM dbo.Users WHERE UserName = @UserName);
IF @UserID IS NULL
BEGIN
    INSERT dbo.Users(UserName, IsActive) VALUES(@UserName, 1);
    SET @UserID = CONVERT(INT, SCOPE_IDENTITY());
END
ELSE
    UPDATE dbo.Users SET IsActive = 1 WHERE ID = @UserID;

IF NOT EXISTS (SELECT 1 FROM dbo.UserAccess WHERE UserID = @UserID AND Scope = N'Admin')
    INSERT dbo.UserAccess(UserID, Scope) VALUES(@UserID, N'Admin');

COMMIT TRANSACTION;
GO
