-- After 114. Immutable pallet and accessory pricing snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.PalletPricingSnapshot','U') IS NULL
 CREATE TABLE dbo.PalletPricingSnapshot(
 ID INT IDENTITY PRIMARY KEY,ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
 SnapshotJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(SnapshotJSON)=1),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletPricingID') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletPricingID INT NULL REFERENCES dbo.PalletPricingSnapshot(ID);
