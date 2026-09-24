USE [test]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
-- Append-only field snapshots, retained even when an item is deleted.
-- Runtime account must not have UPDATE/DELETE permission on this table.
IF OBJECT_ID(N'dbo.OpportunityChangeLog',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.OpportunityChangeLog(
  ID BIGINT IDENTITY PRIMARY KEY,
  EventID UNIQUEIDENTIFIER NOT NULL,
  OpportunityID INT NOT NULL,
  EntityLevel VARCHAR(10) NOT NULL,
  ItemID INT NULL,
  ItemLabel NVARCHAR(300) NULL,
  Action VARCHAR(10) NOT NULL,
  FieldName VARCHAR(50) NOT NULL,
  OldValue NVARCHAR(MAX) NULL,
  NewValue NVARCHAR(MAX) NULL,
  ChangedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
  ChangedBy NVARCHAR(128) NOT NULL,
  Source VARCHAR(20) NOT NULL,
  Reason NVARCHAR(500) NULL,
  CONSTRAINT CK_OpportunityChangeLog_Level CHECK(EntityLevel IN('Header','Item')),
  CONSTRAINT CK_OpportunityChangeLog_Action CHECK(Action IN('Create','Update','Delete')),
  CONSTRAINT CK_OpportunityChangeLog_Source CHECK(Source IN('User','System','Database'))
 );
 CREATE INDEX IX_OpportunityChangeLog_Document ON dbo.OpportunityChangeLog(OpportunityID,ID DESC);
END
GO

CREATE OR ALTER TRIGGER dbo.tr_Opportunity_ChangeLog
ON dbo.Opportunity AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'OpportunityChangeEvent')),NEWID());
 DECLARE @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'OpportunityChangeUser'));
 DECLARE @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'OpportunityChangeSource'));
 -- Nested writes are automatic consequences of the initiating statement.
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System'
                  WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
 FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT @Event,COALESCE(i.ID,d.ID),'Header',
 NULL,NULL,
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),@Source,
 CONVERT(NVARCHAR(500),SESSION_CONTEXT(N'OpportunityChangeReason'))
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 LEFT JOIN dbo.Customer oc ON oc.ID=d.CustomerID
 LEFT JOIN dbo.Customer nc ON nc.ID=i.CustomerID
 CROSS APPLY(VALUES
 ('OpportunityNumber',CONVERT(NVARCHAR(MAX),d.OpportunityNumber,126),CONVERT(NVARCHAR(MAX),i.OpportunityNumber,126)),
 ('CustomerID',CASE WHEN d.CustomerID IS NOT NULL THEN CONCAT(oc.CustomerName,N' (#',d.CustomerID,N')') END,CASE WHEN i.CustomerID IS NOT NULL THEN CONCAT(nc.CustomerName,N' (#',i.CustomerID,N')') END),
 ('OpportunityDesc',CONVERT(NVARCHAR(MAX),d.OpportunityDesc,126),CONVERT(NVARCHAR(MAX),i.OpportunityDesc,126)),
 ('BidOpen',CONVERT(NVARCHAR(MAX),d.BidOpen,126),CONVERT(NVARCHAR(MAX),i.BidOpen,126)),
 ('BidClose',CONVERT(NVARCHAR(MAX),d.BidClose,126),CONVERT(NVARCHAR(MAX),i.BidClose,126)),
 ('Stage',CONVERT(NVARCHAR(MAX),d.Stage,126),CONVERT(NVARCHAR(MAX),i.Stage,126))
 )v(FieldName,OldValue,NewValue)
 WHERE d.ID IS NULL OR i.ID IS NULL
 OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END
GO

CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ChangeLog
ON dbo.OpportunityItem AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'OpportunityChangeEvent')),NEWID());
 DECLARE @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'OpportunityChangeUser'));
 DECLARE @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'OpportunityChangeSource'));
 -- Nested writes are automatic consequences of the initiating statement.
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System'
                  WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
 FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT @Event,COALESCE(i.OpportunityID,d.OpportunityID),'Item',
 COALESCE(i.ID,d.ID),COALESCE(p.ProductCode,CONVERT(NVARCHAR(30),COALESCE(i.ProductID,d.ProductID))),
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),@Source,
 CONVERT(NVARCHAR(500),SESSION_CONTEXT(N'OpportunityChangeReason'))
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 LEFT JOIN dbo.Product p ON p.ID=COALESCE(i.ProductID,d.ProductID)
 LEFT JOIN dbo.Product op ON op.ID=d.ProductID
 LEFT JOIN dbo.Product np ON np.ID=i.ProductID
 CROSS APPLY(VALUES
 ('OpportunityID',CONVERT(NVARCHAR(MAX),d.OpportunityID,126),CONVERT(NVARCHAR(MAX),i.OpportunityID,126)),
 ('ProductID',CASE WHEN d.ProductID IS NOT NULL THEN CONCAT(op.ProductCode,N' (#',d.ProductID,N')') END,CASE WHEN i.ProductID IS NOT NULL THEN CONCAT(np.ProductCode,N' (#',i.ProductID,N')') END),
 ('ItemDescription',CONVERT(NVARCHAR(MAX),d.ItemDescription,126),CONVERT(NVARCHAR(MAX),i.ItemDescription,126)),
 ('AnnualUnit',CONVERT(NVARCHAR(MAX),d.AnnualUnit,126),CONVERT(NVARCHAR(MAX),i.AnnualUnit,126)),
 ('EstPctAwarded',CONVERT(NVARCHAR(MAX),d.EstPctAwarded,126),CONVERT(NVARCHAR(MAX),i.EstPctAwarded,126)),
 ('ShelfPrice',CONVERT(NVARCHAR(MAX),d.ShelfPrice,126),CONVERT(NVARCHAR(MAX),i.ShelfPrice,126)),
 ('Stage',CONVERT(NVARCHAR(MAX),d.Stage,126),CONVERT(NVARCHAR(MAX),i.Stage,126))
 )v(FieldName,OldValue,NewValue)
 WHERE d.ID IS NULL OR i.ID IS NULL
 OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END
GO

-- Keep each current implementation behind an identity-scoped wrapper.
-- Public procedure names and grants remain intact. Re-run this migration after
-- older migrations only if the implementation has not changed; do not overwrite
-- implementations from an older release.

IF OBJECT_ID(N'dbo.usp_Opportunity_HeaderDetail_Batch_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Opportunity_HeaderDetail_Batch',N'P'));
 IF @Definition IS NULL THROW 52840,'Install Opportunity procedures and migration 12 before migration 21.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_Opportunity_HeaderDetail_Batch',@Definition),LEN(N'usp_Opportunity_HeaderDetail_Batch'),N'usp_Opportunity_HeaderDetail_Batch_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_HeaderDetail_Batch @HeaderRows dbo.OpportunityHeaderBatchType READONLY,@ItemRows dbo.OpportunityItemBatchType READONLY,@Username NVARCHAR(100),@IsAdmin BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
 THROW 52841,'Opportunity access is required for this action.',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeReason'),
 @Event UNIQUEIDENTIFIER=NEWID();
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',NULL;
 EXEC dbo.usp_Opportunity_HeaderDetail_Batch_AuditImplementation @HeaderRows,@ItemRows,@Username,@IsAdmin;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

IF OBJECT_ID(N'dbo.usp_Opportunity_HeaderStage_Transition_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Opportunity_HeaderStage_Transition',N'P'));
 IF @Definition IS NULL THROW 52840,'Install Opportunity procedures and migration 12 before migration 21.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_Opportunity_HeaderStage_Transition',@Definition),LEN(N'usp_Opportunity_HeaderStage_Transition'),N'usp_Opportunity_HeaderStage_Transition_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_HeaderStage_Transition @OpportunityID INT,@TargetStage VARCHAR(20),@ExpectedRowVersion VARBINARY(8),@Reason NVARCHAR(500),@RequestID UNIQUEIDENTIFIER,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
 THROW 52841,'Opportunity access is required for this action.',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeReason'),
 @Event UNIQUEIDENTIFIER=@RequestID;
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@Reason;
 EXEC dbo.usp_Opportunity_HeaderStage_Transition_AuditImplementation @OpportunityID,@TargetStage,@ExpectedRowVersion,@Reason,@RequestID,@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

IF OBJECT_ID(N'dbo.usp_Opportunity_ItemStage_Transition_AuditImplementation',N'P') IS NULL
BEGIN
 DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Opportunity_ItemStage_Transition',N'P'));
 IF @Definition IS NULL THROW 52840,'Install Opportunity procedures and migration 12 before migration 21.',1;
 SET @Definition=N'CREATE '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));
 SET @Definition=STUFF(@Definition,CHARINDEX(N'usp_Opportunity_ItemStage_Transition',@Definition),LEN(N'usp_Opportunity_ItemStage_Transition'),N'usp_Opportunity_ItemStage_Transition_AuditImplementation');
 EXEC sys.sp_executesql @Definition;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_ItemStage_Transition @OpportunityItemID INT,@TargetStage VARCHAR(20),@ExpectedRowVersion VARBINARY(8),@Reason NVARCHAR(500),@RequestID UNIQUEIDENTIFIER,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
 THROW 52841,'Opportunity access is required for this action.',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeReason'),
 @Event UNIQUEIDENTIFIER=@RequestID;
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@Reason;
 EXEC dbo.usp_Opportunity_ItemStage_Transition_AuditImplementation @OpportunityItemID,@TargetStage,@ExpectedRowVersion,@Reason,@RequestID,@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_OpportunityChangeLog_Read
 @Username NVARCHAR(100),@OpportunityID INT,@Page INT=1,@PageSize INT=50,
 @EntityLevel VARCHAR(10)=NULL,@Source VARCHAR(20)=NULL,@FieldName VARCHAR(50)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
 THROW 52841,'Opportunity access is required for this action.',1;
 IF @Page<1 OR @Page>1000000 OR @PageSize<1 OR @PageSize>500
 THROW 52842,'Invalid change log page.',1;
 SELECT ID,EventID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,
 ChangedAt,ChangedBy,Source,Reason
 FROM dbo.OpportunityChangeLog
 WHERE OpportunityID=@OpportunityID
 AND (@EntityLevel IS NULL OR EntityLevel=@EntityLevel)
 AND (@Source IS NULL OR Source=@Source)
 AND (@FieldName IS NULL OR FieldName=@FieldName)
 ORDER BY ID DESC OFFSET (@Page-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
 SELECT COUNT_BIG(*) Total FROM dbo.OpportunityChangeLog
 WHERE OpportunityID=@OpportunityID
 AND (@EntityLevel IS NULL OR EntityLevel=@EntityLevel)
 AND (@Source IS NULL OR Source=@Source)
 AND (@FieldName IS NULL OR FieldName=@FieldName);
END
GO
DENY UPDATE,DELETE ON OBJECT::dbo.OpportunityChangeLog TO public;
COMMIT TRANSACTION;
GO
