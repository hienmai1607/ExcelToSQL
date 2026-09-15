USE [test]
GO

/* Opportunity users need Customer rows as read-only lookup data. */
CREATE OR ALTER PROCEDURE dbo.usp_Customer_Read
    @Username     NVARCHAR(100),
    @IsAdmin      BIT = 0,
    @CustomerName VARCHAR(200) = NULL,
    @MarketID     INT = NULL,
    @Status       VARCHAR(10) = NULL,
    @PageNumber   INT = 1,
    @PageSize     INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize > 500 SET @PageSize = 500;
    IF @PageSize < 1 SET @PageSize = 1;
    IF @PageNumber < 1 SET @PageNumber = 1;

    IF @IsAdmin = 0 AND NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.ID = ua.UserID
        WHERE u.UserName = @Username
          AND u.IsActive = 1
          AND ua.Scope IN ('Customer', 'Opportunity')
    )
    BEGIN
        SELECT CAST(NULL AS INT) AS ID WHERE 1 = 0;
        RETURN;
    END

    SELECT
        c.ID, c.CustomerName, c.MarketID, m.MarketCode,
        c.CurrencyID, cur.CurrencyCode,
        c.Status, c.CreatedAt, c.CreatedBy, c.UpdatedAt, c.UpdatedBy, c.RowVersion,
        COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Customer AS c
    JOIN dbo.Market AS m ON m.ID = c.MarketID
    JOIN dbo.Currency AS cur ON cur.ID = c.CurrencyID
    WHERE (@CustomerName IS NULL OR c.CustomerName LIKE @CustomerName + '%')
      AND (@MarketID IS NULL OR c.MarketID = @MarketID)
      AND (@Status IS NULL OR c.Status = @Status)
    ORDER BY c.CustomerName
    OFFSET (@PageNumber - 1) * @PageSize ROWS
    FETCH NEXT @PageSize ROWS ONLY;
END
GO
