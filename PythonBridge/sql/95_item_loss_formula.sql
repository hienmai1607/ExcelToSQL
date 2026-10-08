-- After 94. Item packaging loss is a direct ratio per layer; Product formula is stored in TCB JSON.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX),@LossOnly BIT=0
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
 IF @LossOnly=0
 AND EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion)
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 -- Values may be overridden, but assignments must refer to a saved snapshot
 -- or a currently active process name. Sequence and Loss % belong to the item.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
  (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100
  OR (
   NOT (assigned.MasterID IS NULL AND assigned.ProcessType IN('PrimaryPackaging','SecondaryPackaging','TertiaryPackaging','MixPrimaryPackaging','MixSecondaryPackaging','MixTertiaryPackaging') AND assigned.Sequence=1)
   AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) previous
    WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
     AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
     AND previous.ProcessType=assigned.ProcessType)
   AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
    AND JSON_VALUE(@Old,CASE assigned.ProcessType
     WHEN 'Processing' THEN '$.Inputs.LossProductPct'
     WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
     WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
     WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
     ELSE '$.Inputs.Unknown' END) IS NOT NULL)
   AND (master.ID IS NULL OR master.Status<>'Active'
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
