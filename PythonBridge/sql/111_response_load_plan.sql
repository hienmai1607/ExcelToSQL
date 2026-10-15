-- After 110. Existing responses retain their original calculations.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','LoadPlanID') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD LoadPlanID INT NULL REFERENCES dbo.ContainerLoadPlan(ID);
IF OBJECT_ID('dbo.ResponseLoadPlanHistory','U') IS NULL
 CREATE TABLE dbo.ResponseLoadPlanHistory(
 ID BIGINT IDENTITY PRIMARY KEY,ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 PreviousPlanID INT NULL,LoadPlanID INT NULL,ChangedBy INT NOT NULL REFERENCES dbo.Users(ID),
 ChangedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
