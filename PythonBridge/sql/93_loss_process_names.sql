-- After 92. Free-text process types, Product-owned Product losses and Opportunity snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.LossProcessMaster','U') IS NULL THROW 52996,'Apply migration 92 first.',1;
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_LossProcessMaster_Type' AND parent_object_id=OBJECT_ID('dbo.LossProcessMaster'))
 ALTER TABLE dbo.LossProcessMaster DROP CONSTRAINT CK_LossProcessMaster_Type;
IF EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_LossProcessMaster_ActiveValues' AND object_id=OBJECT_ID('dbo.LossProcessMaster'))
 DROP INDEX UX_LossProcessMaster_ActiveValues ON dbo.LossProcessMaster;
ALTER TABLE dbo.LossProcessMaster ALTER COLUMN ProcessType NVARCHAR(100) NOT NULL;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_LossProcessMaster_Name' AND parent_object_id=OBJECT_ID('dbo.LossProcessMaster'))
 ALTER TABLE dbo.LossProcessMaster ADD CONSTRAINT CK_LossProcessMaster_Name CHECK(LEN(LTRIM(RTRIM(ProcessType)))>0);
CREATE UNIQUE INDEX UX_LossProcessMaster_ActiveValues ON dbo.LossProcessMaster(ProcessType,Sequence,LossPct) WHERE Status='Active';
IF COL_LENGTH('dbo.Product','LossProcesses') IS NULL ALTER TABLE dbo.Product ADD LossProcesses NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.OpportunityItem','ProductLossSnapshot') IS NULL ALTER TABLE dbo.OpportunityItem ADD ProductLossSnapshot NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_Product_LossProcesses')
 ALTER TABLE dbo.Product ADD CONSTRAINT CK_Product_LossProcesses CHECK(LossProcesses IS NULL OR ISJSON(LossProcesses)=1);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_Opportunity_ProductLossSnapshot')
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_Opportunity_ProductLossSnapshot CHECK(ProductLossSnapshot IS NULL OR ISJSON(ProductLossSnapshot)=1);
UPDATE i SET ProductLossSnapshot=COALESCE(p.LossProcesses,'[]')
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ProductLossSnapshot IS NULL;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ProductLossSnapshot ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM inserted fresh LEFT JOIN deleted old ON old.ID=fresh.ID
  WHERE old.ID IS NULL OR old.ProductID<>fresh.ProductID) RETURN;
 UPDATE item SET ProductLossSnapshot=COALESCE(product.LossProcesses,'[]')
 FROM dbo.OpportunityItem item JOIN inserted fresh ON fresh.ID=item.ID
 LEFT JOIN deleted old ON old.ID=fresh.ID JOIN dbo.Product product ON product.ID=fresh.ProductID
 WHERE old.ID IS NULL OR old.ProductID<>fresh.ProductID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductLossProcesses_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Product');
 IF @Actor IS NULL THROW 52998,'Product access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'[' THROW 52996,'Product loss processes must be an array.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
  THROW 52997,'Product changed. Refresh before saving.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WITH(MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),
   ProcessName NVARCHAR(100),Sequence INT,LossPct DECIMAL(5,2)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE master.ID IS NULL OR master.Status<>'Active' OR assigned.ProcessType IS NULL OR assigned.ProcessType<>'Processing'
   OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion
   OR assigned.ProcessName IS NULL OR assigned.ProcessName<>master.ProcessType
   OR assigned.Sequence IS NULL OR assigned.Sequence NOT BETWEEN 1 AND 1000
   OR assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100)
  THROW 52997,'Loss Process changed. Refresh before saving.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@Value))>100 OR EXISTS(
  SELECT Sequence FROM OPENJSON(@Value) WITH(Sequence INT) GROUP BY Sequence HAVING COUNT(*)>1)
  THROW 52996,'Use up to 100 processes with unique sequences.',1;
 UPDATE dbo.Product SET LossProcesses=@Value,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 SELECT ID,RowVersion FROM dbo.Product WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_LossProcessMaster_Save
 @Username NVARCHAR(100),@ID INT=NULL,@ExpectedRowVersion VARBINARY(8)=NULL,
 @ProcessType NVARCHAR(100)=NULL,@Sequence INT=NULL,@LossPct DECIMAL(5,2)=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain Loss Process Master.',1;
 SET @ProcessType=LTRIM(RTRIM(@ProcessType));
 IF NULLIF(@ProcessType,'') IS NULL
  OR @Sequence IS NULL OR @Sequence NOT BETWEEN 1 AND 1000 OR @LossPct IS NULL OR @LossPct NOT BETWEEN 0 AND 100
  OR @Status IS NULL OR @Status NOT IN('Active','Block') THROW 52996,'Check process type, sequence, loss and status.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF @Status='Active' AND EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK)
  WHERE ProcessType=@ProcessType AND Sequence=@Sequence AND LossPct=@LossPct AND Status='Active'
   AND (@ID IS NULL OR ID<>@ID))
  THROW 52996,'An active Loss Process with these values already exists.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.LossProcessMaster(ProcessType,Sequence,LossPct,Status,CreatedBy)
  VALUES(@ProcessType,@Sequence,@LossPct,@Status,@Actor);
  SET @ID=CONVERT(INT,SCOPE_IDENTITY());
 END ELSE BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
   THROW 52997,'Loss Process changed. Refresh before saving.',1;
  UPDATE dbo.LossProcessMaster SET ProcessType=@ProcessType,Sequence=@Sequence,LossPct=@LossPct,Status=@Status,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 END;
 SELECT ID,RowVersion FROM dbo.LossProcessMaster WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OpportunityID INT,@Old NVARCHAR(MAX);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity');
 IF @Actor IS NULL THROW 52998,'Opportunity access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'TCB information must be JSON.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @OpportunityID=i.OpportunityID,@Old=i.TCBCostInfo
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @OpportunityID IS NULL THROW 52997,'Item changed or is no longer Draft. Refresh before saving TCB.',1;
 -- A price cannot change between API calculation and this write.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion)
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 -- Values may be overridden, but assignments must refer to a saved snapshot
 -- or a currently active master. Product assignments originate in Product Master.
 DECLARE @ProductSnapshot NVARCHAR(MAX);
 SELECT @ProductSnapshot=ProductLossSnapshot FROM dbo.OpportunityItem WHERE ID=@ID;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
  (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100
  OR (
   NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) previous
    WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
     AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
     AND previous.ProcessType=assigned.ProcessType AND previous.Sequence=assigned.Sequence)
   AND NOT EXISTS(SELECT 1 FROM OPENJSON(@ProductSnapshot) WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) captured
    WHERE captured.MasterID=assigned.MasterID AND captured.MasterVersion=assigned.MasterVersion
     AND captured.ProcessType=assigned.ProcessType AND captured.Sequence=assigned.Sequence)
   AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
    AND JSON_VALUE(@Old,CASE assigned.ProcessType
     WHEN 'Processing' THEN '$.Inputs.LossProductPct'
     WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
     WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
     WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
     ELSE '$.Inputs.Unknown' END) IS NOT NULL)
   AND (assigned.ProcessType IN('Sorting','Processing') OR master.ID IS NULL OR master.Status<>'Active'
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion)
  ))
 THROW 52997,'Loss assignment changed or is invalid. Refresh before saving.',1;
 UPDATE dbo.OpportunityItem SET TCBCostInfo=@Value WHERE ID=@ID;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
  FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT NEWID(),@OpportunityID,'Item',@ID,p.ProductCode,'Update','TCBCostInfo',@Old,@Value,@Username,'User','TCB Calculator'
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=@ID;
 SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
