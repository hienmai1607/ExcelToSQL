USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
SET NOCOUNT ON;

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Suffix VARCHAR(12)=REPLACE(LEFT(CONVERT(VARCHAR(36),NEWID()),12),'-','');
    DECLARE @AdminName NVARCHAR(100)=N'zz.ur.admin.'+@Suffix;
    DECLARE @ProductName NVARCHAR(100)=N'zz.ur.product.'+@Suffix;
    DECLARE @CustomerName NVARCHAR(100)=N'zz.ur.customer.'+@Suffix;
    DECLARE @OpportunityName NVARCHAR(100)=N'zz.ur.opportunity.'+@Suffix;
    DECLARE @AdminID INT,@ProductID INT,@CustomerID INT,@OpportunityID INT;
    INSERT dbo.Users(UserName,IsActive) VALUES(@AdminName,1);SET @AdminID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName,IsActive) VALUES(@ProductName,1);SET @ProductID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName,IsActive) VALUES(@CustomerName,1);SET @CustomerID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName,IsActive) VALUES(@OpportunityName,1);SET @OpportunityID=SCOPE_IDENTITY();
    INSERT dbo.UserAccess(UserID,Scope) VALUES
      (@AdminID,N'Admin'),(@ProductID,N'Product'),(@CustomerID,N'Customer'),(@OpportunityID,N'Opportunity');

    DECLARE @ProductRows TABLE(
      ID INT,ProductCode VARCHAR(20),ProductName VARCHAR(200),WeightGrams DECIMAL(10,2),WeightOz DECIMAL(10,2),Status VARCHAR(10),
      CreatedAt DATETIME2,CreatedBy INT,UpdatedAt DATETIME2 NULL,UpdatedBy INT NULL,RowVersion VARBINARY(8),TotalMatchingRows BIGINT
    );
    INSERT @ProductRows EXEC dbo.usp_Product_Read @ProductName,0,NULL,NULL,1,1;
    DELETE @ProductRows;
    INSERT @ProductRows EXEC dbo.usp_Product_Read @AdminName,0,NULL,NULL,1,1;
    DELETE @ProductRows;
    INSERT @ProductRows EXEC dbo.usp_Product_Read @OpportunityName,0,NULL,NULL,1,1;

    DECLARE @Denied BIT=0;
    BEGIN TRY
      DELETE @ProductRows;
      INSERT @ProductRows EXEC dbo.usp_Product_Read @CustomerName,1,NULL,NULL,1,1;
    END TRY BEGIN CATCH
      IF ERROR_MESSAGE()='Product access is required for this action.' SET @Denied=1 ELSE THROW;
    END CATCH;
    IF @Denied=0 THROW 52501,'PRODUCT READ: unauthorized scope or spoofed IsAdmin was accepted.',1;

    DECLARE @CustomerRows TABLE(
      ID INT,CustomerName VARCHAR(200),MarketID INT,MarketCode VARCHAR(10),CurrencyID INT,CurrencyCode CHAR(3),
      Status VARCHAR(10),CreatedAt DATETIME2,CreatedBy INT,UpdatedAt DATETIME2 NULL,UpdatedBy INT NULL,
      RowVersion VARBINARY(8),TotalMatchingRows BIGINT
    );
    INSERT @CustomerRows EXEC dbo.usp_Customer_Read @CustomerName,0,NULL,NULL,NULL,1,1;
    DELETE @CustomerRows;
    INSERT @CustomerRows EXEC dbo.usp_Customer_Read @AdminName,0,NULL,NULL,NULL,1,1;
    DELETE @CustomerRows;
    INSERT @CustomerRows EXEC dbo.usp_Customer_Read @OpportunityName,0,NULL,NULL,NULL,1,1;

    SET @Denied=0;
    BEGIN TRY
      DELETE @CustomerRows;
      INSERT @CustomerRows EXEC dbo.usp_Customer_Read @ProductName,1,NULL,NULL,NULL,1,1;
    END TRY BEGIN CATCH
      IF ERROR_MESSAGE()='Customer access is required for this action.' SET @Denied=1 ELSE THROW;
    END CATCH;
    IF @Denied=0 THROW 52502,'CUSTOMER READ: unauthorized scope or spoofed IsAdmin was accepted.',1;

    DECLARE @MarketID INT=(SELECT TOP(1) ID FROM dbo.Market ORDER BY ID);
    DECLARE @CurrencyID INT=(SELECT TOP(1) ID FROM dbo.Currency ORDER BY ID);
    DECLARE @ActiveProductID INT,@BlockedProductID INT,@ActiveCustomerID INT,@BlockedCustomerID INT;
    INSERT dbo.Product(ProductCode,ProductName,WeightGrams,Status,CreatedBy)
      VALUES('LRPA'+@Suffix,'Lookup active product '+@Suffix,1,'Active',@AdminID);SET @ActiveProductID=SCOPE_IDENTITY();
    INSERT dbo.Product(ProductCode,ProductName,WeightGrams,Status,CreatedBy)
      VALUES('LRPB'+@Suffix,'Lookup blocked product '+@Suffix,1,'Block',@AdminID);SET @BlockedProductID=SCOPE_IDENTITY();
    INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,Status,CreatedBy)
      VALUES('Lookup active customer '+@Suffix,@MarketID,@CurrencyID,'Active',@AdminID);SET @ActiveCustomerID=SCOPE_IDENTITY();
    INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,Status,CreatedBy)
      VALUES('Lookup blocked customer '+@Suffix,@MarketID,@CurrencyID,'Block',@AdminID);SET @BlockedCustomerID=SCOPE_IDENTITY();

    DECLARE @ProductLookup TABLE(ID INT,ProductCode VARCHAR(20),ProductName VARCHAR(200));
    INSERT @ProductLookup EXEC dbo.usp_OpportunityProductLookup_Read @OpportunityName;
    IF NOT EXISTS(SELECT 1 FROM @ProductLookup WHERE ID=@ActiveProductID) OR EXISTS(SELECT 1 FROM @ProductLookup WHERE ID=@BlockedProductID)
      THROW 52503,'OPPORTUNITY LOOKUP: Product list must include only active rows.',1;
    DECLARE @CustomerLookup TABLE(ID INT,CustomerName VARCHAR(200));
    INSERT @CustomerLookup EXEC dbo.usp_OpportunityCustomerLookup_Read @OpportunityName;
    IF NOT EXISTS(SELECT 1 FROM @CustomerLookup WHERE ID=@ActiveCustomerID) OR EXISTS(SELECT 1 FROM @CustomerLookup WHERE ID=@BlockedCustomerID)
      THROW 52504,'OPPORTUNITY LOOKUP: Customer list must include only active rows.',1;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Customer/Product User Master read authorization';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
