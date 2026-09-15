USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT OFF;

IF OBJECT_ID(N'dbo.OpportunityStageHistory',N'U') IS NULL
    THROW 52701,'WORKFLOW: OpportunityStageHistory is missing.',1;
IF OBJECT_ID(N'dbo.OpportunityItemStageHistory',N'U') IS NULL
    THROW 52702,'WORKFLOW: OpportunityItemStageHistory is missing.',1;
IF OBJECT_ID(N'dbo.usp_Opportunity_HeaderStage_Transition',N'P') IS NULL
    THROW 52703,'WORKFLOW: header transition procedure is missing.',1;
IF OBJECT_ID(N'dbo.usp_Opportunity_ItemStage_Transition',N'P') IS NULL
    THROW 52704,'WORKFLOW: item transition procedure is missing.',1;
GO

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @Suffix VARCHAR(12)=REPLACE(LEFT(CONVERT(VARCHAR(36),NEWID()),12),'-','');
    DECLARE @OpportunityUser NVARCHAR(100)=N'zz.tx.opp.'+@Suffix;
    DECLARE @DeniedUser NVARCHAR(100)=N'zz.tx.denied.'+@Suffix;
    DECLARE @UserID INT,@DeniedID INT,@CustomerID INT,@ProductID INT;
    SELECT TOP(1) @CustomerID=ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID;
    SELECT TOP(1) @ProductID=ID FROM dbo.Product WHERE Status='Active' ORDER BY ID;
    IF @CustomerID IS NULL OR @ProductID IS NULL THROW 52705,'WORKFLOW TEST: active Customer and Product are required.',1;

    INSERT dbo.Users(UserName,IsActive) VALUES(@OpportunityUser,1); SET @UserID=SCOPE_IDENTITY();
    INSERT dbo.Users(UserName,IsActive) VALUES(@DeniedUser,1); SET @DeniedID=SCOPE_IDENTITY();
    INSERT dbo.UserAccess(UserID,Scope) VALUES(@UserID,N'Opportunity'),(@DeniedID,N'Customer');

    DECLARE @HeaderRows dbo.OpportunityHeaderBatchType;
    DECLARE @ItemRows dbo.OpportunityItemBatchType;
    DECLARE @OpportunityID INT,@ItemID INT,@OpportunityNumber VARCHAR(20),@HeaderRV VARBINARY(8),@ItemRV VARBINARY(8);
    DECLARE @ActualHeaderStage VARCHAR(20),@ActualItemStage VARCHAR(20),@ActualDescription VARCHAR(300);

    -- Excel-supplied workflow stages must not be honored. SQL creates Draft.
    INSERT @HeaderRows VALUES(1,'C',NULL,'CLIENT-'+@Suffix,@CustomerID,'Workflow ownership test','2026-01-01','2026-01-31','Closed',NULL);
    INSERT @ItemRows VALUES(2,'C',NULL,'CLIENT-'+@Suffix,@ProductID,'Workflow item',100,25,10,'Awarded',NULL);
    EXEC dbo.usp_Opportunity_HeaderDetail_Batch @HeaderRows,@ItemRows,@OpportunityUser,0;
    SELECT @OpportunityID=ID,@OpportunityNumber=OpportunityNumber,@HeaderRV=RowVersion
    FROM dbo.Opportunity WHERE OpportunityDesc='Workflow ownership test' AND CreatedBy=@UserID;
    IF @OpportunityID IS NULL THROW 52706,'DRAFT CREATE: header failed.',1;
    SELECT @ItemID=ID,@ItemRV=RowVersion FROM dbo.OpportunityItem WHERE OpportunityID=@OpportunityID;
    SELECT @ActualHeaderStage=Stage FROM dbo.Opportunity WHERE ID=@OpportunityID;
    SELECT @ActualItemStage=Stage FROM dbo.OpportunityItem WHERE ID=@ItemID;
    IF @ActualHeaderStage<>'Draft' THROW 52707,'DRAFT CREATE: Excel changed header stage.',1;
    IF @ActualItemStage<>'Draft' THROW 52708,'DRAFT CREATE: Excel changed item stage.',1;

    -- Excel updates content but cannot change stage.
    DELETE @HeaderRows; DELETE @ItemRows;
    INSERT @HeaderRows VALUES(3,'U',@OpportunityID,@OpportunityNumber,@CustomerID,'Workflow ownership updated','2026-01-01','2026-02-01','Closed',@HeaderRV);
    EXEC dbo.usp_Opportunity_HeaderDetail_Batch @HeaderRows,@ItemRows,@OpportunityUser,0;
    SELECT @ActualDescription=OpportunityDesc,@ActualHeaderStage=Stage FROM dbo.Opportunity WHERE ID=@OpportunityID;
    IF @ActualDescription<>'Workflow ownership updated' THROW 52709,'DRAFT UPDATE: expected updated content.',1;
    IF @ActualHeaderStage<>'Draft' THROW 52710,'DRAFT UPDATE: Excel changed header stage.',1;
    SELECT @HeaderRV=RowVersion FROM dbo.Opportunity WHERE ID=@OpportunityID;

    DECLARE @HeaderRequest UNIQUEIDENTIFIER=NEWID();
    DECLARE @Transition TABLE(Status VARCHAR(10),Message VARCHAR(500),ID INT,Stage VARCHAR(20),NewRowVersion VARBINARY(8));
    INSERT @Transition EXEC dbo.usp_Opportunity_HeaderStage_Transition @OpportunityID,'In progress',@HeaderRV,'Submit from application',@HeaderRequest,@OpportunityUser;
    IF NOT EXISTS(SELECT 1 FROM @Transition WHERE Status='OK' AND Stage='In progress' AND NewRowVersion IS NOT NULL)
        THROW 52711,'HEADER TRANSITION: expected Draft to In progress.',1;
    SELECT @HeaderRV=NewRowVersion FROM @Transition;

    -- Reusing the same RequestID is idempotent.
    DELETE @Transition;
    INSERT @Transition EXEC dbo.usp_Opportunity_HeaderStage_Transition @OpportunityID,'In progress',@HeaderRV,'Submit from application',@HeaderRequest,@OpportunityUser;
    IF NOT EXISTS(SELECT 1 FROM @Transition WHERE Status='OK' AND Message='Already applied')
        THROW 52712,'HEADER TRANSITION: duplicate RequestID was not idempotent.',1;

    -- Once workflow starts, Excel cannot alter transactional content.
    DELETE @HeaderRows;
    INSERT @HeaderRows VALUES(4,'U',@OpportunityID,@OpportunityNumber,@CustomerID,'Illegal Excel update','2026-01-01','2026-02-01','Draft',@HeaderRV);
    EXEC dbo.usp_Opportunity_HeaderDetail_Batch @HeaderRows,@ItemRows,@OpportunityUser,0;
    SELECT @ActualDescription=OpportunityDesc FROM dbo.Opportunity WHERE ID=@OpportunityID;
    IF @ActualDescription='Illegal Excel update'
        THROW 52713,'DRAFT LOCK: non-Draft content update was allowed.',1;

    DECLARE @ItemTransition TABLE(Status VARCHAR(10),Message VARCHAR(500),ID INT,Stage VARCHAR(20),NewRowVersion VARBINARY(8),HeaderRowVersion VARBINARY(8));
    DECLARE @ItemRequest UNIQUEIDENTIFIER=NEWID();
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess ua ON ua.UserID=u.ID
                  WHERE u.UserName=@OpportunityUser AND u.IsActive=1 AND ua.Scope IN(N'Admin',N'Opportunity'))
        THROW 52724,'ITEM TRANSITION TEST: opportunity user unexpectedly missing.',1;
    INSERT @ItemTransition EXEC dbo.usp_Opportunity_ItemStage_Transition
        @OpportunityItemID=@ItemID,@TargetStage='In progress',@ExpectedRowVersion=@ItemRV,
        @Reason='Start item',@RequestID=@ItemRequest,@Username=@OpportunityUser;
    IF NOT EXISTS(SELECT 1 FROM @ItemTransition WHERE Status='OK' AND Stage='In progress')
        THROW 52716,'ITEM TRANSITION: expected Draft to In progress.',1;
    SELECT @ItemRV=NewRowVersion,@HeaderRV=HeaderRowVersion FROM @ItemTransition;
    DELETE FROM @ItemTransition;
    INSERT @ItemTransition EXEC dbo.usp_Opportunity_ItemStage_Transition
        @OpportunityItemID=@ItemID,@TargetStage='In progress',@ExpectedRowVersion=@ItemRV,
        @Reason='Start item',@RequestID=@ItemRequest,@Username=@OpportunityUser;
    IF NOT EXISTS(SELECT 1 FROM @ItemTransition WHERE Status='OK' AND Message='Already applied' AND HeaderRowVersion IS NOT NULL)
        THROW 52725,'ITEM TRANSITION: duplicate RequestID did not return the applied header RowVersion.',1;

    DECLARE @CloseRequest UNIQUEIDENTIFIER=NEWID();
    BEGIN TRY
        EXEC dbo.usp_Opportunity_HeaderStage_Transition @OpportunityID,'Closed',@HeaderRV,'Too early',@CloseRequest,@OpportunityUser;
        THROW 52717,'HEADER CONSISTENCY: non-terminal items allowed header close.',1;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER()=52717 THROW;
    END CATCH;

    SET @ItemRequest=NEWID();
    DELETE FROM @ItemTransition;
    INSERT @ItemTransition EXEC dbo.usp_Opportunity_ItemStage_Transition
        @OpportunityItemID=@ItemID,@TargetStage='Proposed',@ExpectedRowVersion=@ItemRV,
        @Reason='Proposal ready',@RequestID=@ItemRequest,@Username=@OpportunityUser;
    SELECT @ItemRV=NewRowVersion,@HeaderRV=HeaderRowVersion FROM @ItemTransition;
    SET @ItemRequest=NEWID(); DELETE FROM @ItemTransition;
    INSERT @ItemTransition EXEC dbo.usp_Opportunity_ItemStage_Transition
        @OpportunityItemID=@ItemID,@TargetStage='Awarded',@ExpectedRowVersion=@ItemRV,
        @Reason='Awarded by customer',@RequestID=@ItemRequest,@Username=@OpportunityUser;
    SELECT @ItemRV=NewRowVersion,@HeaderRV=HeaderRowVersion FROM @ItemTransition;
    SET @CloseRequest=NEWID(); DELETE FROM @Transition;
    INSERT @Transition EXEC dbo.usp_Opportunity_HeaderStage_Transition
        @OpportunityID,'Closed',@HeaderRV,'All items terminal',@CloseRequest,@OpportunityUser;
    IF NOT EXISTS(SELECT 1 FROM @Transition WHERE Status='OK' AND Stage='Closed')
        THROW 52718,'HEADER CONSISTENCY: valid close failed.',1;

    -- A user without Opportunity/Admin scope cannot perform workflow actions.
    DECLARE @DeniedRequest UNIQUEIDENTIFIER=NEWID();
    BEGIN TRY
        EXEC dbo.usp_Opportunity_HeaderStage_Transition @OpportunityID,'Canceled',@HeaderRV,'Denied',@DeniedRequest,@DeniedUser;
        THROW 52714,'WORKFLOW AUTHORIZATION: unauthorized transition was allowed.',1;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER()=52714 THROW;
    END CATCH;

    IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityStageHistory WHERE OpportunityID=@OpportunityID AND FromStage='Draft' AND ToStage='In progress' AND ChangedBy=@UserID)
        THROW 52715,'WORKFLOW HISTORY: header transition was not audited.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityItemStageHistory WHERE OpportunityItemID=@ItemID AND ToStage='Awarded' AND ChangedBy=@UserID)
        THROW 52719,'WORKFLOW HISTORY: item transition was not audited.',1;

    ROLLBACK TRANSACTION;
    PRINT 'PASS: Opportunity transaction workflow contract';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
