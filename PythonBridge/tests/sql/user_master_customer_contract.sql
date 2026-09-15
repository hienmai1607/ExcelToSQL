USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT OFF;

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @MarketID INT=(SELECT TOP(1) ID FROM dbo.Market ORDER BY ID);
    DECLARE @CurrencyID INT=(SELECT TOP(1) ID FROM dbo.Currency ORDER BY ID);
    IF @MarketID IS NULL OR @CurrencyID IS NULL
        THROW 52400,'TEST SETUP: Market and Currency rows are required.',1;

    DECLARE @Suffix VARCHAR(12)=REPLACE(LEFT(CONVERT(VARCHAR(36),NEWID()),12),'-','');
    DECLARE @AdminName NVARCHAR(100)=N'zz.uc.admin.'+@Suffix;
    DECLARE @CustomerRoleName NVARCHAR(100)=N'zz.uc.customer.'+@Suffix;
    DECLARE @ProductRoleName NVARCHAR(100)=N'zz.uc.product.'+@Suffix;
    DECLARE @AdminID INT,@CustomerUserID INT,@ProductUserID INT;
    INSERT dbo.Users(UserName,IsActive) VALUES(@AdminName,1); SET @AdminID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName,IsActive) VALUES(@CustomerRoleName,1); SET @CustomerUserID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName,IsActive) VALUES(@ProductRoleName,1); SET @ProductUserID=SCOPE_IDENTITY();
    INSERT dbo.UserAccess(UserID,Scope) VALUES
        (@AdminID,N'Admin'),(@CustomerUserID,N'Customer'),(@ProductUserID,N'Product');

    DECLARE @Rows dbo.CustomerBatchType;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
    DECLARE @CustomerID INT,@RV1 VARBINARY(8),@RV2 VARBINARY(8),@AdminCustomerID INT,@AdminRV VARBINARY(8);

    INSERT @Rows VALUES(1,'C',NULL,'User Master customer '+@Suffix,@MarketID,@CurrencyID,NULL,NULL);
    INSERT @Result EXEC dbo.usp_Customer_Batch @Rows,@CustomerRoleName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=1 AND Status='OK' AND NewID IS NOT NULL AND NewRowVersion IS NOT NULL)
        THROW 52401,'CUSTOMER ROLE CREATE: expected OK with ID and RowVersion.',1;
    SELECT @CustomerID=NewID,@RV1=NewRowVersion FROM @Result WHERE RowNum=1;
    IF NOT EXISTS(SELECT 1 FROM dbo.Customer WHERE ID=@CustomerID AND Status='Active')
        THROW 52402,'CUSTOMER CREATE: expected default Active status.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(2,'U',@CustomerID,'User Master customer updated '+@Suffix,@MarketID,@CurrencyID,'Block',@RV1);
    INSERT @Result EXEC dbo.usp_Customer_Batch @Rows,@CustomerRoleName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=2 AND Status='OK' AND NewRowVersion<>@RV1)
        THROW 52403,'CUSTOMER ROLE UPDATE: expected a new RowVersion.',1;
    SELECT @RV2=NewRowVersion FROM @Result WHERE RowNum=2;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(3,'U',@CustomerID,'Stale customer '+@Suffix,@MarketID,@CurrencyID,'Active',@RV1);
    INSERT @Result EXEC dbo.usp_Customer_Batch @Rows,@CustomerRoleName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=3 AND Status='ERROR' AND Message='Concurrency conflict')
        THROW 52404,'CUSTOMER CONCURRENCY: expected an explicit concurrency conflict.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(4,'C',NULL,'Admin customer '+@Suffix,@MarketID,@CurrencyID,NULL,NULL);
    INSERT @Result EXEC dbo.usp_Customer_Batch @Rows,@AdminName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=4 AND Status='OK')
        THROW 52405,'CUSTOMER ADMIN CREATE: live Admin scope should authorize the write.',1;
    SELECT @AdminCustomerID=NewID,@AdminRV=NewRowVersion FROM @Result WHERE RowNum=4;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(5,'C',NULL,'Denied customer '+@Suffix,@MarketID,@CurrencyID,NULL,NULL);
    INSERT @Result EXEC dbo.usp_Customer_Batch @Rows,@ProductRoleName,1;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=5 AND Status='ERROR' AND Message='Customer access is required for this action.')
        THROW 52406,'CUSTOMER AUTHORIZATION: SQL trusted the supplied IsAdmin flag.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(6,'D',@CustomerID,NULL,NULL,NULL,NULL,@RV2);
    INSERT @Result EXEC dbo.usp_Customer_Batch @Rows,@CustomerRoleName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=6 AND Status='OK' AND Message='Blocked' AND NewRowVersion IS NOT NULL)
        THROW 52407,'CUSTOMER ROLE BLOCK: expected OK with a new RowVersion.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.Customer WHERE ID=@CustomerID AND Status='Block')
        THROW 52409,'CUSTOMER ROLE BLOCK: the master row should remain blocked.',1;

    DELETE @Rows; DELETE @Result;
    INSERT @Rows VALUES(7,'D',@AdminCustomerID,NULL,NULL,NULL,NULL,@AdminRV);
    INSERT @Result EXEC dbo.usp_Customer_Batch @Rows,@AdminName,0;
    IF NOT EXISTS(SELECT 1 FROM @Result WHERE RowNum=7 AND Status='OK')
        THROW 52408,'CUSTOMER ADMIN BLOCK: expected OK.',1;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Customer User Master contract';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
