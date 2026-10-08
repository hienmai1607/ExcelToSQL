-- After 91. Select the intended application database. No history is removed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.OpportunityItem','TCBCostInfo') IS NULL
 THROW 52996,'Apply migration 91 before Loss Process Master.',1;
IF OBJECT_ID('dbo.LossProcessMaster','U') IS NULL
BEGIN
 CREATE TABLE dbo.LossProcessMaster(
  ID INT IDENTITY PRIMARY KEY,ProcessType VARCHAR(32) NOT NULL,Sequence INT NOT NULL,
  LossPct DECIMAL(5,2) NOT NULL,Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME()),
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION,
  CONSTRAINT CK_LossProcessMaster_Type CHECK(ProcessType IN('Sorting','Processing','PrimaryPackaging',
   'SecondaryPackaging','TertiaryPackaging','MixPrimaryPackaging','MixSecondaryPackaging','MixTertiaryPackaging')),
  CONSTRAINT CK_LossProcessMaster_Values CHECK(Sequence BETWEEN 1 AND 1000 AND LossPct BETWEEN 0 AND 100),
  CONSTRAINT CK_LossProcessMaster_Status CHECK(Status IN('Active','Block')));
 CREATE UNIQUE INDEX UX_LossProcessMaster_ActiveValues ON dbo.LossProcessMaster(ProcessType,Sequence,LossPct)
  WHERE Status='Active';
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_LossProcessMaster_Save
 @Username NVARCHAR(100),@ID INT=NULL,@ExpectedRowVersion VARBINARY(8)=NULL,
 @ProcessType VARCHAR(32)=NULL,@Sequence INT=NULL,@LossPct DECIMAL(5,2)=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain Loss Process Master.',1;
 IF @ProcessType IS NULL OR @ProcessType NOT IN('Sorting','Processing','PrimaryPackaging','SecondaryPackaging',
   'TertiaryPackaging','MixPrimaryPackaging','MixSecondaryPackaging','MixTertiaryPackaging')
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
 -- New assignments must still match Master at the instant of saving. Existing
 -- exact snapshots remain valid after Master edits or blocking.
 IF EXISTS(
  SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
   (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
   (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) previous
   WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
    AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
    AND previous.ProcessType=assigned.ProcessType AND previous.Sequence=assigned.Sequence
    AND previous.LossPct=assigned.LossPct)
  AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
   AND assigned.LossPct=ISNULL(TRY_CONVERT(DECIMAL(38,12),JSON_VALUE(@Old,
     CASE assigned.ProcessType WHEN 'Processing' THEN '$.Inputs.LossProductPct'
      WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
      WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
      WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
      ELSE '$.Inputs.Unknown' END)),-1))
  AND (master.ID IS NULL OR master.Status<>'Active'
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion
    OR master.ProcessType<>assigned.ProcessType OR master.Sequence<>assigned.Sequence OR master.LossPct<>assigned.LossPct))
  THROW 52997,'Loss Process Master changed or assignment is invalid. Refresh and select again.',1;
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
