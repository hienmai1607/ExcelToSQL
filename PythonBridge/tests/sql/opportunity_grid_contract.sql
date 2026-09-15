USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT OFF;

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Suffix VARCHAR(12)=REPLACE(LEFT(CONVERT(VARCHAR(36),NEWID()),12),'-','');
    DECLARE @OpportunityUser NVARCHAR(100)=N'zz.grid.opp.'+@Suffix,@DeniedUser NVARCHAR(100)=N'zz.grid.denied.'+@Suffix;
    DECLARE @GridCustomerName VARCHAR(200)='ZZ Grid Customer '+@Suffix;
    DECLARE @UserID INT,@DeniedID INT,@MarketID INT,@CurrencyID INT,@CustomerID INT,@Product1 INT,@Product2 INT,@Opp1 INT,@Opp2 INT;
    SELECT TOP(1) @MarketID=ID FROM dbo.Market ORDER BY ID;
    SELECT TOP(1) @CurrencyID=ID FROM dbo.Currency ORDER BY ID;
    SELECT TOP(1) @Product1=ID FROM dbo.Product WHERE Status='Active' ORDER BY ID;
    SELECT TOP(1) @Product2=ID FROM dbo.Product WHERE Status='Active' AND ID<>@Product1 ORDER BY ID;
    IF @Product2 IS NULL SET @Product2=@Product1;

    INSERT dbo.Users(UserName,IsActive) VALUES(@OpportunityUser,1); SET @UserID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName,IsActive) VALUES(@DeniedUser,1); SET @DeniedID=SCOPE_IDENTITY();
    INSERT dbo.UserAccess(UserID,Scope) VALUES(@UserID,N'Opportunity'),(@DeniedID,N'Customer');
    INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,Status,CreatedBy)
    VALUES(@GridCustomerName,@MarketID,@CurrencyID,'Active',@UserID); SET @CustomerID=SCOPE_IDENTITY();
    INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
    VALUES('ZG1-'+@Suffix,@CustomerID,'Grid 1','2026-01-01','2026-01-31','Draft',@UserID); SET @Opp1=SCOPE_IDENTITY();
    INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
    VALUES('ZG2-'+@Suffix,@CustomerID,'Grid 2','2026-02-01','2026-02-28','Draft',@UserID); SET @Opp2=SCOPE_IDENTITY();
    INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy)
    VALUES(@Opp2,@Product1,'Line 1',1,'Draft',@UserID),(@Opp2,@Product2,'Line 2',2,'Draft',@UserID);

    DECLARE @Rows TABLE(
        OpportunityID INT,OpportunityNumber VARCHAR(20),CustomerID INT,CustomerName VARCHAR(200),
        OpportunityDesc VARCHAR(300),BidOpen DATE,BidClose DATE,HeaderStage VARCHAR(20),HeaderRowVersion VARBINARY(8),
        ItemID INT,ProductID INT,ProductCode VARCHAR(20),ItemDescription VARCHAR(300),AnnualUnit INT,
        EstPctAwarded DECIMAL(5,2),ShelfPrice DECIMAL(10,2),ItemStage VARCHAR(20),ItemRowVersion VARBINARY(8),
        TotalMatchingRows BIGINT
    );
    INSERT @Rows EXEC dbo.usp_Opportunity_Grid_Read
        @OpportunityUser,0,1,1,NULL,@GridCustomerName,'Draft',NULL,NULL;
    IF (SELECT COUNT(DISTINCT OpportunityID) FROM @Rows)<>1 THROW 52740,'GRID PAGING: page split or returned multiple headers.',1;
    IF (SELECT COUNT(*) FROM @Rows)<>2 THROW 52741,'GRID PAGING: first header did not retain both items.',1;
    IF EXISTS(SELECT 1 FROM @Rows WHERE TotalMatchingRows<>2) THROW 52742,'GRID PAGING: total header count is incorrect.',1;

    BEGIN TRY
        DELETE FROM @Rows;
        INSERT @Rows EXEC dbo.usp_Opportunity_Grid_Read @DeniedUser,1,1,1,NULL,NULL,NULL,NULL,NULL;
        THROW 52743,'GRID AUTHORIZATION: supplied IsAdmin bypassed SQL authorization.',1;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER()=52743 THROW;
    END CATCH;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Opportunity grid pagination contract';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
