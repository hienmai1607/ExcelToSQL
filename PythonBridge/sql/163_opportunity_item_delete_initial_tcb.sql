-- Requires 162. Deleting a Draft Opportunity item (standalone or a Mix family) failed with a
-- foreign-key error because every item automatically gets an empty initial TCB version
-- (Version 1, SavedJSON '{}', ContextJSON NULL). That version is not history, so the delete
-- trigger now removes it together with the item and its Mix children. Any real TCB history
-- (a saved version, a second version or captured context) still blocks the delete.
-- Existing data is not changed by this migration. Rerunnable.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.usp_OpportunityItem_MixRefresh','P') IS NULL
  THROW 52996,'Apply migration 162 first.',1;
 IF OBJECT_ID('dbo.OpportunityTCBVersion','U') IS NULL
  THROW 52996,'OpportunityTCBVersion is missing; apply migration 136 first.',1;
 DECLARE @D NVARCHAR(MAX),@Old NVARCHAR(400);
 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_MixDelete'));
 IF @D IS NULL OR CHARINDEX(N'OpportunityMixRefreshID',@D)=0
  THROW 52996,'Mix delete trigger is not at migration 162; migration 163 was not applied.',1;
 IF CHARINDEX(N'-- Initial TCB version (163)',@D)=0
 BEGIN
  SET @Old=N' DELETE c FROM dbo.OpportunityItem c JOIN deleted p ON c.ParentItemID=p.ID;';
  IF (LEN(@D)-LEN(REPLACE(@D,@Old,N'')))/LEN(@Old)<>1
   THROW 52996,'Unexpected Mix delete trigger definition; migration 163 was not applied.',1;
  SET @D=REPLACE(@D,@Old,N' -- Initial TCB version (163): the automatic empty Version 1 is not history; remove it with its item.
 DELETE v FROM dbo.OpportunityTCBVersion v
 WHERE v.Version=1 AND v.SavedJSON=N''{}'' AND v.ContextJSON IS NULL
  AND v.ItemID IN(SELECT d.ID FROM deleted d UNION ALL SELECT c.ID FROM dbo.OpportunityItem c JOIN deleted p ON c.ParentItemID=p.ID);'+@Old);
  SET @D=STUFF(@D,1,CHARINDEX(N'TRIGGER',UPPER(@D))+LEN(N'TRIGGER')-1,N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
 PRINT 'Migration 163 applied: deleting an item removes its automatic initial TCB version.';
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
