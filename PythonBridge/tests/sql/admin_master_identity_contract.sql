USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT OFF;

DECLARE @Admin NVARCHAR(100)=(SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.IsActive=1 ORDER BY u.ID);
DECLARE @NonAdmin NVARCHAR(100)=(SELECT TOP(1) u.UserName FROM dbo.Users u WHERE u.IsActive=1 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=u.ID AND a.Scope=N'Admin') ORDER BY u.ID);
IF @Admin IS NULL THROW 52200,'TEST SETUP: an active Admin user is required.',1;
IF @NonAdmin IS NULL THROW 52201,'TEST SETUP: an active non-Admin user is required.',1;

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Users dbo.UserBatchType;
    DECLARE @UserResult TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
    DECLARE @UserID INT,@UserRV1 VARBINARY(8),@UserRV2 VARBINARY(8),@UserRV3 VARBINARY(8);

    INSERT @Users VALUES(1,'C',NULL,N'zz.admin.contract',1,NULL);
    INSERT @UserResult EXEC dbo.usp_User_Batch @Users,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @UserResult WHERE RowNum=1 AND Status='OK' AND NewID IS NOT NULL AND NewRowVersion IS NOT NULL)
        THROW 52202,'USER CREATE: expected OK with ID and RowVersion.',1;
    SELECT @UserID=NewID,@UserRV1=NewRowVersion FROM @UserResult WHERE RowNum=1;

    DELETE @Users; DELETE @UserResult;
    INSERT @Users VALUES(2,'U',@UserID,N'zz.admin.contract.updated',1,@UserRV1);
    INSERT @UserResult EXEC dbo.usp_User_Batch @Users,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @UserResult WHERE RowNum=2 AND Status='OK' AND NewRowVersion IS NOT NULL AND NewRowVersion<>@UserRV1)
        THROW 52203,'USER UPDATE: expected OK with a new RowVersion.',1;
    SELECT @UserRV2=NewRowVersion FROM @UserResult WHERE RowNum=2;

    DELETE @Users; DELETE @UserResult;
    INSERT @Users VALUES(3,'U',@UserID,N'stale.user.write',1,@UserRV1);
    INSERT @UserResult EXEC dbo.usp_User_Batch @Users,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @UserResult WHERE RowNum=3 AND Status='ERROR' AND Message='Concurrency conflict')
        THROW 52204,'USER CONCURRENCY: expected an explicit concurrency conflict.',1;

    DECLARE @Access dbo.UserAccessBatchType;
    DECLARE @AccessResult TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
    DECLARE @AccessID INT,@AccessRV1 VARBINARY(8),@AccessRV2 VARBINARY(8);

    INSERT @Access VALUES(4,'C',NULL,@UserID,N'Customer',NULL);
    INSERT @AccessResult EXEC dbo.usp_UserAccess_Batch @Access,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @AccessResult WHERE RowNum=4 AND Status='OK' AND NewID IS NOT NULL AND NewRowVersion IS NOT NULL)
        THROW 52205,'USER ACCESS CREATE: expected OK with ID and RowVersion.',1;
    SELECT @AccessID=NewID,@AccessRV1=NewRowVersion FROM @AccessResult WHERE RowNum=4;

    DELETE @Access; DELETE @AccessResult;
    INSERT @Access VALUES(5,'U',@AccessID,@UserID,N'Product',@AccessRV1);
    INSERT @AccessResult EXEC dbo.usp_UserAccess_Batch @Access,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @AccessResult WHERE RowNum=5 AND Status='OK' AND NewRowVersion IS NOT NULL AND NewRowVersion<>@AccessRV1)
        THROW 52206,'USER ACCESS UPDATE: expected OK with a new RowVersion.',1;
    SELECT @AccessRV2=NewRowVersion FROM @AccessResult WHERE RowNum=5;

    DELETE @Access; DELETE @AccessResult;
    INSERT @Access VALUES(6,'U',@AccessID,@UserID,N'Opportunity',@AccessRV1);
    INSERT @AccessResult EXEC dbo.usp_UserAccess_Batch @Access,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @AccessResult WHERE RowNum=6 AND Status='ERROR' AND Message='Concurrency conflict')
        THROW 52207,'USER ACCESS CONCURRENCY: expected an explicit concurrency conflict.',1;

    DELETE @Access; DELETE @AccessResult;
    INSERT @Access VALUES(7,'D',@AccessID,NULL,NULL,@AccessRV2);
    INSERT @AccessResult EXEC dbo.usp_UserAccess_Batch @Access,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @AccessResult WHERE RowNum=7 AND Status='OK' AND Message='Deleted')
        THROW 52208,'USER ACCESS DELETE: expected OK.',1;

    DELETE @Users; DELETE @UserResult;
    INSERT @Users VALUES(8,'D',@UserID,NULL,0,@UserRV2);
    INSERT @UserResult EXEC dbo.usp_User_Batch @Users,@Admin,1;
    IF NOT EXISTS(SELECT 1 FROM @UserResult WHERE RowNum=8 AND Status='OK' AND Message='Deactivated' AND NewRowVersion IS NOT NULL)
        THROW 52209,'USER DELETE COMMAND: expected soft deactivation with a new RowVersion.',1;
    SELECT @UserRV3=NewRowVersion FROM @UserResult WHERE RowNum=8;

    DELETE @Users; DELETE @UserResult;
    INSERT @Users VALUES(9,'C',NULL,N'zz.must.be.denied',1,NULL);
    INSERT @UserResult EXEC dbo.usp_User_Batch @Users,@NonAdmin,1;
    IF NOT EXISTS(SELECT 1 FROM @UserResult WHERE RowNum=9 AND Status='ERROR' AND Message='Admin access is required for this action.')
        THROW 52210,'USER AUTHORIZATION: SQL must not trust the supplied IsAdmin flag.',1;

    DELETE @Access; DELETE @AccessResult;
    INSERT @Access VALUES(10,'C',NULL,@UserID,N'Customer',NULL);
    INSERT @AccessResult EXEC dbo.usp_UserAccess_Batch @Access,@NonAdmin,1;
    IF NOT EXISTS(SELECT 1 FROM @AccessResult WHERE RowNum=10 AND Status='ERROR' AND Message='Admin access is required for this action.')
        THROW 52211,'USER ACCESS AUTHORIZATION: SQL must not trust the supplied IsAdmin flag.',1;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Users and User Access Admin Master contract';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
