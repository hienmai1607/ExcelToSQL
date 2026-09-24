USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Product_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Product')
 THROW 52954,'Product access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('Category','Grade','MixRatioPct'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 IF @IsCreate=1 AND NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,'$.Category'))),'') IS NULL
 THROW 52959,'Category is required when creating a Product.',1;
 
 
 
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 Category=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Category') THEN NULLIF(LTRIM(RTRIM(j.Category)),N'') ELSE t.Category END,
 Grade=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Grade') THEN NULLIF(LTRIM(RTRIM(j.Grade)),N'') ELSE t.Grade END,
 MixRatioPct=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MixRatioPct') THEN j.MixRatioPct ELSE t.MixRatioPct END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.Product t CROSS APPLY OPENJSON(@Fields) WITH(Category NVARCHAR(100),Grade NVARCHAR(100),MixRatioPct DECIMAL(5,2)) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.Product WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Opportunity')
 THROW 52954,'Opportunity access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('CurrencyID','ExchangeRateToVND'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Opportunity WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 IF EXISTS(SELECT 1 FROM dbo.Opportunity WHERE ID=@ID AND Stage<>'Draft')
 THROW 52960,'Only Draft Opportunities can be edited.',1;
 
 
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 CurrencyID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CurrencyID') THEN j.CurrencyID ELSE t.CurrencyID END,
 ExchangeRateToVND=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateToVND') THEN j.ExchangeRateToVND ELSE t.ExchangeRateToVND END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.Opportunity t CROSS APPLY OPENJSON(@Fields) WITH(CurrencyID INT,ExchangeRateToVND DECIMAL(19,6)) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.Opportunity WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItem_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Opportunity')
 THROW 52954,'Opportunity access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest','ConfigurationRequest','PackagingType','RecyclableRequirement','RecycledContent','Transparency','MetalizedAluminum','BarrierRequirement','ShelfLifeDays','SpecialComments'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=@ID AND (i.Stage<>'Draft' OR o.Stage<>'Draft'))
 THROW 52960,'Only Draft Opportunity items can be edited.',1;
 
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 PalletSize=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletSize') THEN NULLIF(LTRIM(RTRIM(j.PalletSize)),N'') ELSE t.PalletSize END,
 PalletStacking=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletStacking') THEN NULLIF(LTRIM(RTRIM(j.PalletStacking)),N'') ELSE t.PalletStacking END,
 MaxPalletHeightM=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MaxPalletHeightM') THEN j.MaxPalletHeightM ELSE t.MaxPalletHeightM END,
 ContainerRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ContainerRequest') THEN NULLIF(LTRIM(RTRIM(j.ContainerRequest)),N'') ELSE t.ContainerRequest END,
 ConfigurationRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ConfigurationRequest') THEN NULLIF(LTRIM(RTRIM(j.ConfigurationRequest)),N'') ELSE t.ConfigurationRequest END,
 PackagingType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingType') THEN NULLIF(LTRIM(RTRIM(j.PackagingType)),N'') ELSE t.PackagingType END,
 RecyclableRequirement=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecyclableRequirement') THEN NULLIF(LTRIM(RTRIM(j.RecyclableRequirement)),N'') ELSE t.RecyclableRequirement END,
 RecycledContent=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecycledContent') THEN NULLIF(LTRIM(RTRIM(j.RecycledContent)),N'') ELSE t.RecycledContent END,
 Transparency=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Transparency') THEN NULLIF(LTRIM(RTRIM(j.Transparency)),N'') ELSE t.Transparency END,
 MetalizedAluminum=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MetalizedAluminum') THEN NULLIF(LTRIM(RTRIM(j.MetalizedAluminum)),N'') ELSE t.MetalizedAluminum END,
 BarrierRequirement=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='BarrierRequirement') THEN NULLIF(LTRIM(RTRIM(j.BarrierRequirement)),N'') ELSE t.BarrierRequirement END,
 ShelfLifeDays=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ShelfLifeDays') THEN j.ShelfLifeDays ELSE t.ShelfLifeDays END,
 SpecialComments=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SpecialComments') THEN NULLIF(LTRIM(RTRIM(j.SpecialComments)),N'') ELSE t.SpecialComments END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.OpportunityItem t CROSS APPLY OPENJSON(@Fields) WITH(PalletSize NVARCHAR(100),PalletStacking NVARCHAR(100),MaxPalletHeightM DECIMAL(9,3),ContainerRequest NVARCHAR(200),ConfigurationRequest NVARCHAR(500),PackagingType NVARCHAR(100),RecyclableRequirement NVARCHAR(200),RecycledContent NVARCHAR(200),Transparency NVARCHAR(100),MetalizedAluminum NVARCHAR(100),BarrierRequirement NVARCHAR(500),ShelfLifeDays INT,SpecialComments NVARCHAR(1000)) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Packaging')
 THROW 52954,'Packaging access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('FirstPMType','SecondPMType','UnitsPerCarton','PackagingDescription','FirstPMMOQ','SecondPMMOQ','PalletType','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 
 
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND Stage IN('Assigned','Working','Returned') AND (@Admin=1 OR PICUserID=@Actor))
 THROW 52960,'Only the assigned PIC or Admin can edit an unlocked response.',1;
 IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.Currency c ON c.ID=i.CurrencyID WHERE i.ID=@ID AND i.Cost IS NOT NULL AND c.CurrencyCode<>'VND')
 THROW 52961,'PM cost must be entered in VND. No automatic currency conversion is performed.',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 FirstPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMType') THEN NULLIF(LTRIM(RTRIM(j.FirstPMType)),N'') ELSE t.FirstPMType END,
 SecondPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMType') THEN NULLIF(LTRIM(RTRIM(j.SecondPMType)),N'') ELSE t.SecondPMType END,
 UnitsPerCarton=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerCarton') THEN j.UnitsPerCarton ELSE t.UnitsPerCarton END,
 PackagingDescription=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingDescription') THEN NULLIF(LTRIM(RTRIM(j.PackagingDescription)),N'') ELSE t.PackagingDescription END,
 FirstPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMMOQ') THEN j.FirstPMMOQ ELSE t.FirstPMMOQ END,
 SecondPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMMOQ') THEN j.SecondPMMOQ ELSE t.SecondPMMOQ END,
 PalletType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletType') THEN NULLIF(LTRIM(RTRIM(j.PalletType)),N'') ELSE t.PalletType END,
 CartonsPerLayer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerLayer') THEN j.CartonsPerLayer ELSE t.CartonsPerLayer END,
 LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='LayersPerPallet') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,
 PacksPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PacksPerPallet') THEN j.PacksPerPallet ELSE t.PacksPerPallet END,
 CartonsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerContainer') THEN j.CartonsPerContainer ELSE t.CartonsPerContainer END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.PackagingConfigurationRequestItem t CROSS APPLY OPENJSON(@Fields) WITH(FirstPMType NVARCHAR(100),SecondPMType NVARCHAR(100),UnitsPerCarton INT,PackagingDescription NVARCHAR(500),FirstPMMOQ DECIMAL(18,4),SecondPMMOQ DECIMAL(18,4),PalletType NVARCHAR(100),CartonsPerLayer INT,LayersPerPallet INT,PacksPerPallet INT,CartonsPerContainer INT) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
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
        IF EXISTS(SELECT 1 FROM @Items s JOIN dbo.OpportunityItem i ON i.ID=s.OpportunityItemID
         WHERE NULLIF(LTRIM(RTRIM(i.PackagingType)),N'') IS NULL)
         THROW 52962,'Packaging type is required for every selected item before creating a request.',1;
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
          SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND (
           NULLIF(LTRIM(RTRIM(FirstPMType)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(SecondPMType)),N'') IS NULL
           OR UnitsPerCarton IS NULL OR NULLIF(LTRIM(RTRIM(PackagingDescription)),N'') IS NULL
           OR FirstPMMOQ IS NULL OR SecondPMMOQ IS NULL))
          THROW 52963,'PM types, Unit/CTN, packaging description and both PM MOQs are required for review.',1;
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

CREATE OR ALTER PROCEDURE dbo.usp_OpportunityCurrencyLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
 THROW 52954,'Opportunity access is required for this action.',1;
 SELECT ID,CurrencyCode,CurrencyName FROM dbo.Currency ORDER BY CurrencyCode;
END;
GO
COMMIT;
GO
