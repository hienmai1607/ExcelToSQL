USE [test]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/* Shared workflow policy. Entity tables remain strongly typed; this table
   only defines which application-requested stage transitions are legal. */
IF OBJECT_ID(N'dbo.TransactionStageTransition',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TransactionStageTransition(
        TransactionType VARCHAR(50) NOT NULL,
        EntityLevel VARCHAR(10) NOT NULL,
        FromStage VARCHAR(20) NOT NULL,
        ToStage VARCHAR(20) NOT NULL,
        RequiredScope NVARCHAR(50) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_TransactionStageTransition_IsActive DEFAULT(1),
        CONSTRAINT PK_TransactionStageTransition PRIMARY KEY(TransactionType,EntityLevel,FromStage,ToStage),
        CONSTRAINT CK_TransactionStageTransition_Level CHECK(EntityLevel IN('Header','Item'))
    );
END
GO

MERGE dbo.TransactionStageTransition AS target
USING (VALUES
    ('Opportunity','Header','Draft','In progress','Opportunity'),
    ('Opportunity','Header','Draft','Canceled','Opportunity'),
    ('Opportunity','Header','In progress','Draft','Opportunity'),
    ('Opportunity','Header','In progress','Closed','Opportunity'),
    ('Opportunity','Header','In progress','Canceled','Opportunity'),
    ('Opportunity','Item','Draft','Revising','Opportunity'),
    ('Opportunity','Item','Draft','In progress','Opportunity'),
    ('Opportunity','Item','Draft','Canceled','Opportunity'),
    ('Opportunity','Item','Revising','Draft','Opportunity'),
    ('Opportunity','Item','Revising','In progress','Opportunity'),
    ('Opportunity','Item','Revising','Proposed','Opportunity'),
    ('Opportunity','Item','Revising','Canceled','Opportunity'),
    ('Opportunity','Item','In progress','Revising','Opportunity'),
    ('Opportunity','Item','In progress','Proposed','Opportunity'),
    ('Opportunity','Item','In progress','Canceled','Opportunity'),
    ('Opportunity','Item','Proposed','Revising','Opportunity'),
    ('Opportunity','Item','Proposed','Awarded','Opportunity'),
    ('Opportunity','Item','Proposed','Lost','Opportunity'),
    ('Opportunity','Item','Proposed','Canceled','Opportunity')
) AS source(TransactionType,EntityLevel,FromStage,ToStage,RequiredScope)
ON target.TransactionType=source.TransactionType AND target.EntityLevel=source.EntityLevel
AND target.FromStage=source.FromStage AND target.ToStage=source.ToStage
WHEN MATCHED THEN UPDATE SET RequiredScope=source.RequiredScope,IsActive=1
WHEN NOT MATCHED THEN INSERT(TransactionType,EntityLevel,FromStage,ToStage,RequiredScope)
VALUES(source.TransactionType,source.EntityLevel,source.FromStage,source.ToStage,source.RequiredScope);
GO

IF OBJECT_ID(N'dbo.OpportunityStageHistory',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OpportunityStageHistory(
        ID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OpportunityStageHistory PRIMARY KEY,
        OpportunityID INT NOT NULL,
        FromStage VARCHAR(20) NOT NULL,
        ToStage VARCHAR(20) NOT NULL,
        Reason NVARCHAR(500) NULL,
        ChangedAt DATETIME2(7) NOT NULL CONSTRAINT DF_OpportunityStageHistory_ChangedAt DEFAULT(SYSUTCDATETIME()),
        ChangedBy INT NOT NULL,
        RequestID UNIQUEIDENTIFIER NOT NULL,
        AppliedRowVersion VARBINARY(8) NOT NULL,
        CONSTRAINT FK_OpportunityStageHistory_Opportunity FOREIGN KEY(OpportunityID) REFERENCES dbo.Opportunity(ID),
        CONSTRAINT FK_OpportunityStageHistory_User FOREIGN KEY(ChangedBy) REFERENCES dbo.Users(ID),
        CONSTRAINT UQ_OpportunityStageHistory_Request UNIQUE(RequestID)
    );
    CREATE INDEX IX_OpportunityStageHistory_Opportunity_ChangedAt
        ON dbo.OpportunityStageHistory(OpportunityID,ChangedAt DESC);
END
GO

IF OBJECT_ID(N'dbo.OpportunityItemStageHistory',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OpportunityItemStageHistory(
        ID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OpportunityItemStageHistory PRIMARY KEY,
        OpportunityItemID INT NOT NULL,
        OpportunityID INT NOT NULL,
        FromStage VARCHAR(20) NOT NULL,
        ToStage VARCHAR(20) NOT NULL,
        Reason NVARCHAR(500) NULL,
        ChangedAt DATETIME2(7) NOT NULL CONSTRAINT DF_OpportunityItemStageHistory_ChangedAt DEFAULT(SYSUTCDATETIME()),
        ChangedBy INT NOT NULL,
        RequestID UNIQUEIDENTIFIER NOT NULL,
        AppliedRowVersion VARBINARY(8) NOT NULL,
        AppliedHeaderRowVersion VARBINARY(8) NULL,
        CONSTRAINT FK_OpportunityItemStageHistory_Item FOREIGN KEY(OpportunityItemID) REFERENCES dbo.OpportunityItem(ID),
        CONSTRAINT FK_OpportunityItemStageHistory_Opportunity FOREIGN KEY(OpportunityID) REFERENCES dbo.Opportunity(ID),
        CONSTRAINT FK_OpportunityItemStageHistory_User FOREIGN KEY(ChangedBy) REFERENCES dbo.Users(ID),
        CONSTRAINT UQ_OpportunityItemStageHistory_Request UNIQUE(RequestID)
    );
    CREATE INDEX IX_OpportunityItemStageHistory_Item_ChangedAt
        ON dbo.OpportunityItemStageHistory(OpportunityItemID,ChangedAt DESC);
END
GO

IF COL_LENGTH(N'dbo.OpportunityItemStageHistory',N'AppliedHeaderRowVersion') IS NULL
    ALTER TABLE dbo.OpportunityItemStageHistory ADD AppliedHeaderRowVersion VARBINARY(8) NULL;
GO

/* Preserve the original typed header/detail implementation behind a guarded
   draft-only interface. The rename happens once and is idempotent. */
IF OBJECT_ID(N'dbo.usp_Opportunity_HeaderDetail_Batch_Legacy',N'P') IS NULL
   AND OBJECT_ID(N'dbo.usp_Opportunity_HeaderDetail_Batch',N'P') IS NOT NULL
    EXEC sys.sp_rename N'dbo.usp_Opportunity_HeaderDetail_Batch',N'usp_Opportunity_HeaderDetail_Batch_Legacy';
GO

CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_HeaderDetail_Batch
    @HeaderRows dbo.OpportunityHeaderBatchType READONLY,
    @ItemRows dbo.OpportunityItemBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin BIT=0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Authorized BIT=0;
    IF EXISTS(
        SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess ua ON ua.UserID=u.ID
        WHERE u.UserName=@Username AND u.IsActive=1 AND ua.Scope IN(N'Admin',N'Opportunity')
    ) SET @Authorized=1;

    IF @Authorized=0
    BEGIN
        SELECT RowNum,'ERROR' Status,'Opportunity access is required for this action.' Message,
               CAST(NULL AS INT) NewID,CAST(NULL AS VARCHAR(20)) OpportunityNumber,CAST(NULL AS VARBINARY(8)) NewRowVersion
        FROM @HeaderRows ORDER BY RowNum;
        SELECT RowNum,'ERROR' Status,'Opportunity access is required for this action.' Message,
               CAST(NULL AS INT) NewID,CAST(NULL AS VARBINARY(8)) NewRowVersion
        FROM @ItemRows ORDER BY RowNum;
        RETURN;
    END

    DECLARE @ValidationMessage VARCHAR(500);
    IF EXISTS(SELECT 1 FROM @HeaderRows r LEFT JOIN dbo.Customer c ON c.ID=r.CustomerID AND c.Status='Active'
              WHERE r.Command IN('C','U') AND c.ID IS NULL)
        SET @ValidationMessage='Active Customer is required; refresh Customer lookup.';
    ELSE IF EXISTS(SELECT 1 FROM @ItemRows r LEFT JOIN dbo.Product p ON p.ID=r.ProductID AND p.Status='Active'
                   WHERE r.Command IN('C','U') AND p.ID IS NULL)
        SET @ValidationMessage='Active Product is required; refresh Product lookup.';
    ELSE IF EXISTS(SELECT 1 FROM @HeaderRows r JOIN dbo.Opportunity o ON o.ID=r.ID
                   WHERE r.Command IN('U','D') AND o.Stage<>'Draft')
        SET @ValidationMessage='Excel can modify only Draft opportunity headers; use the workflow application.';
    ELSE IF EXISTS(SELECT 1 FROM @ItemRows r JOIN dbo.OpportunityItem oi ON oi.ID=r.ID
                   JOIN dbo.Opportunity o ON o.ID=oi.OpportunityID
                   WHERE r.Command IN('U','D') AND (o.Stage<>'Draft' OR oi.Stage<>'Draft'))
        SET @ValidationMessage='Excel can modify only Draft opportunity items; use the workflow application.';
    ELSE IF EXISTS(SELECT 1 FROM @ItemRows r JOIN dbo.Opportunity o ON o.OpportunityNumber=r.OpportunityNumber
                   WHERE r.Command='C' AND o.Stage<>'Draft')
        SET @ValidationMessage='Excel can add items only to Draft opportunities.';

    IF @ValidationMessage IS NOT NULL
    BEGIN
        SELECT RowNum,'ERROR' Status,@ValidationMessage Message,
               CAST(NULL AS INT) NewID,CAST(NULL AS VARCHAR(20)) OpportunityNumber,CAST(NULL AS VARBINARY(8)) NewRowVersion
        FROM @HeaderRows ORDER BY RowNum;
        SELECT RowNum,'ERROR' Status,@ValidationMessage Message,
               CAST(NULL AS INT) NewID,CAST(NULL AS VARBINARY(8)) NewRowVersion
        FROM @ItemRows ORDER BY RowNum;
        RETURN;
    END

    DECLARE @SafeHeaders dbo.OpportunityHeaderBatchType;
    DECLARE @SafeItems dbo.OpportunityItemBatchType;
    INSERT @SafeHeaders(RowNum,Command,ID,OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,RowVersionB64)
    SELECT RowNum,Command,ID,OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,'Draft',RowVersionB64 FROM @HeaderRows;
    INSERT @SafeItems(RowNum,Command,ID,OpportunityNumber,ProductID,ItemDescription,AnnualUnit,EstPctAwarded,ShelfPrice,Stage,RowVersionB64)
    SELECT RowNum,Command,ID,OpportunityNumber,ProductID,ItemDescription,AnnualUnit,EstPctAwarded,ShelfPrice,'Draft',RowVersionB64 FROM @ItemRows;

    EXEC dbo.usp_Opportunity_HeaderDetail_Batch_Legacy @SafeHeaders,@SafeItems,@Username,1;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_HeaderStage_Transition
    @OpportunityID INT,
    @TargetStage VARCHAR(20),
    @ExpectedRowVersion VARBINARY(8),
    @Reason NVARCHAR(500),
    @RequestID UNIQUEIDENTIFIER,
    @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @UserID INT,@FromStage VARCHAR(20),@NewRV VARBINARY(8);
    DECLARE @OwnTransaction BIT=0;
    SELECT @UserID=u.ID FROM dbo.Users u JOIN dbo.UserAccess ua ON ua.UserID=u.ID
    WHERE u.UserName=@Username AND u.IsActive=1 AND ua.Scope IN(N'Admin',N'Opportunity');
    IF @UserID IS NULL THROW 52720,'Opportunity access is required for this action.',1;

    IF EXISTS(SELECT 1 FROM dbo.OpportunityStageHistory WHERE RequestID=@RequestID)
    BEGIN
        SELECT 'OK' Status,'Already applied' Message,OpportunityID ID,ToStage Stage,AppliedRowVersion NewRowVersion
        FROM dbo.OpportunityStageHistory WHERE RequestID=@RequestID;
        RETURN;
    END

    IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTransaction=1; END
    ELSE SAVE TRANSACTION OpportunityHeaderStageSave;
    BEGIN TRY
        SELECT @FromStage=Stage FROM dbo.Opportunity WITH(UPDLOCK,HOLDLOCK)
        WHERE ID=@OpportunityID AND RowVersion=@ExpectedRowVersion;
        IF @FromStage IS NULL BEGIN THROW 52721,'Concurrency conflict or opportunity not found.',1; END
        IF NOT EXISTS(SELECT 1 FROM dbo.TransactionStageTransition
                      WHERE TransactionType='Opportunity' AND EntityLevel='Header'
                      AND FromStage=@FromStage AND ToStage=@TargetStage AND IsActive=1)
        BEGIN
            THROW 52722,'Invalid opportunity header stage transition.',1;
        END
        IF @TargetStage IN('Closed','Canceled') AND
           (NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE OpportunityID=@OpportunityID)
            OR EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE OpportunityID=@OpportunityID AND Stage NOT IN('Awarded','Lost','Canceled')))
        BEGIN
            THROW 52723,'All items must be terminal before closing or canceling the opportunity.',1;
        END

        UPDATE dbo.Opportunity SET Stage=@TargetStage,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@UserID WHERE ID=@OpportunityID;
        SELECT @NewRV=RowVersion FROM dbo.Opportunity WHERE ID=@OpportunityID;
        INSERT dbo.OpportunityStageHistory(OpportunityID,FromStage,ToStage,Reason,ChangedBy,RequestID,AppliedRowVersion)
        VALUES(@OpportunityID,@FromStage,@TargetStage,NULLIF(LTRIM(RTRIM(@Reason)),''),@UserID,@RequestID,@NewRV);
        IF @OwnTransaction=1 COMMIT;
        SELECT 'OK' Status,'Stage updated' Message,@OpportunityID ID,@TargetStage Stage,@NewRV NewRowVersion;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0
        BEGIN
            IF @OwnTransaction=1 ROLLBACK TRANSACTION;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION OpportunityHeaderStageSave;
        END
        ;THROW;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_ItemStage_Transition
    @OpportunityItemID INT,
    @TargetStage VARCHAR(20),
    @ExpectedRowVersion VARBINARY(8),
    @Reason NVARCHAR(500),
    @RequestID UNIQUEIDENTIFIER,
    @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @UserID INT,@OpportunityID INT,@FromStage VARCHAR(20),@HeaderStage VARCHAR(20),@NewRV VARBINARY(8),@HeaderRV VARBINARY(8);
    DECLARE @OwnTransaction BIT=0;
    SELECT @UserID=u.ID FROM dbo.Users u JOIN dbo.UserAccess ua ON ua.UserID=u.ID
    WHERE u.UserName=@Username AND u.IsActive=1 AND ua.Scope IN(N'Admin',N'Opportunity');
    IF @UserID IS NULL THROW 52730,'Opportunity access is required for this action.',1;

    IF EXISTS(SELECT 1 FROM dbo.OpportunityItemStageHistory WHERE RequestID=@RequestID)
    BEGIN
        SELECT 'OK' Status,'Already applied' Message,OpportunityItemID ID,ToStage Stage,
               AppliedRowVersion NewRowVersion,AppliedHeaderRowVersion HeaderRowVersion
        FROM dbo.OpportunityItemStageHistory WHERE RequestID=@RequestID;
        RETURN;
    END

    IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTransaction=1; END
    ELSE SAVE TRANSACTION OpportunityItemStageSave;
    BEGIN TRY
        SELECT @OpportunityID=oi.OpportunityID,@FromStage=oi.Stage,@HeaderStage=o.Stage
        FROM dbo.OpportunityItem oi WITH(UPDLOCK,HOLDLOCK)
        JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=oi.OpportunityID
        WHERE oi.ID=@OpportunityItemID AND oi.RowVersion=@ExpectedRowVersion;
        IF @OpportunityID IS NULL BEGIN THROW 52731,'Concurrency conflict or opportunity item not found.',1; END
        IF @HeaderStage IN('Closed','Canceled') BEGIN THROW 52732,'Items cannot transition after the opportunity is terminal.',1; END
        IF NOT EXISTS(SELECT 1 FROM dbo.TransactionStageTransition
                      WHERE TransactionType='Opportunity' AND EntityLevel='Item'
                      AND FromStage=@FromStage AND ToStage=@TargetStage AND IsActive=1)
        BEGIN
            THROW 52733,'Invalid opportunity item stage transition.',1;
        END

        UPDATE dbo.OpportunityItem SET Stage=@TargetStage,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@UserID WHERE ID=@OpportunityItemID;
        SELECT @NewRV=RowVersion FROM dbo.OpportunityItem WHERE ID=@OpportunityItemID;
        UPDATE dbo.Opportunity SET UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@UserID WHERE ID=@OpportunityID;
        SELECT @HeaderRV=RowVersion FROM dbo.Opportunity WHERE ID=@OpportunityID;
        INSERT dbo.OpportunityItemStageHistory(OpportunityItemID,OpportunityID,FromStage,ToStage,Reason,ChangedBy,RequestID,AppliedRowVersion,AppliedHeaderRowVersion)
        VALUES(@OpportunityItemID,@OpportunityID,@FromStage,@TargetStage,NULLIF(LTRIM(RTRIM(@Reason)),''),@UserID,@RequestID,@NewRV,@HeaderRV);
        IF @OwnTransaction=1 COMMIT;
        SELECT 'OK' Status,'Stage updated' Message,@OpportunityItemID ID,@TargetStage Stage,@NewRV NewRowVersion,@HeaderRV HeaderRowVersion;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0
        BEGIN
            IF @OwnTransaction=1 ROLLBACK TRANSACTION;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION OpportunityItemStageSave;
        END
        ;THROW;
    END CATCH
END
GO
