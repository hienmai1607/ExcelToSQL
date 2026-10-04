USE [test];
GO
-- Run after 56. Description is optional; keep its column and legacy input contract.
-- Update only the business implementation, preserving the public audit wrapper.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.usp_PackagingRequestItem_Transition_AuditImplementation',N'P') IS NULL
 THROW 52970,'Required Packaging transition audit implementation is missing. Run SQL 24 first.',1;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Transition_AuditImplementation
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
          SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND (
           NULLIF(LTRIM(RTRIM(FirstPMType)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(SecondPMType)),N'') IS NULL
           OR UnitsPerCarton IS NULL
           OR FirstPMMOQ IS NULL OR SecondPMMOQ IS NULL))
          THROW 52963,'PM types, Unit/CTN and both PM MOQs are required for review.',1;
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
