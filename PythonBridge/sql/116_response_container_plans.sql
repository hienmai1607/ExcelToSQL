-- After 115. Current response load plan per physical container type.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ResponseContainerLoadPlan','U') IS NULL
 CREATE TABLE dbo.ResponseContainerLoadPlan(
 ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 ContainerID INT NOT NULL REFERENCES dbo.ContainerTypeMaster(ID),
 PlanID INT NOT NULL REFERENCES dbo.ContainerLoadPlan(ID),
 UpdatedBy INT NOT NULL REFERENCES dbo.Users(ID),
 UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_ResponseContainerLoadPlan PRIMARY KEY(ItemID,ContainerID));
INSERT dbo.ResponseContainerLoadPlan(ItemID,ContainerID,PlanID,UpdatedBy)
 SELECT i.ID,p.ContainerID,p.ID,p.CreatedBy FROM dbo.PackagingConfigurationRequestItem i
 JOIN dbo.ContainerLoadPlan p ON p.ID=i.LoadPlanID AND p.ItemID=i.ID
 WHERE NOT EXISTS(SELECT 1 FROM dbo.ResponseContainerLoadPlan r WHERE r.ItemID=i.ID AND r.ContainerID=p.ContainerID);

-- Feedback may evaluate every standard container, irrespective of request family/size.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL THROW 52996,'Apply preceding Packaging field migrations first.',1;
IF CHARINDEX(N'-- Independent container feedback (116)',@D)=0
BEGIN
 IF CHARINDEX(N'IF @ShipmentType IS NOT NULL AND ((@ShipmentSize=',@D)=0 OR CHARINDEX(N'IF (@ContainerFamily=N''Dry''',@D)=0
  THROW 52996,'Unexpected container validation definition; migration not applied.',1;
 SET @D=REPLACE(@D,N'IF @ShipmentType IS NOT NULL AND ((@ShipmentSize=',N'SET @ShipmentSize=NULL; -- Independent container feedback (116)
 IF @ShipmentType IS NOT NULL AND ((@ShipmentSize=');
 SET @D=REPLACE(@D,N'IF (@ContainerFamily=N''Dry''',N'SET @ContainerFamily=NULL;
 IF (@ContainerFamily=N''Dry''');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;

COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
