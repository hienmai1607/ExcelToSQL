USE [test];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingManualSource_Read
    @Username NVARCHAR(100),@OpportunityNumber VARCHAR(20)=NULL,
    @PageNumber INT=1,@PageSize INT=200
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Request',@ActorID OUTPUT;
    IF @PageNumber IS NULL OR @PageNumber<1 OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 500
        THROW 51114,'Page number must be positive; page size must be 1-500.',1;
    SELECT o.ID AS OpportunityID,o.OpportunityNumber,c.CustomerName,o.OpportunityDesc AS OpportunityDescription,
        o.BidOpen,o.BidClose,o.RowVersion AS HeaderRowVersion,i.ID AS OpportunityItemID,
        p.ProductCode,p.ProductName,i.ItemDescription,i.AnnualUnit,i.RowVersion AS ItemRowVersion,
        COUNT_BIG(*) OVER() AS TotalMatchingRows
    FROM dbo.Opportunity o JOIN dbo.OpportunityItem i ON i.OpportunityID=o.ID
    JOIN dbo.Customer c ON c.ID=o.CustomerID JOIN dbo.Product p ON p.ID=i.ProductID
    WHERE o.Stage='Draft' AND i.Stage='Draft' AND c.Status='Active' AND p.Status='Active'
      AND (@OpportunityNumber IS NULL OR o.OpportunityNumber LIKE @OpportunityNumber+'%')
      AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID AND r.IsOpen=1)
    ORDER BY o.ID,i.ID
    OFFSET (CONVERT(BIGINT,@PageNumber)-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingWorkbookLookup_Read @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@ActorID OUTPUT;
    SELECT ID,MaterialCode,Status FROM dbo.PackagingMaterial ORDER BY MaterialCode;
    SELECT ID,CurrencyCode FROM dbo.Currency ORDER BY CurrencyCode;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_Replay_Read
    @Username NVARCHAR(100),@CreationKey UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ActorID INT,@ID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Request',@ActorID OUTPUT;
    SELECT @ID=ID FROM dbo.PackagingConfigurationRequest WHERE CreationKey=@CreationKey AND RequestedBy=@ActorID;
    SELECT ID,RequestNumber,CreationKey,OpportunityID,ResponseDue,RequestNotes,RowVersion
    FROM dbo.PackagingConfigurationRequest WHERE ID=@ID;
    SELECT ID,OpportunityItemID,PackagingRequirement,Stage,RowVersion
    FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=@ID ORDER BY ID;
END;
GO

