USE [test]
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @UserID INT,@Username NVARCHAR(100),@Customer INT,@Product INT,@Opp INT,@Item INT,
 @Before BIGINT=(SELECT COUNT_BIG(*) FROM dbo.OpportunityChangeLog),@Rows BIGINT,
 @Token UNIQUEIDENTIFIER=NEWID(),@RV VARBINARY(8),@Request UNIQUEIDENTIFIER=NEWID();
SELECT TOP(1) @UserID=u.ID,@Username=u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID;
SELECT TOP(1) @Customer=ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID;
SELECT TOP(1) @Product=ID FROM dbo.Product WHERE Status='Active' ORDER BY ID;
IF @UserID IS NULL OR @Customer IS NULL OR @Product IS NULL THROW 52900,'Test requires an Admin, active Customer and Product.',1;
BEGIN TRAN;
BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',@Token;
 DECLARE @Number VARCHAR(20)='AUD-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16);
 INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
 VALUES(@Number,@Customer,'Audit test','2026-09-01','2026-10-01','Draft',@UserID);
 SET @Opp=SCOPE_IDENTITY();
 INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,EstPctAwarded,ShelfPrice,Stage,CreatedBy)
 VALUES(@Opp,@Product,'Audit item',100,NULL,NULL,'Draft',@UserID);
 SET @Item=SCOPE_IDENTITY();
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp AND Action='Create' AND EntityLevel='Header' AND ChangedBy=@Username)
 THROW 52901,'Create actor was not recorded.',1;
 SELECT @Rows=COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp;
 UPDATE dbo.Opportunity SET UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@UserID,OpportunityDesc=OpportunityDesc WHERE ID=@Opp;
 IF (SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp)<>@Rows THROW 52902,'No-op update generated changes.',1;
 UPDATE dbo.OpportunityItem SET ShelfPrice=0 WHERE ID=@Item;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE ItemID=@Item AND FieldName='ShelfPrice' AND OldValue IS NULL AND NewValue='0.00')
 THROW 52903,'NULL-to-zero change missing.',1;
 UPDATE dbo.OpportunityItem SET ShelfPrice=NULL WHERE ID=@Item;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE ItemID=@Item AND FieldName='ShelfPrice' AND OldValue='0.00' AND NewValue IS NULL)
 THROW 52904,'Zero-to-NULL change missing.',1;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'System';
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',N'Automatic workflow rule';
 UPDATE dbo.Opportunity SET Stage='In progress' WHERE ID=@Opp;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp AND FieldName='Stage' AND Source='System' AND OldValue='Draft' AND NewValue='In progress')
 THROW 52905,'Automatic stage not recorded.',1;
 -- Real transition procedure: reason, initiating user and idempotency.
 SELECT @RV=RowVersion FROM dbo.Opportunity WHERE ID=@Opp;
 EXEC dbo.usp_Opportunity_HeaderStage_Transition @Opp,'Draft',@RV,N'Back to editing',@Request,@Username;
 SELECT @Rows=COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp;
 EXEC dbo.usp_Opportunity_HeaderStage_Transition @Opp,'Draft',@RV,N'Back to editing',@Request,@Username;
 IF (SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp)<>@Rows THROW 52906,'Replay duplicated history.',1;
 IF CONVERT(VARCHAR(20),SESSION_CONTEXT(N'OpportunityChangeSource'))<>'System' THROW 52907,'Context was not restored.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE EventID=@Request AND Source='User' AND Reason='Back to editing' AND ChangedBy=@Username)
 THROW 52908,'User stage metadata missing.',1;
 -- Exercise the public batch (Excel and web entry) with real TVPs.
 DECLARE @H dbo.OpportunityHeaderBatchType,@I dbo.OpportunityItemBatchType;
 INSERT @H(RowNum,Command,ID,OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,RowVersionB64)
 SELECT 1,'U',ID,OpportunityNumber,CustomerID,'Edited via batch',BidOpen,BidClose,Stage,RowVersion FROM dbo.Opportunity WHERE ID=@Opp;
 EXEC dbo.usp_Opportunity_HeaderDetail_Batch @H,@I,@Username,1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp AND FieldName='OpportunityDesc' AND NewValue='Edited via batch' AND Source='User')
 THROW 52909,'Batch change missing.',1;
 -- Failed transition must not append history or leak the wrapper identity.
 SET XACT_ABORT OFF;
 SELECT @Rows=COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp;
 BEGIN TRY
  DECLARE @Failure UNIQUEIDENTIFIER=NEWID();
  EXEC dbo.usp_Opportunity_HeaderStage_Transition @Opp,'In progress',0x0000000000000000,N'Conflict',@Failure,@Username;
  THROW 52912,'Expected concurrency rejection.',1;
 END TRY
 BEGIN CATCH
  IF ERROR_NUMBER()<>52721 THROW;
 END CATCH;
 IF (SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp)<>@Rows THROW 52913,'Conflict generated history.',1;
 IF CONVERT(VARCHAR(20),SESSION_CONTEXT(N'OpportunityChangeSource'))<>'System' THROW 52914,'Failure leaked context.',1;
 BEGIN TRY
  EXEC dbo.usp_OpportunityChangeLog_Read N'no-such-audit-user',@Opp;
  THROW 52915,'Unauthorized read succeeded.',1;
 END TRY
 BEGIN CATCH
  IF ERROR_NUMBER()<>52841 THROW;
 END CATCH;
 -- Simulate a future automatic stage trigger. DDL and data are rolled back.
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 EXEC(N'CREATE TRIGGER dbo.tr_OpportunityItem_AuditTestAuto ON dbo.OpportunityItem AFTER UPDATE AS
 BEGIN SET NOCOUNT ON; IF UPDATE(Stage)
 UPDATE o SET Stage=''In progress'' FROM dbo.Opportunity o JOIN inserted i ON i.OpportunityID=o.ID; END');
 UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=@Item;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE OpportunityID=@Opp AND EntityLevel='Header' AND FieldName='Stage' AND Source='System' AND ChangedBy=@Username)
 THROW 52916,'Nested automatic stage metadata missing.',1;
 DROP TRIGGER dbo.tr_OpportunityItem_AuditTestAuto;
 -- Multiple affected rows in a statement must all be logged.
 INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
 VALUES('AUD-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),@Customer,'Bulk A','2026-09-01','2026-10-01','Draft',@UserID),
       ('AUD-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),@Customer,'Bulk B','2026-09-01','2026-10-01','Draft',@UserID);
 DECLARE @Second INT=SCOPE_IDENTITY(),@First INT;
 SELECT @First=MAX(ID) FROM dbo.Opportunity WHERE ID<@Second AND OpportunityDesc='Bulk A';
 UPDATE dbo.Opportunity SET OpportunityDesc='Bulk update' WHERE ID IN(@First,@Second);
 IF (SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE OpportunityID IN(@First,@Second) AND FieldName='OpportunityDesc' AND NewValue='Bulk update')<>2
 THROW 52917,'Multi-row capture lost a row.',1;
 -- Deletions retain the deleted item's snapshots.
 DELETE dbo.OpportunityItem WHERE ID=@Item;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityChangeLog WHERE ItemID=@Item AND Action='Delete' AND FieldName='ItemDescription' AND OldValue='Audit item' AND NewValue IS NULL)
 THROW 52910,'Deleted item history missing.',1;
 EXEC dbo.usp_OpportunityChangeLog_Read @Username,@Opp,1,5,'Item';
 ROLLBACK;
 IF (SELECT COUNT_BIG(*) FROM dbo.OpportunityChangeLog)<>@Before THROW 52911,'Rolled-back changes left history.',1;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',NULL;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',NULL;
 EXEC sys.sp_set_session_context N'OpportunityChangeEvent',NULL;
 EXEC sys.sp_set_session_context N'OpportunityChangeReason',NULL;
 PRINT 'PASS: creation, no-op, NULL/zero, system/user stage, replay, batch, deletion, paging and rollback.';
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH
