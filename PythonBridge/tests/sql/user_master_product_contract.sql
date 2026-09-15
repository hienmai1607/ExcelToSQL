USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT OFF;

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Suffix VARCHAR(12) = REPLACE(LEFT(CONVERT(VARCHAR(36), NEWID()), 12), '-', '');
    DECLARE @AdminName NVARCHAR(100) = N'zz.um.admin.' + @Suffix;
    DECLARE @ProductName NVARCHAR(100) = N'zz.um.product.' + @Suffix;
    DECLARE @CustomerName NVARCHAR(100) = N'zz.um.customer.' + @Suffix;
    DECLARE @OpportunityName NVARCHAR(100) = N'zz.um.opportunity.' + @Suffix;
    DECLARE @AdminID INT, @ProductUserID INT, @CustomerUserID INT, @OpportunityUserID INT;

    INSERT dbo.Users(UserName, IsActive) VALUES(@AdminName,1); SET @AdminID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName, IsActive) VALUES(@ProductName,1); SET @ProductUserID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName, IsActive) VALUES(@CustomerName,1); SET @CustomerUserID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName, IsActive) VALUES(@OpportunityName,1); SET @OpportunityUserID=SCOPE_IDENTITY();
    INSERT dbo.UserAccess(UserID,Scope) VALUES
        (@AdminID,N'Admin'),(@ProductUserID,N'Product'),
        (@CustomerUserID,N'Customer'),(@OpportunityUserID,N'Opportunity');

    DECLARE @Rows dbo.ProductBatchType;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
    DECLARE @ProductID INT,@RV1 VARBINARY(8),@RV2 VARBINARY(8),@AdminProductID INT,@AdminProductRV VARBINARY(8);
    DECLARE @Code VARCHAR(20)='ZP'+@Suffix;

    INSERT @Rows VALUES(1,'C',NULL,@Code,'User Master product',10,'g',NULL,NULL);
    INSERT @Result EXEC dbo.usp_Product_Batch @Rows,@ProductName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=1 AND Status='OK' AND NewID IS NOT NULL AND NewRowVersion IS NOT NULL)
        THROW 52301,'PRODUCT ROLE CREATE: expected OK with ID and RowVersion.',1;
    SELECT @ProductID=NewID,@RV1=NewRowVersion FROM @Result WHERE RowNum=1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(2,'U',@ProductID,@Code,'User Master product updated',1,'oz','Active',@RV1);
    INSERT @Result EXEC dbo.usp_Product_Batch @Rows,@ProductName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=2 AND Status='OK' AND NewRowVersion<>@RV1)
        THROW 52302,'PRODUCT ROLE UPDATE: expected a new RowVersion.',1;
    SELECT @RV2=NewRowVersion FROM @Result WHERE RowNum=2;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(3,'U',@ProductID,@Code,'Stale product update',11,'g','Active',@RV1);
    INSERT @Result EXEC dbo.usp_Product_Batch @Rows,@ProductName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=3 AND Status='ERROR' AND Message='Concurrency conflict')
        THROW 52303,'PRODUCT CONCURRENCY: expected an explicit concurrency conflict.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(4,'C',NULL,'ZA'+@Suffix,'Admin product',5,'g',NULL,NULL);
    INSERT @Result EXEC dbo.usp_Product_Batch @Rows,@AdminName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=4 AND Status='OK')
        THROW 52304,'PRODUCT ADMIN CREATE: live Admin scope should authorize the write.',1;
    SELECT @AdminProductID=NewID,@AdminProductRV=NewRowVersion FROM @Result WHERE RowNum=4;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(5,'C',NULL,'ZD'+@Suffix,'Denied product',5,'g',NULL,NULL);
    INSERT @Result EXEC dbo.usp_Product_Batch @Rows,@CustomerName,1;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=5 AND Status='ERROR' AND Message='Product access is required for this action.')
        THROW 52305,'PRODUCT AUTHORIZATION: SQL trusted the supplied IsAdmin flag.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(6,'D',@ProductID,NULL,NULL,NULL,NULL,NULL,@RV2);
    INSERT @Result EXEC dbo.usp_Product_Batch @Rows,@ProductName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=6 AND Status='OK' AND Message='Blocked' AND NewRowVersion IS NOT NULL)
        THROW 52306,'PRODUCT ROLE BLOCK: expected OK with a new RowVersion.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ProductID AND Status='Block')
        THROW 52308,'PRODUCT ROLE BLOCK: the master row should remain blocked.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(7,'D',@AdminProductID,NULL,NULL,NULL,NULL,NULL,@AdminProductRV);
    INSERT @Result EXEC dbo.usp_Product_Batch @Rows,@AdminName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=7 AND Status='OK')
        THROW 52307,'PRODUCT ADMIN BLOCK: expected OK.',1;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Product User Master contract';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
