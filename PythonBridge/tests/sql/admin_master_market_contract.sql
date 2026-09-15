USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT OFF;

DECLARE @Admin NVARCHAR(100) = (
    SELECT TOP (1) u.UserName
    FROM dbo.Users AS u
    JOIN dbo.UserAccess AS a ON a.UserID = u.ID AND a.Scope = N'Admin'
    WHERE u.IsActive = 1
    ORDER BY u.ID
);
DECLARE @NonAdmin NVARCHAR(100) = (
    SELECT TOP (1) u.UserName
    FROM dbo.Users AS u
    WHERE u.IsActive = 1
      AND NOT EXISTS (
          SELECT 1 FROM dbo.UserAccess AS a
          WHERE a.UserID = u.ID AND a.Scope = N'Admin'
      )
    ORDER BY u.ID
);

IF @Admin IS NULL THROW 52000, 'TEST SETUP: an active Admin user is required.', 1;
IF @NonAdmin IS NULL THROW 52001, 'TEST SETUP: an active non-Admin user is required.', 1;

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Rows dbo.MarketBatchType;
    DECLARE @Result TABLE (
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, NewRowVersion VARBINARY(8) NULL
    );
    DECLARE @ID INT, @RV1 VARBINARY(8), @RV2 VARBINARY(8);

    INSERT @Rows VALUES (1, 'C', NULL, 'ZZTST', 'Admin contract test', NULL);
    INSERT @Result EXEC dbo.usp_Market_Batch @Rows, @Admin, 1;
    IF NOT EXISTS (SELECT 1 FROM @Result WHERE RowNum=1 AND Status='OK' AND NewID IS NOT NULL AND NewRowVersion IS NOT NULL)
        THROW 52002, 'MARKET CREATE: expected OK with ID and RowVersion.', 1;
    SELECT @ID=NewID,@RV1=NewRowVersion FROM @Result WHERE RowNum=1;

    DELETE FROM @Rows; DELETE FROM @Result;
    INSERT @Rows VALUES (2, 'U', @ID, 'ZZTST', 'Admin contract test updated', @RV1);
    INSERT @Result EXEC dbo.usp_Market_Batch @Rows, @Admin, 1;
    IF NOT EXISTS (SELECT 1 FROM @Result WHERE RowNum=2 AND Status='OK' AND NewRowVersion IS NOT NULL AND NewRowVersion<>@RV1)
        THROW 52003, 'MARKET UPDATE: expected OK with a new RowVersion.', 1;
    SELECT @RV2=NewRowVersion FROM @Result WHERE RowNum=2;

    DELETE FROM @Rows; DELETE FROM @Result;
    INSERT @Rows VALUES (3, 'U', @ID, 'ZZTST', 'stale write', @RV1);
    INSERT @Result EXEC dbo.usp_Market_Batch @Rows, @Admin, 1;
    IF NOT EXISTS (SELECT 1 FROM @Result WHERE RowNum=3 AND Status='ERROR' AND Message='Concurrency conflict')
        THROW 52004, 'MARKET CONCURRENCY: expected an explicit concurrency conflict.', 1;

    DELETE FROM @Rows; DELETE FROM @Result;
    INSERT @Rows VALUES (4, 'D', @ID, NULL, NULL, @RV2);
    INSERT @Result EXEC dbo.usp_Market_Batch @Rows, @Admin, 1;
    IF NOT EXISTS (SELECT 1 FROM @Result WHERE RowNum=4 AND Status='OK' AND Message='Deleted')
        THROW 52005, 'MARKET DELETE: expected OK.', 1;

    DELETE FROM @Rows; DELETE FROM @Result;
    INSERT @Rows VALUES (5, 'C', NULL, 'ZZDENY', 'Must not be created', NULL);
    INSERT @Result EXEC dbo.usp_Market_Batch @Rows, @NonAdmin, 1;
    IF NOT EXISTS (SELECT 1 FROM @Result WHERE RowNum=5 AND Status='ERROR' AND Message='Admin access is required for this action.')
        THROW 52006, 'MARKET AUTHORIZATION: SQL must not trust the supplied IsAdmin flag.', 1;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Market Admin Master contract';
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
