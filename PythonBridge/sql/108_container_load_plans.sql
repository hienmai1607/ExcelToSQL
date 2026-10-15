-- Run after 107 in the application database. No historical responses are rewritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ContainerTypeMaster','U') IS NULL
 CREATE TABLE dbo.ContainerTypeMaster(
 ID INT IDENTITY PRIMARY KEY,Code NVARCHAR(30) NOT NULL UNIQUE,
 Family VARCHAR(10) NOT NULL CHECK(Family IN('Dry','Reefer')),
 SizeFT INT NOT NULL CHECK(SizeFT BETWEEN 1 AND 100),
 Specifications NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Specifications)=1),
 Status VARCHAR(10) NOT NULL CHECK(Status IN('Active','Block')),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION);
IF OBJECT_ID('dbo.ContainerLoadPlan','U') IS NULL
 CREATE TABLE dbo.ContainerLoadPlan(
 ID INT IDENTITY PRIMARY KEY,ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 ContainerID INT NOT NULL REFERENCES dbo.ContainerTypeMaster(ID),
 Inputs NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Inputs)=1),
 Result NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Result)=1),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.ContainerLoadPlan') AND name='IX_ContainerLoadPlan_Item')
 CREATE INDEX IX_ContainerLoadPlan_Item ON dbo.ContainerLoadPlan(ItemID,ID DESC);
COMMIT;
