USE [test]
GO

CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_Grid_Read
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0,
    @PageNumber INT = 1,
    @PageSize INT = 200,
    @OpportunityNumber VARCHAR(20) = NULL,
    @CustomerName VARCHAR(200) = NULL,
    @Stage VARCHAR(20) = NULL,
    @BidOpenFrom DATE = NULL,
    @BidOpenTo DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize < 1 SET @PageSize = 1;
    IF @PageSize > 500 SET @PageSize = 500;
    IF @PageNumber < 1 SET @PageNumber = 1;

    -- Never trust the caller's @IsAdmin flag. SQL independently checks the
    -- live role so direct callers cannot bypass authorization.
    IF NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess ua
        JOIN dbo.Users u ON u.ID = ua.UserID
        WHERE u.UserName = @Username AND u.IsActive = 1
          AND ua.Scope IN (N'Admin', N'Opportunity')
    )
        THROW 52744, 'Opportunity access is required for this action.', 1;

    ;WITH FilteredOpportunities AS (
        SELECT
            o.ID, o.OpportunityNumber, o.CustomerID, c.CustomerName,
            o.OpportunityDesc, o.BidOpen, o.BidClose, o.Stage, o.RowVersion,
            COUNT_BIG(*) OVER() AS TotalMatchingRows
        FROM dbo.Opportunity AS o
        JOIN dbo.Customer AS c ON c.ID = o.CustomerID
        WHERE (@OpportunityNumber IS NULL OR o.OpportunityNumber LIKE @OpportunityNumber + '%')
          AND (@CustomerName IS NULL OR c.CustomerName LIKE @CustomerName + '%')
          AND (@Stage IS NULL OR o.Stage = @Stage)
          AND (@BidOpenFrom IS NULL OR o.BidOpen >= @BidOpenFrom)
          AND (@BidOpenTo IS NULL OR o.BidOpen <= @BidOpenTo)
    ), PagedOpportunities AS (
        -- Page headers before joining items. Applying OFFSET after the join
        -- would split one Opportunity's items across adjacent pages.
        SELECT * FROM FilteredOpportunities
        ORDER BY BidOpen DESC, ID DESC
        OFFSET (@PageNumber - 1) * @PageSize ROWS
        FETCH NEXT @PageSize ROWS ONLY
    )
    SELECT
        o.ID AS OpportunityID, o.OpportunityNumber, o.CustomerID, o.CustomerName,
        o.OpportunityDesc, o.BidOpen, o.BidClose, o.Stage AS HeaderStage,
        o.RowVersion AS HeaderRowVersion,
        oi.ID AS ItemID, oi.ProductID, p.ProductCode, oi.ItemDescription,
        oi.AnnualUnit, oi.EstPctAwarded, oi.ShelfPrice, oi.Stage AS ItemStage,
        oi.RowVersion AS ItemRowVersion, o.TotalMatchingRows
    FROM PagedOpportunities AS o
    LEFT JOIN dbo.OpportunityItem AS oi ON oi.OpportunityID = o.ID
    LEFT JOIN dbo.Product AS p ON p.ID = oi.ProductID
    ORDER BY o.BidOpen DESC, o.ID DESC, oi.ID
END
GO
