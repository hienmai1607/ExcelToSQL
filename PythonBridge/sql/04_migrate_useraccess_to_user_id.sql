USE [test]
GO

/*
    One-time migration for an existing database.
    It preserves current UserAccess rows by resolving Username -> Users.ID.
    Run this only after dbo.Users contains one active, uniquely named row for
    every username currently stored in dbo.UserAccess.
*/
SET XACT_ABORT ON;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.UserAccess', 'Username') IS NULL
        THROW 50001, 'dbo.UserAccess.Username does not exist; this migration has already run or the schema is unexpected.', 1;

    IF EXISTS (
        SELECT UserName
        FROM dbo.Users
        GROUP BY UserName
        HAVING COUNT(*) > 1
    )
        THROW 50002, 'dbo.Users contains duplicate UserName values. Resolve them before migrating UserAccess.', 1;

    ALTER TABLE dbo.Users ALTER COLUMN UserName NVARCHAR(100) NOT NULL;
    ALTER TABLE dbo.Users ADD CONSTRAINT UQ_Users_UserName UNIQUE (UserName);

    ALTER TABLE dbo.UserAccess ADD UserID INT NULL;

    -- SQL Server compiles an entire batch before executing it. The UserID
    -- references must therefore be dynamic SQL: it is compiled only after
    -- the ALTER TABLE above has created the column.
    EXEC sys.sp_executesql N'
        UPDATE ua
        SET UserID = u.ID
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.UserName = ua.Username
        WHERE u.IsActive = 1;

        IF EXISTS (SELECT 1 FROM dbo.UserAccess WHERE UserID IS NULL)
            THROW 50003, ''At least one UserAccess.Username has no matching active dbo.Users row. No changes were committed.'', 1;

        IF EXISTS (
            SELECT UserID, Scope
            FROM dbo.UserAccess
            GROUP BY UserID, Scope
            HAVING COUNT(*) > 1
        )
            THROW 50004, ''Migration would create duplicate (UserID, Scope) permissions. Resolve duplicates before migrating.'', 1;

        ALTER TABLE dbo.UserAccess DROP CONSTRAINT UQ_UserAccess;
        ALTER TABLE dbo.UserAccess ALTER COLUMN UserID INT NOT NULL;
        ALTER TABLE dbo.UserAccess ADD CONSTRAINT FK_UserAccess_User
            FOREIGN KEY (UserID) REFERENCES dbo.Users(ID);
        ALTER TABLE dbo.UserAccess ADD CONSTRAINT UQ_UserAccess UNIQUE (UserID, Scope);
        ALTER TABLE dbo.UserAccess DROP COLUMN Username;
    ';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
