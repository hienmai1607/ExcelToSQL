USE [test];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_Create
    @Username NVARCHAR(100), @OpportunityID INT, @ExpectedRowVersion VARBINARY(8),
    @CreationKey UNIQUEIDENTIFIER, @ResponseDue DATE,
    @Items dbo.PackagingRequestSelectionType READONLY, @RequestNotes NVARCHAR(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT,@ID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Request',@ActorID OUTPUT;
    IF @CreationKey IS NULL OR @ResponseDue IS NULL OR @ResponseDue<CONVERT(DATE,SYSUTCDATETIME())
        THROW 51120,'CreationKey and a response due date of today or later are required.',1;
    IF NOT EXISTS(SELECT 1 FROM @Items) OR (SELECT COUNT(*) FROM @Items)>10000
        THROW 51121,'Select between 1 and 10000 Opportunity items.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequest WITH(UPDLOCK,HOLDLOCK) WHERE CreationKey=@CreationKey)
            THROW 51122,'CreationKey already exists. Retrieve the existing request; do not create another.',1;
        IF NOT EXISTS(SELECT 1 FROM dbo.Opportunity WITH(UPDLOCK,HOLDLOCK)
                      WHERE ID=@OpportunityID AND Stage='Draft' AND RowVersion=@ExpectedRowVersion)
            THROW 51123,'Opportunity must be Draft with the expected RowVersion.',1;
        IF EXISTS(SELECT 1 FROM @Items s LEFT JOIN dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
            ON i.ID=s.OpportunityItemID AND i.OpportunityID=@OpportunityID
            AND i.Stage='Draft' AND i.RowVersion=s.ExpectedRowVersion WHERE i.ID IS NULL)
            THROW 51124,'Selected items must belong to the Draft Opportunity and have current RowVersions.',1;
        IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem p WITH(UPDLOCK,HOLDLOCK)
                  JOIN @Items s ON s.OpportunityItemID=p.OpportunityItemID WHERE p.IsOpen=1)
            THROW 51125,'A selected Opportunity item already has an open Packaging request.',1;
        IF NOT EXISTS(SELECT 1 FROM dbo.Opportunity o JOIN dbo.Customer c WITH(HOLDLOCK)
                      ON c.ID=o.CustomerID AND c.Status='Active' WHERE o.ID=@OpportunityID)
            THROW 51136,'Active Customer is required.',1;
        IF EXISTS(SELECT 1 FROM @Items s JOIN dbo.OpportunityItem i ON i.ID=s.OpportunityItemID
                  JOIN dbo.Product p WITH(HOLDLOCK) ON p.ID=i.ProductID WHERE p.Status<>'Active')
            THROW 51137,'Active Products are required.',1;
        INSERT dbo.PackagingConfigurationRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerID,
            CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue,RequestNotes)
        SELECT @CreationKey,o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,
            o.BidOpen,o.BidClose,o.RowVersion,@ActorID,@ResponseDue,@RequestNotes
        FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=@OpportunityID;
        SET @ID=SCOPE_IDENTITY();
        INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,
            ProductName,ItemDescription,AnnualUnit,SourceRowVersion,PackagingRequirement,CreatedBy)
        SELECT @ID,i.ID,i.ProductID,p.ProductCode,p.ProductName,i.ItemDescription,i.AnnualUnit,
            i.RowVersion,s.PackagingRequirement,@ActorID
        FROM @Items s JOIN dbo.OpportunityItem i ON i.ID=s.OpportunityItemID JOIN dbo.Product p ON p.ID=i.ProductID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT ID,RequestNumber,CreationKey,RowVersion FROM dbo.PackagingConfigurationRequest WHERE ID=@ID;
    SELECT ID,OpportunityItemID,Stage,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=@ID ORDER BY ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Assign
    @Username NVARCHAR(100), @ID INT, @PICUserID INT, @ExpectedRowVersion VARBINARY(8)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Review',@ActorID OUTPUT;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS(SELECT 1 FROM dbo.Users u WITH(UPDLOCK,HOLDLOCK) JOIN dbo.UserAccess a ON a.UserID=u.ID
                      WHERE u.ID=@PICUserID AND u.IsActive=1 AND a.Scope IN(N'Packaging',N'Admin'))
            THROW 51126,'PIC must be active with Packaging or Admin access.',1;
        UPDATE dbo.PackagingConfigurationRequestItem
        SET PICUserID=@PICUserID,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion AND Stage IN('Assigned','Working','Returned');
        IF @@ROWCOUNT<>1 THROW 51127,'Assignment rejected: stale RowVersion, missing item or locked stage.',1;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT ID,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO
/* Atomic bounded response batch. No workflow, request or assignment fields are accepted. */
CREATE OR ALTER PROCEDURE dbo.usp_PackagingResponse_Batch
    @Rows dbo.PackagingResponseBatchType READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    DECLARE @IsAdmin BIT=0;
    IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND Scope=N'Admin') SET @IsAdmin=1;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    BEGIN TRY
        BEGIN TRANSACTION;
        IF EXISTS(SELECT 1 FROM @Rows r LEFT JOIN dbo.PackagingConfigurationRequestItem i WITH(UPDLOCK,HOLDLOCK)
                  ON i.ID=r.ID AND i.RowVersion=r.RowVersionB64 AND (i.PICUserID=@ActorID OR @IsAdmin=1)
                  AND i.Stage IN('Assigned','Working','Returned') WHERE i.ID IS NULL)
            THROW 51128,'Response batch rejected: stale/missing item, different PIC or locked stage. No rows saved.',1;
        IF EXISTS(SELECT 1 FROM @Rows r LEFT JOIN dbo.PackagingMaterial m WITH(HOLDLOCK)
                  ON m.ID=r.MaterialID AND m.Status='Active' WHERE r.MaterialID IS NOT NULL AND m.ID IS NULL)
            THROW 51112,'Active Packaging Material is required.',1;
        UPDATE i SET MaterialID=r.MaterialID,HeightMM=r.HeightMM,WidthMM=r.WidthMM,LengthMM=r.LengthMM,
            Cost=r.Cost,CurrencyID=r.CurrencyID,CostBasis=NULLIF(LTRIM(RTRIM(r.CostBasis)),N''),
            ResponseNotes=r.ResponseNotes,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
        OUTPUT r.RowNum,'OK','Saved',inserted.ID,inserted.RowVersion INTO @Result
        FROM dbo.PackagingConfigurationRequestItem i JOIN @Rows r ON r.ID=i.ID
        WHERE i.RowVersion=r.RowVersionB64;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO
/* App-only interface. Current state and latest review metadata, no history rows.
   Manager approval is per item; header completion is derived at read time. */
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Transition
    @Username NVARCHAR(100), @ID INT, @ExpectedRowVersion VARBINARY(8),
    @TargetStage VARCHAR(20), @Comment NVARCHAR(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT,@Action VARCHAR(20),@Stage VARCHAR(20),@PIC INT;
    IF @TargetStage IS NULL OR @TargetStage NOT IN('Working','Pending Review','Approved','Returned','Canceled')
        THROW 51129,'Unsupported target stage.',1;
    SET @Action=CASE WHEN @TargetStage IN('Working','Pending Review') THEN 'Maintain' ELSE 'Review' END;
    EXEC dbo.usp_Packaging_Authorize @Username,@Action,@ActorID OUTPUT;
    DECLARE @IsAdmin BIT=0;
    IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND Scope=N'Admin') SET @IsAdmin=1;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @Stage=Stage,@PIC=PICUserID FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK)
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        IF @Stage IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
        IF @IsAdmin=0 AND @Action='Maintain' AND (@PIC IS NULL OR @PIC<>@ActorID)
            THROW 51130,'Only the assigned PIC can submit this response.',1;
        IF NOT ((@TargetStage='Working' AND @Stage IN('Assigned','Returned'))
            OR (@TargetStage='Pending Review' AND @Stage IN('Assigned','Working','Returned'))
            OR (@TargetStage IN('Approved','Returned') AND @Stage='Pending Review')
            OR (@TargetStage='Canceled' AND @Stage IN('Assigned','Working','Returned','Pending Review')))
            THROW 51131,'Invalid Packaging stage transition.',1;
        IF @TargetStage IN('Returned','Canceled') AND NULLIF(LTRIM(RTRIM(@Comment)),N'') IS NULL
            THROW 51132,'A reason is required for return or cancellation.',1;
        IF @IsAdmin=0 AND @TargetStage='Approved' AND @PIC=@ActorID
            THROW 51133,'The assigned PIC cannot approve their own response.',1;
        IF @TargetStage IN('Pending Review','Approved') AND EXISTS(
            SELECT 1 FROM dbo.PackagingConfigurationRequestItem i
            LEFT JOIN dbo.PackagingMaterial m WITH(HOLDLOCK) ON m.ID=i.MaterialID AND m.Status='Active'
            WHERE i.ID=@ID AND (m.ID IS NULL OR i.HeightMM IS NULL OR i.WidthMM IS NULL
                               OR i.Cost IS NULL OR i.CurrencyID IS NULL OR i.CostBasis IS NULL))
            THROW 51134,'Active material, height, width, cost, currency and cost basis are required for review.',1;
        UPDATE dbo.PackagingConfigurationRequestItem
        SET Stage=@TargetStage,IsOpen=CASE WHEN @TargetStage IN('Approved','Canceled') THEN 0 ELSE 1 END,
            SubmittedAt=CASE WHEN @TargetStage='Pending Review' THEN SYSUTCDATETIME() ELSE SubmittedAt END,
            SubmittedBy=CASE WHEN @TargetStage='Pending Review' THEN @ActorID ELSE SubmittedBy END,
            ReviewedAt=CASE WHEN @Action='Review' THEN SYSUTCDATETIME()
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedAt END,
            ReviewedBy=CASE WHEN @Action='Review' THEN @ActorID
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedBy END,
            ManagerComment=CASE WHEN @Action='Review' THEN @Comment
                                WHEN @TargetStage='Pending Review' THEN NULL ELSE ManagerComment END,
            UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT ID,Stage,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO
/* Item paging is intentional: repeated snapshots are independent of row position.
   Assemble pages into the 10k Excel table; server-wide filtering precedes paging. */
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_Grid_Read
    @Username NVARCHAR(100), @RequestID INT=NULL, @OpportunityID INT=NULL,
    @ProductCode VARCHAR(20)=NULL, @CustomerName VARCHAR(200)=NULL,
    @Stage VARCHAR(20)=NULL, @PICUserID INT=NULL, @DueFrom DATE=NULL, @DueTo DATE=NULL,
    @AfterID INT=0, @PageSize INT=500, @CreationKey UNIQUEIDENTIFIER=NULL,
    @PageNumber INT=NULL, @OpportunityNumber VARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Read',@ActorID OUTPUT;
    DECLARE @CanReadDraft BIT=0;
    IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID
              AND Scope IN(N'Packaging',N'PackagingManager',N'Admin')) SET @CanReadDraft=1;
    IF @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 500 OR @AfterID IS NULL OR @AfterID<0
        THROW 51135,'Page size must be 1-500 and AfterID must be nonnegative.',1;
    IF @PageNumber IS NOT NULL AND (@PageNumber<1 OR @AfterID<>0)
        THROW 51135,'Use page numbers or AfterID, not both.',1;
    ;WITH Matched AS (
        SELECT i.ID AS ItemID,h.ID AS RequestID,h.RequestNumber,h.CreationKey,
            h.RequestedBy,requester.UserName AS RequestedByName,h.RequestedAt,h.ResponseDue,h.RequestNotes,
            h.OpportunityID,h.OpportunityNumber,h.CustomerName,h.OpportunityDescription,h.BidOpen,h.BidClose,
            h.RowVersion AS HeaderRowVersion,i.OpportunityItemID,i.ProductID,i.ProductCode,i.ProductName,
            i.ItemDescription,i.AnnualUnit,i.PackagingRequirement,i.PICUserID,u.UserName AS PIC,
            i.Stage AS ItemStage,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.MaterialID END AS MaterialID,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN m.MaterialCode END AS MaterialCode,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.HeightMM END AS HeightMM,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.WidthMM END AS WidthMM,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.LengthMM END AS LengthMM,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.Cost END AS Cost,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CurrencyID END AS CurrencyID,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN c.CurrencyCode END AS CurrencyCode,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CostBasis END AS CostBasis,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponseNotes END AS ResponseNotes,
            i.SubmittedAt,i.SubmittedBy,i.ReviewedAt,i.ReviewedBy,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ManagerComment END AS ManagerComment,
            i.RowVersion AS ItemRowVersion,
            CASE WHEN totals.OpenCount>0 THEN 'Open'
                 WHEN totals.ApprovedCount>0 THEN 'Completed' ELSE 'Canceled' END AS RequestStatus,
            CONVERT(BIT,CASE WHEN o.RowVersion<>h.SourceRowVersion OR oi.RowVersion<>i.SourceRowVersion THEN 1 ELSE 0 END) AS SourceChanged,
            COUNT_BIG(*) OVER() AS TotalMatchingRows
        FROM dbo.PackagingConfigurationRequest h
        JOIN dbo.Users requester ON requester.ID=h.RequestedBy
        JOIN dbo.PackagingConfigurationRequestItem i ON i.RequestID=h.ID
        JOIN dbo.Opportunity o ON o.ID=h.OpportunityID
        JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
        LEFT JOIN dbo.Users u ON u.ID=i.PICUserID
        LEFT JOIN dbo.PackagingMaterial m ON m.ID=i.MaterialID
        LEFT JOIN dbo.Currency c ON c.ID=i.CurrencyID
        CROSS APPLY (SELECT SUM(CONVERT(INT,t.IsOpen)) OpenCount,
            SUM(CASE WHEN t.Stage='Approved' THEN 1 ELSE 0 END) ApprovedCount
            FROM dbo.PackagingConfigurationRequestItem t WHERE t.RequestID=h.ID) totals
        WHERE (@RequestID IS NULL OR h.ID=@RequestID)
          AND (@CreationKey IS NULL OR h.CreationKey=@CreationKey)
          AND (@OpportunityID IS NULL OR h.OpportunityID=@OpportunityID)
          AND (@OpportunityNumber IS NULL OR h.OpportunityNumber LIKE @OpportunityNumber+'%')
          AND (@ProductCode IS NULL OR i.ProductCode LIKE @ProductCode+'%')
          AND (@CustomerName IS NULL OR h.CustomerName LIKE @CustomerName+'%')
          AND (@Stage IS NULL OR i.Stage=@Stage)
          AND (@PICUserID IS NULL OR i.PICUserID=@PICUserID)
          AND (@DueFrom IS NULL OR h.ResponseDue>=@DueFrom)
          AND (@DueTo IS NULL OR h.ResponseDue<=@DueTo)
    )
    SELECT * FROM Matched WHERE ItemID>@AfterID ORDER BY ItemID
    OFFSET (CONVERT(BIGINT,COALESCE(@PageNumber,1))-1)*@PageSize ROWS
    FETCH NEXT @PageSize ROWS ONLY;
END;
GO
