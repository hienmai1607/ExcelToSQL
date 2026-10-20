-- Per-item TCB approaches. Existing settings remain the first active version.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.OpportunityTCBVersion','U') IS NULL
BEGIN
 CREATE TABLE dbo.OpportunityTCBVersion(
  ID INT IDENTITY PRIMARY KEY,
  ItemID INT NOT NULL REFERENCES dbo.OpportunityItem(ID),
  Version INT NOT NULL,
  Name NVARCHAR(100) NOT NULL,
  IsActive BIT NOT NULL DEFAULT 0,
  SavedJSON NVARCHAR(MAX) NOT NULL,
  GradeJSON NVARCHAR(MAX) NOT NULL,
  ContextJSON NVARCHAR(MAX) NULL,
  CreatedBy NVARCHAR(100) NOT NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedBy NVARCHAR(100) NOT NULL,
  UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT UQ_OpportunityTCBVersion_Number UNIQUE(ItemID,Version),
  CONSTRAINT CK_OpportunityTCBVersion_Saved CHECK(ISJSON(SavedJSON)=1),
  CONSTRAINT CK_OpportunityTCBVersion_Grades CHECK(ISJSON(GradeJSON)=1),
  CONSTRAINT CK_OpportunityTCBVersion_Context CHECK(ContextJSON IS NULL OR ISJSON(ContextJSON)=1),
  CONSTRAINT CK_OpportunityTCBVersion_Name CHECK(LEN(LTRIM(RTRIM(Name)))>0)
 );
 CREATE UNIQUE INDEX UX_OpportunityTCBVersion_Active ON dbo.OpportunityTCBVersion(ItemID) WHERE IsActive=1;
END;
INSERT dbo.OpportunityTCBVersion(ItemID,Version,Name,IsActive,SavedJSON,GradeJSON,CreatedBy,UpdatedBy)
 SELECT i.ID,1,N'Version 1',1,COALESCE(i.TCBCostInfo,N'{}'),COALESCE(i.ProductGradeSnapshot,N'{"items":[]}'),N'Migration',N'Migration'
 FROM dbo.OpportunityItem i WHERE NOT EXISTS(SELECT 1 FROM dbo.OpportunityTCBVersion v WHERE v.ItemID=i.ID);
EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_TCBVersion ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- All existing writers, including workbook and loss-only saves, keep the active approach in sync.
 UPDATE v SET SavedJSON=COALESCE(i.TCBCostInfo,N''{}''),GradeJSON=COALESCE(i.ProductGradeSnapshot,N''{"items":[]}''),
  ContextJSON=NULL,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.OpportunityTCBVersion v JOIN inserted i ON i.ID=v.ItemID JOIN deleted d ON d.ID=i.ID
 WHERE v.IsActive=1 AND (ISNULL(i.TCBCostInfo,N'''')<>ISNULL(d.TCBCostInfo,N'''')
  OR ISNULL(i.ProductGradeSnapshot,N'''')<>ISNULL(d.ProductGradeSnapshot,N''''));
 INSERT dbo.OpportunityTCBVersion(ItemID,Version,Name,IsActive,SavedJSON,GradeJSON,CreatedBy,UpdatedBy)
 SELECT i.ID,1,N''Version 1'',1,COALESCE(i.TCBCostInfo,N''{}''),COALESCE(i.ProductGradeSnapshot,N''{"items":[]}''),
  COALESCE(u.UserName,N''System''),COALESCE(u.UserName,N''System'')
 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID LEFT JOIN dbo.Users u ON u.ID=i.CreatedBy
 WHERE d.ID IS NULL AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityTCBVersion v WHERE v.ItemID=i.ID);
END;';
COMMIT TRANSACTION;
