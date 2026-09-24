USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','FirstPMType') IS NULL
 THROW 52970,'Install Packaging migrations 13-23 before migration 24.',1;
IF OBJECT_ID('dbo.PackagingRequestChangeLog','U') IS NULL
BEGIN
 CREATE TABLE dbo.PackagingRequestChangeLog(
 ID BIGINT IDENTITY PRIMARY KEY,EventID UNIQUEIDENTIFIER NOT NULL,RequestID INT NOT NULL,
 EntityLevel VARCHAR(10) NOT NULL CHECK(EntityLevel IN('Header','Item')),
 ItemID INT NULL,ItemLabel NVARCHAR(300) NULL,
 Action VARCHAR(10) NOT NULL CHECK(Action IN('Create','Update','Delete')),
 FieldName VARCHAR(50) NOT NULL,OldValue NVARCHAR(MAX) NULL,NewValue NVARCHAR(MAX) NULL,
 ChangedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),ChangedBy NVARCHAR(128) NOT NULL,
 Source VARCHAR(20) NOT NULL CHECK(Source IN('User','System','Database')),Reason NVARCHAR(1000) NULL,
 IsResponse BIT NOT NULL DEFAULT 0);
 CREATE INDEX IX_PackagingRequestChangeLog_Document ON dbo.PackagingRequestChangeLog(RequestID,ID DESC);
END
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingConfigurationRequest_ChangeLog
ON dbo.PackagingConfigurationRequest AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID()),
 @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'PackagingChangeUser')),
 @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'PackagingChangeSource'));
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System' WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason,IsResponse)
 SELECT @Event,COALESCE(i.ID,d.ID),'Header',
 NULL,NULL,
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),
 CASE WHEN v.FieldName='IsOpen' AND @Source<>'Database' THEN 'System' ELSE @Source END,
 CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason')),v.IsResponse
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 CROSS APPLY(VALUES
 ('OpportunityID',CONVERT(NVARCHAR(MAX),d.[OpportunityID],126),CONVERT(NVARCHAR(MAX),i.[OpportunityID],126),0),
 ('OpportunityNumber',CONVERT(NVARCHAR(MAX),d.[OpportunityNumber],126),CONVERT(NVARCHAR(MAX),i.[OpportunityNumber],126),0),
 ('CustomerID',CASE WHEN d.CustomerID IS NOT NULL THEN CONCAT((SELECT x.CustomerName FROM dbo.Customer x WHERE x.ID=d.CustomerID),N' (#',d.CustomerID,N')') END,CASE WHEN i.CustomerID IS NOT NULL THEN CONCAT((SELECT x.CustomerName FROM dbo.Customer x WHERE x.ID=i.CustomerID),N' (#',i.CustomerID,N')') END,0),
 ('CustomerName',CONVERT(NVARCHAR(MAX),d.[CustomerName],126),CONVERT(NVARCHAR(MAX),i.[CustomerName],126),0),
 ('OpportunityDescription',CONVERT(NVARCHAR(MAX),d.[OpportunityDescription],126),CONVERT(NVARCHAR(MAX),i.[OpportunityDescription],126),0),
 ('BidOpen',CONVERT(NVARCHAR(MAX),d.[BidOpen],126),CONVERT(NVARCHAR(MAX),i.[BidOpen],126),0),
 ('BidClose',CONVERT(NVARCHAR(MAX),d.[BidClose],126),CONVERT(NVARCHAR(MAX),i.[BidClose],126),0),
 ('RequestedBy',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.RequestedBy),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.RequestedBy),0),
 ('RequestedAt',CONVERT(NVARCHAR(MAX),d.[RequestedAt],126),CONVERT(NVARCHAR(MAX),i.[RequestedAt],126),0),
 ('ResponseDue',CONVERT(NVARCHAR(MAX),d.[ResponseDue],126),CONVERT(NVARCHAR(MAX),i.[ResponseDue],126),0),
 ('RequestNotes',CONVERT(NVARCHAR(MAX),d.[RequestNotes],126),CONVERT(NVARCHAR(MAX),i.[RequestNotes],126),0)
 )v(FieldName,OldValue,NewValue,IsResponse)
 WHERE d.ID IS NULL OR i.ID IS NULL OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingConfigurationRequestItem_ChangeLog
ON dbo.PackagingConfigurationRequestItem AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID()),
 @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'PackagingChangeUser')),
 @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'PackagingChangeSource'));
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System' WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason,IsResponse)
 SELECT @Event,COALESCE(i.RequestID,d.RequestID),'Item',
 COALESCE(i.ID,d.ID),COALESCE(i.ProductCode,d.ProductCode),
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),
 CASE WHEN v.FieldName='IsOpen' AND @Source<>'Database' THEN 'System' ELSE @Source END,
 CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason')),v.IsResponse
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 CROSS APPLY(VALUES
 ('OpportunityItemID',CONVERT(NVARCHAR(MAX),d.[OpportunityItemID],126),CONVERT(NVARCHAR(MAX),i.[OpportunityItemID],126),0),
 ('ProductID',CASE WHEN d.ProductID IS NOT NULL THEN CONCAT((SELECT x.ProductCode FROM dbo.Product x WHERE x.ID=d.ProductID),N' (#',d.ProductID,N')') END,CASE WHEN i.ProductID IS NOT NULL THEN CONCAT((SELECT x.ProductCode FROM dbo.Product x WHERE x.ID=i.ProductID),N' (#',i.ProductID,N')') END,0),
 ('ProductCode',CONVERT(NVARCHAR(MAX),d.[ProductCode],126),CONVERT(NVARCHAR(MAX),i.[ProductCode],126),0),
 ('ProductName',CONVERT(NVARCHAR(MAX),d.[ProductName],126),CONVERT(NVARCHAR(MAX),i.[ProductName],126),0),
 ('ItemDescription',CONVERT(NVARCHAR(MAX),d.[ItemDescription],126),CONVERT(NVARCHAR(MAX),i.[ItemDescription],126),0),
 ('AnnualUnit',CONVERT(NVARCHAR(MAX),d.[AnnualUnit],126),CONVERT(NVARCHAR(MAX),i.[AnnualUnit],126),0),
 ('PackagingRequirement',CONVERT(NVARCHAR(MAX),d.[PackagingRequirement],126),CONVERT(NVARCHAR(MAX),i.[PackagingRequirement],126),0),
 ('PICUserID',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.PICUserID),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.PICUserID),0),
 ('Stage',CONVERT(NVARCHAR(MAX),d.[Stage],126),CONVERT(NVARCHAR(MAX),i.[Stage],126),0),
 ('IsOpen',CONVERT(NVARCHAR(MAX),d.[IsOpen],126),CONVERT(NVARCHAR(MAX),i.[IsOpen],126),0),
 ('MaterialID',CASE WHEN d.MaterialID IS NOT NULL THEN CONCAT((SELECT x.MaterialCode FROM dbo.PackagingMaterial x WHERE x.ID=d.MaterialID),N' (#',d.MaterialID,N')') END,CASE WHEN i.MaterialID IS NOT NULL THEN CONCAT((SELECT x.MaterialCode FROM dbo.PackagingMaterial x WHERE x.ID=i.MaterialID),N' (#',i.MaterialID,N')') END,1),
 ('HeightMM',CONVERT(NVARCHAR(MAX),d.[HeightMM],126),CONVERT(NVARCHAR(MAX),i.[HeightMM],126),1),
 ('WidthMM',CONVERT(NVARCHAR(MAX),d.[WidthMM],126),CONVERT(NVARCHAR(MAX),i.[WidthMM],126),1),
 ('LengthMM',CONVERT(NVARCHAR(MAX),d.[LengthMM],126),CONVERT(NVARCHAR(MAX),i.[LengthMM],126),1),
 ('Cost',CONVERT(NVARCHAR(MAX),d.[Cost],126),CONVERT(NVARCHAR(MAX),i.[Cost],126),1),
 ('CurrencyID',CASE WHEN d.CurrencyID IS NOT NULL THEN CONCAT((SELECT x.CurrencyCode FROM dbo.Currency x WHERE x.ID=d.CurrencyID),N' (#',d.CurrencyID,N')') END,CASE WHEN i.CurrencyID IS NOT NULL THEN CONCAT((SELECT x.CurrencyCode FROM dbo.Currency x WHERE x.ID=i.CurrencyID),N' (#',i.CurrencyID,N')') END,1),
 ('CostBasis',CONVERT(NVARCHAR(MAX),d.[CostBasis],126),CONVERT(NVARCHAR(MAX),i.[CostBasis],126),1),
 ('ResponseNotes',CONVERT(NVARCHAR(MAX),d.[ResponseNotes],126),CONVERT(NVARCHAR(MAX),i.[ResponseNotes],126),1),
 ('SubmittedAt',CONVERT(NVARCHAR(MAX),d.[SubmittedAt],126),CONVERT(NVARCHAR(MAX),i.[SubmittedAt],126),1),
 ('SubmittedBy',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.SubmittedBy),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.SubmittedBy),1),
 ('ReviewedAt',CONVERT(NVARCHAR(MAX),d.[ReviewedAt],126),CONVERT(NVARCHAR(MAX),i.[ReviewedAt],126),1),
 ('ReviewedBy',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.ReviewedBy),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.ReviewedBy),1),
 ('ManagerComment',CONVERT(NVARCHAR(MAX),d.[ManagerComment],126),CONVERT(NVARCHAR(MAX),i.[ManagerComment],126),1),
 ('FirstPMType',CONVERT(NVARCHAR(MAX),d.[FirstPMType],126),CONVERT(NVARCHAR(MAX),i.[FirstPMType],126),1),
 ('SecondPMType',CONVERT(NVARCHAR(MAX),d.[SecondPMType],126),CONVERT(NVARCHAR(MAX),i.[SecondPMType],126),1),
 ('UnitsPerCarton',CONVERT(NVARCHAR(MAX),d.[UnitsPerCarton],126),CONVERT(NVARCHAR(MAX),i.[UnitsPerCarton],126),1),
 ('PackagingDescription',CONVERT(NVARCHAR(MAX),d.[PackagingDescription],126),CONVERT(NVARCHAR(MAX),i.[PackagingDescription],126),1),
 ('FirstPMMOQ',CONVERT(NVARCHAR(MAX),d.[FirstPMMOQ],126),CONVERT(NVARCHAR(MAX),i.[FirstPMMOQ],126),1),
 ('SecondPMMOQ',CONVERT(NVARCHAR(MAX),d.[SecondPMMOQ],126),CONVERT(NVARCHAR(MAX),i.[SecondPMMOQ],126),1),
 ('PalletType',CONVERT(NVARCHAR(MAX),d.[PalletType],126),CONVERT(NVARCHAR(MAX),i.[PalletType],126),1),
 ('CartonsPerLayer',CONVERT(NVARCHAR(MAX),d.[CartonsPerLayer],126),CONVERT(NVARCHAR(MAX),i.[CartonsPerLayer],126),1),
 ('LayersPerPallet',CONVERT(NVARCHAR(MAX),d.[LayersPerPallet],126),CONVERT(NVARCHAR(MAX),i.[LayersPerPallet],126),1),
 ('PacksPerPallet',CONVERT(NVARCHAR(MAX),d.[PacksPerPallet],126),CONVERT(NVARCHAR(MAX),i.[PacksPerPallet],126),1),
 ('CartonsPerContainer',CONVERT(NVARCHAR(MAX),d.[CartonsPerContainer],126),CONVERT(NVARCHAR(MAX),i.[CartonsPerContainer],126),1)
 )v(FieldName,OldValue,NewValue,IsResponse)
 WHERE d.ID IS NULL OR i.ID IS NULL OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);

 -- Header status is derived, not stored. Reconstruct the before-state from the statement delta.
 ;WITH Affected AS(SELECT RequestID FROM inserted UNION SELECT RequestID FROM deleted),
 Counts AS(
 SELECT h.ID,
 (SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem x WHERE x.RequestID=h.ID AND x.IsOpen=1) OpenNow,
 (SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem x WHERE x.RequestID=h.ID AND x.Stage='Approved') ApprovedNow,
 (SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem x WHERE x.RequestID=h.ID) TotalNow,
 (SELECT COUNT(*) FROM inserted x WHERE x.RequestID=h.ID AND x.IsOpen=1) OpenAdded,
 (SELECT COUNT(*) FROM deleted x WHERE x.RequestID=h.ID AND x.IsOpen=1) OpenRemoved,
 (SELECT COUNT(*) FROM inserted x WHERE x.RequestID=h.ID AND x.Stage='Approved') ApprovedAdded,
 (SELECT COUNT(*) FROM deleted x WHERE x.RequestID=h.ID AND x.Stage='Approved') ApprovedRemoved,
 (SELECT COUNT(*) FROM inserted x WHERE x.RequestID=h.ID) Added,
 (SELECT COUNT(*) FROM deleted x WHERE x.RequestID=h.ID) Removed
 FROM dbo.PackagingConfigurationRequest h WITH(UPDLOCK,HOLDLOCK) JOIN Affected a ON a.RequestID=h.ID),
 Statuses AS(SELECT ID,
 CASE WHEN TotalNow-Added+Removed=0 THEN NULL WHEN OpenNow-OpenAdded+OpenRemoved>0 THEN 'Open'
 WHEN ApprovedNow-ApprovedAdded+ApprovedRemoved>0 THEN 'Completed' ELSE 'Canceled' END OldStatus,
 CASE WHEN OpenNow>0 THEN 'Open' WHEN ApprovedNow>0 THEN 'Completed' ELSE 'Canceled' END NewStatus FROM Counts)
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT @Event,ID,'Header',CASE WHEN OldStatus IS NULL THEN 'Create' ELSE 'Update' END,'RequestStatus',OldStatus,NewStatus,
 COALESCE(@Actor,ORIGINAL_LOGIN()),'System',CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason'))
 FROM Statuses WHERE OldStatus IS NULL OR OldStatus<>NewStatus;
END
GO

-- Preserve installed business logic; public names/grants stay unchanged.
-- Deploy after 23. Never reapply older procedure scripts over these wrappers.
IF OBJECT_ID(N'dbo.usp_PackagingRequest_Create_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_PackagingRequest_Create',N'P'));
 IF @Definition IS NULL THROW 52970,'Required Packaging procedure is missing.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_PackagingRequest_Create',@Definition),LEN(N'usp_PackagingRequest_Create'),N'usp_PackagingRequest_Create_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_Create
 @Username NVARCHAR(100), @OpportunityID INT, @ExpectedRowVersion VARBINARY(8),
    @CreationKey UNIQUEIDENTIFIER, @ResponseDue DATE,
    @Items dbo.PackagingRequestSelectionType READONLY, @RequestNotes NVARCHAR(1000)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID());
 BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'User';
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',NULL;
 EXEC dbo.usp_PackagingRequest_Create_AuditImplementation @Username,@OpportunityID,@ExpectedRowVersion,@CreationKey,@ResponseDue,@Items,@RequestNotes;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

-- Preserve installed business logic; public names/grants stay unchanged.
-- Deploy after 23. Never reapply older procedure scripts over these wrappers.
IF OBJECT_ID(N'dbo.usp_PackagingRequestItem_Assign_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_PackagingRequestItem_Assign',N'P'));
 IF @Definition IS NULL THROW 52970,'Required Packaging procedure is missing.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_PackagingRequestItem_Assign',@Definition),LEN(N'usp_PackagingRequestItem_Assign'),N'usp_PackagingRequestItem_Assign_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Assign
 @Username NVARCHAR(100), @ID INT, @PICUserID INT, @ExpectedRowVersion VARBINARY(8)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID());
 BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'User';
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',NULL;
 EXEC dbo.usp_PackagingRequestItem_Assign_AuditImplementation @Username,@ID,@PICUserID,@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

-- Preserve installed business logic; public names/grants stay unchanged.
-- Deploy after 23. Never reapply older procedure scripts over these wrappers.
IF OBJECT_ID(N'dbo.usp_PackagingResponse_Batch_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_PackagingResponse_Batch',N'P'));
 IF @Definition IS NULL THROW 52970,'Required Packaging procedure is missing.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_PackagingResponse_Batch',@Definition),LEN(N'usp_PackagingResponse_Batch'),N'usp_PackagingResponse_Batch_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingResponse_Batch
 @Rows dbo.PackagingResponseBatchType READONLY, @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID());
 BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'User';
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',NULL;
 EXEC dbo.usp_PackagingResponse_Batch_AuditImplementation @Rows,@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

-- Preserve installed business logic; public names/grants stay unchanged.
-- Deploy after 23. Never reapply older procedure scripts over these wrappers.
IF OBJECT_ID(N'dbo.usp_PackagingRequestItem_Transition_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_PackagingRequestItem_Transition',N'P'));
 IF @Definition IS NULL THROW 52970,'Required Packaging procedure is missing.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_PackagingRequestItem_Transition',@Definition),LEN(N'usp_PackagingRequestItem_Transition'),N'usp_PackagingRequestItem_Transition_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Transition
 @Username NVARCHAR(100), @ID INT, @ExpectedRowVersion VARBINARY(8),
    @TargetStage VARCHAR(20), @Comment NVARCHAR(1000)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID());
 BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'User';
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@Comment;
 EXEC dbo.usp_PackagingRequestItem_Transition_AuditImplementation @Username,@ID,@ExpectedRowVersion,@TargetStage,@Comment;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

-- Preserve installed business logic; public names/grants stay unchanged.
-- Deploy after 23. Never reapply older procedure scripts over these wrappers.
IF OBJECT_ID(N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save',N'P'));
 IF @Definition IS NULL THROW 52970,'Required Packaging procedure is missing.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_PackagingConfigurationRequestItem_Fields_Save',@Definition),LEN(N'usp_PackagingConfigurationRequestItem_Fields_Save'),N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID());
 BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'User';
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',NULL;
 EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation @Username,@ID,@ExpectedRowVersion,@Fields,@IsCreate;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestChangeLog_Read
 @Username NVARCHAR(100),@RequestID INT,@Page INT=1,@PageSize INT=50,
 @EntityLevel VARCHAR(10)=NULL,@Source VARCHAR(20)=NULL,@FieldName VARCHAR(50)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT,@CanReadResponse BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'Read',@Actor OUTPUT;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Admin','Packaging','PackagingManager'))
 SET @CanReadResponse=1;
 IF @Page<1 OR @Page>1000000 OR @PageSize<1 OR @PageSize>500
 THROW 52971,'Invalid change log page.',1;
 -- Historical response edits may include unpublished drafts, even after approval.
 -- Sales can read shared request/assignment/stage history, never draft response history.
 SELECT ID,EventID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedAt,ChangedBy,Source,
 CASE WHEN @CanReadResponse=1 THEN Reason END Reason
 FROM dbo.PackagingRequestChangeLog
 WHERE RequestID=@RequestID AND (@CanReadResponse=1 OR IsResponse=0)
 AND (@EntityLevel IS NULL OR EntityLevel=@EntityLevel)
 AND (@Source IS NULL OR Source=@Source) AND (@FieldName IS NULL OR FieldName=@FieldName)
 ORDER BY ID DESC OFFSET (@Page-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
 SELECT COUNT_BIG(*) Total FROM dbo.PackagingRequestChangeLog
 WHERE RequestID=@RequestID AND (@CanReadResponse=1 OR IsResponse=0)
 AND (@EntityLevel IS NULL OR EntityLevel=@EntityLevel)
 AND (@Source IS NULL OR Source=@Source) AND (@FieldName IS NULL OR FieldName=@FieldName);
END
GO
DENY UPDATE,DELETE ON OBJECT::dbo.PackagingRequestChangeLog TO public;
COMMIT TRANSACTION;
GO
