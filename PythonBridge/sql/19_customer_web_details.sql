USE [test]
GO
-- Additional optional parameters preserve existing Excel callers.
CREATE OR ALTER PROCEDURE dbo.usp_Customer_Read
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0,
    @CustomerName VARCHAR(200) = NULL,
    @MarketID INT = NULL,
    @Status VARCHAR(10) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 200,
    @CurrencyID INT = NULL,
    @CreatedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize>500 SET @PageSize=500;
    IF @PageSize<1 SET @PageSize=1;
    IF @PageNumber<1 SET @PageNumber=1;

    IF NOT EXISTS(
        SELECT 1
        FROM dbo.Users AS u
        JOIN dbo.UserAccess AS a ON a.UserID=u.ID
        WHERE u.UserName=@Username AND u.IsActive=1
          AND a.Scope IN(N'Admin',N'Customer',N'Opportunity')
    ) THROW 51041,'Customer access is required for this action.',1;

    SELECT c.ID,c.CustomerName,c.MarketID,m.MarketCode,
           c.CurrencyID,cur.CurrencyCode,c.Status,c.CreatedAt,c.CreatedBy,
           c.UpdatedAt,c.UpdatedBy,c.RowVersion,
           creator.UserName AS CreatedByName, updater.UserName AS UpdatedByName,
           COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Customer AS c
    JOIN dbo.Market AS m ON m.ID=c.MarketID
    JOIN dbo.Currency AS cur ON cur.ID=c.CurrencyID
    LEFT JOIN dbo.Users creator ON creator.ID=c.CreatedBy
    LEFT JOIN dbo.Users updater ON updater.ID=c.UpdatedBy
    WHERE (@CustomerName IS NULL OR c.CustomerName LIKE @CustomerName+'%')
      AND (@MarketID IS NULL OR c.MarketID=@MarketID)
      AND (@Status IS NULL OR c.Status=@Status)
      AND (@CurrencyID IS NULL OR c.CurrencyID=@CurrencyID)
      AND (@CreatedBy IS NULL OR c.CreatedBy=@CreatedBy)
    ORDER BY c.CustomerName,c.ID
    OFFSET (@PageNumber-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CustomerMarketLookup_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope IN(N'Admin',N'Customer') WHERE u.UserName=@Username AND u.IsActive=1)
        THROW 51032,'Customer access is required for this action.',1;
    SELECT ID,MarketCode,MarketName FROM dbo.Market ORDER BY MarketCode;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_CustomerCurrencyLookup_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope IN(N'Admin',N'Customer') WHERE u.UserName=@Username AND u.IsActive=1)
        THROW 51033,'Customer access is required for this action.',1;
    SELECT ID,CurrencyCode,CurrencyName FROM dbo.Currency ORDER BY CurrencyCode;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_CustomerCreatorLookup_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope IN(N'Admin',N'Customer') WHERE u.UserName=@Username AND u.IsActive=1)
        THROW 51032,'Customer access is required for this action.',1;
    SELECT u.ID,u.UserName FROM dbo.Users u
    WHERE EXISTS(SELECT 1 FROM dbo.Customer c WHERE c.CreatedBy=u.ID)
    ORDER BY u.UserName,u.ID;
END
GO

