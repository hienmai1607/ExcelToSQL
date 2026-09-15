USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT OFF;

DECLARE @Admin NVARCHAR(100)=(SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.IsActive=1 ORDER BY u.ID);
DECLARE @NonAdmin NVARCHAR(100)=(SELECT TOP(1) u.UserName FROM dbo.Users u WHERE u.IsActive=1 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=u.ID AND a.Scope=N'Admin') ORDER BY u.ID);
IF @Admin IS NULL THROW 52100,'TEST SETUP: an active Admin user is required.',1;
IF @NonAdmin IS NULL THROW 52101,'TEST SETUP: an active non-Admin user is required.',1;

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Rows dbo.CurrencyBatchType;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
    DECLARE @ID INT,@RV1 VARBINARY(8),@RV2 VARBINARY(8);

    INSERT @Rows VALUES(1,'C',NULL,'ZZZ','Admin contract test',NULL);
    INSERT @Result EXEC dbo.usp_Currency_Batch @Rows,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=1 AND Status='OK' AND NewID IS NOT NULL AND NewRowVersion IS NOT NULL)
        THROW 52102,'CURRENCY CREATE: expected OK with ID and RowVersion.',1;
    SELECT @ID=NewID,@RV1=NewRowVersion FROM @Result WHERE RowNum=1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(2,'U',@ID,'ZZZ','Admin contract test updated',@RV1);
    INSERT @Result EXEC dbo.usp_Currency_Batch @Rows,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=2 AND Status='OK' AND NewRowVersion IS NOT NULL AND NewRowVersion<>@RV1)
        THROW 52103,'CURRENCY UPDATE: expected OK with a new RowVersion.',1;
    SELECT @RV2=NewRowVersion FROM @Result WHERE RowNum=2;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(3,'U',@ID,'ZZZ','stale write',@RV1);
    INSERT @Result EXEC dbo.usp_Currency_Batch @Rows,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=3 AND Status='ERROR' AND Message='Concurrency conflict')
        THROW 52104,'CURRENCY CONCURRENCY: expected an explicit concurrency conflict.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(4,'D',@ID,NULL,NULL,@RV2);
    INSERT @Result EXEC dbo.usp_Currency_Batch @Rows,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=4 AND Status='OK' AND Message='Deleted')
        THROW 52105,'CURRENCY DELETE: expected OK.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(5,'C',NULL,'ZZY','Must not be created',NULL);
    INSERT @Result EXEC dbo.usp_Currency_Batch @Rows,@NonAdmin,1;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=5 AND Status='ERROR' AND Message='Admin access is required for this action.')
        THROW 52106,'CURRENCY AUTHORIZATION: SQL must not trust the supplied IsAdmin flag.',1;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Currency Admin Master contract';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
