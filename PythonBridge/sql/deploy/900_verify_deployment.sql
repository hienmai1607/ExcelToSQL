SET NOCOUNT ON;

DECLARE @Required TABLE(ObjectType VARCHAR(10), ObjectName SYSNAME);
INSERT @Required(ObjectType, ObjectName) VALUES
('U','Users'),('U','UserAccess'),('U','Market'),('U','Currency'),
('U','Product'),('U','Customer'),('U','Opportunity'),('U','OpportunityItem'),
('U','TransactionStageTransition'),('U','OpportunityStageHistory'),
('U','OpportunityItemStageHistory'),('SO','OpportunityNumberSequence'),
('P','usp_Market_Batch'),('P','usp_Market_Read'),
('P','usp_Currency_Batch'),('P','usp_Currency_Read'),
('P','usp_User_Batch'),('P','usp_User_Read'),
('P','usp_UserAccess_Batch'),('P','usp_UserAccess_Read'),
('P','usp_Product_Batch'),('P','usp_Product_Read'),
('P','usp_Customer_Batch'),('P','usp_Customer_Read'),
('P','usp_Opportunity_HeaderDetail_Batch'),('P','usp_Opportunity_Grid_Read'),
('P','usp_Opportunity_HeaderStage_Transition'),
('P','usp_Opportunity_ItemStage_Transition'),
('U','OpportunityChangeLog'),('P','usp_OpportunityChangeLog_Read'),
('TR','tr_Opportunity_ChangeLog'),('TR','tr_OpportunityItem_ChangeLog');

IF EXISTS (
    SELECT 1 FROM @Required
    WHERE OBJECT_ID(N'dbo.' + ObjectName, ObjectType) IS NULL
)
BEGIN
    SELECT ObjectType, ObjectName AS MissingObject
    FROM @Required
    WHERE OBJECT_ID(N'dbo.' + ObjectName, ObjectType) IS NULL;
    THROW 52802, 'Database deployment verification failed: required objects are missing.', 1;
END;

IF TYPE_ID(N'dbo.ProductBatchType') IS NULL
   OR TYPE_ID(N'dbo.CustomerBatchType') IS NULL
   OR TYPE_ID(N'dbo.OpportunityHeaderBatchType') IS NULL
   OR TYPE_ID(N'dbo.OpportunityItemBatchType') IS NULL
    THROW 52803, 'Database deployment verification failed: required table types are missing.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.table_types t
    JOIN sys.columns c ON c.object_id = t.type_table_object_id
    WHERE SCHEMA_NAME(t.schema_id) = N'dbo'
      AND t.name = N'ProductBatchType'
      AND c.name = N'Status'
)
    THROW 52804, 'ProductBatchType is not the current contract.', 1;

SELECT
    DB_NAME() AS DatabaseName,
    (SELECT COUNT(*) FROM dbo.Users WHERE IsActive = 1) AS ActiveUsers,
    (SELECT COUNT(*) FROM dbo.UserAccess WHERE Scope = N'Admin') AS AdminAssignments,
    N'OK' AS DeploymentStatus;
GO
