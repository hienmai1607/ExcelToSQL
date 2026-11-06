SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.OpportunityTCBVersion','U') IS NULL
 THROW 53054,'Apply migrations through 153 before the NPD workspace.',1;

IF OBJECT_ID('dbo.NPDIngredient','U') IS NULL
CREATE TABLE dbo.NPDIngredient(
 ID INT IDENTITY PRIMARY KEY,
 IngredientCode AS ('ING-'+RIGHT('0000000000'+CONVERT(VARCHAR(10),ID),10)) PERSISTED,
 Description NVARCHAR(300) NOT NULL,Origin NVARCHAR(150) NOT NULL DEFAULT '',
 BaseUoMID INT NOT NULL REFERENCES dbo.UoM(ID),Status VARCHAR(10) NOT NULL DEFAULT 'Active' CHECK(Status IN('Active','Block')),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION,
 CONSTRAINT UQ_NPDIngredient_Code UNIQUE(IngredientCode));

IF OBJECT_ID('dbo.NPDIngredientPrice','U') IS NULL
CREATE TABLE dbo.NPDIngredientPrice(
 ID INT IDENTITY PRIMARY KEY,IngredientID INT NOT NULL REFERENCES dbo.NPDIngredient(ID),
 VendorID INT NOT NULL REFERENCES dbo.Vendor(ID),CurrencyID INT NOT NULL REFERENCES dbo.Currency(ID),
 UnitPrice DECIMAL(19,6) NOT NULL CHECK(UnitPrice>=0),PriceUoMID INT NOT NULL REFERENCES dbo.UoM(ID),
 QuantityFrom DECIMAL(19,6) NOT NULL DEFAULT 0 CHECK(QuantityFrom>=0),QuantityTo DECIMAL(19,6) NULL,
 EffectiveFrom DATE NOT NULL,EffectiveTo DATE NULL,ExchangeRateToUSD DECIMAL(19,9) NULL CHECK(ExchangeRateToUSD>0),
 Status VARCHAR(10) NOT NULL DEFAULT 'Active' CHECK(Status IN('Active','Block')),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION,
 CHECK(QuantityTo IS NULL OR QuantityTo>QuantityFrom),CHECK(EffectiveTo IS NULL OR EffectiveTo>=EffectiveFrom));

IF OBJECT_ID('dbo.NPDRecipeRequest','U') IS NULL
CREATE TABLE dbo.NPDRecipeRequest(
 ID INT IDENTITY PRIMARY KEY,RequestNumber AS ('RRQ-'+RIGHT('0000000000'+CONVERT(VARCHAR(10),ID),10)) PERSISTED,
 CreationKey UNIQUEIDENTIFIER NOT NULL UNIQUE,OpportunityID INT NOT NULL REFERENCES dbo.Opportunity(ID),
 OpportunityNumber NVARCHAR(30) NOT NULL,CustomerName NVARCHAR(300) NOT NULL,RequestNote NVARCHAR(2000) NULL,
 RequestDue DATE NOT NULL,RequestedBy INT NOT NULL REFERENCES dbo.Users(ID),RequestedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),RowVersion ROWVERSION);

IF OBJECT_ID('dbo.NPDRecipeRequestItem','U') IS NULL
CREATE TABLE dbo.NPDRecipeRequestItem(
 ID INT IDENTITY PRIMARY KEY,RequestID INT NOT NULL REFERENCES dbo.NPDRecipeRequest(ID),
 OpportunityItemID INT NOT NULL REFERENCES dbo.OpportunityItem(ID),ProductID INT NOT NULL REFERENCES dbo.Product(ID),
 ProductCode NVARCHAR(100) NOT NULL,ProductName NVARCHAR(300) NOT NULL,
 WeightGrams DECIMAL(19,6) NOT NULL CHECK(WeightGrams>0),AnnualUnit DECIMAL(19,6) NOT NULL CHECK(AnnualUnit>0),
 EstPctAwarded DECIMAL(9,6) NOT NULL CHECK(EstPctAwarded BETWEEN 0 AND 100),
 GradeSnapshot NVARCHAR(MAX) NOT NULL CHECK(ISJSON(GradeSnapshot)=1),
 LaunchingDate DATE NULL,SpecialComments NVARCHAR(2000) NULL,
 PICUserID INT NULL REFERENCES dbo.Users(ID),AssignedBy INT NULL REFERENCES dbo.Users(ID),AssignedAt DATETIME2 NULL,
 IsOpen BIT NOT NULL DEFAULT 1,ActiveSheetID INT NULL,RowVersion ROWVERSION,
 UNIQUE(RequestID,OpportunityItemID));
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.NPDRecipeRequestItem') AND name='UX_NPDRecipeRequestItem_Open')
 CREATE UNIQUE INDEX UX_NPDRecipeRequestItem_Open ON dbo.NPDRecipeRequestItem(OpportunityItemID) WHERE IsOpen=1;

IF OBJECT_ID('dbo.NPDRecipeSheet','U') IS NULL
CREATE TABLE dbo.NPDRecipeSheet(
 ID INT IDENTITY PRIMARY KEY,SheetNumber AS ('RCP-'+RIGHT('0000000000'+CONVERT(VARCHAR(10),ID),10)) PERSISTED,
 CreationKey UNIQUEIDENTIFIER NOT NULL UNIQUE,RequestItemID INT NOT NULL REFERENCES dbo.NPDRecipeRequestItem(ID),
 Revision INT NOT NULL CHECK(Revision>0),Status VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK(Status IN('Draft','Price Ready','Final')),
 ApprovalStatus VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK(ApprovalStatus IN('Draft','Pending','Approved','Returned')),
 LinesJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(LinesJSON)=1),CalculationJSON NVARCHAR(MAX) NULL CHECK(CalculationJSON IS NULL OR ISJSON(CalculationJSON)=1),
 ReviewComment NVARCHAR(2000) NULL,CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,SubmittedBy INT NULL REFERENCES dbo.Users(ID),SubmittedAt DATETIME2 NULL,
 ApprovedBy INT NULL REFERENCES dbo.Users(ID),ApprovedAt DATETIME2 NULL,RowVersion ROWVERSION,
 UNIQUE(RequestItemID,Revision));
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_NPDRecipeItem_ActiveSheet')
 ALTER TABLE dbo.NPDRecipeRequestItem ADD CONSTRAINT FK_NPDRecipeItem_ActiveSheet FOREIGN KEY(ActiveSheetID) REFERENCES dbo.NPDRecipeSheet(ID);

IF OBJECT_ID('dbo.NPDAudit','U') IS NULL
CREATE TABLE dbo.NPDAudit(
 ID BIGINT IDENTITY PRIMARY KEY,Entity VARCHAR(30) NOT NULL,RecordID INT NOT NULL,Action VARCHAR(40) NOT NULL,
 SnapshotJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(SnapshotJSON)=1),ActorID INT NOT NULL REFERENCES dbo.Users(ID),
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());

IF OBJECT_ID('dbo.CK_UserAccess_Scope','C') IS NOT NULL ALTER TABLE dbo.UserAccess DROP CONSTRAINT CK_UserAccess_Scope;
ALTER TABLE dbo.UserAccess WITH CHECK ADD CONSTRAINT CK_UserAccess_Scope CHECK(Scope IN('Admin','Customer','Product','Opportunity','Packaging','PackagingManager','RawMaterial','NPD','NPDManager'));

DECLARE @Admin INT=(SELECT TOP(1) u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID);
IF @Admin IS NULL THROW 53054,'An active Administrator is required to create NPD roles.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRole WHERE RoleName='NPD Member')
 INSERT dbo.WorkspaceRole(RoleName,IsActive,CreatedBy) VALUES('NPD Member',1,@Admin);
IF NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRole WHERE RoleName='NPD Manager')
 INSERT dbo.WorkspaceRole(RoleName,IsActive,CreatedBy) VALUES('NPD Manager',1,@Admin);
INSERT dbo.WorkspaceRolePermission(RoleID,PageKey,AccessLevel)
 SELECT r.ID,p.PageKey,CASE WHEN p.PageKey='recipe-requests' AND r.RoleName='NPD Member' THEN 'display' ELSE p.AccessLevel END
 FROM dbo.WorkspaceRole r CROSS JOIN(VALUES('ingredients','edit'),('ingredient-prices','edit'),('recipe-requests','edit'),('recipe-sheets','edit'),('vendors','display'),('uoms','display'))p(PageKey,AccessLevel)
 WHERE r.RoleName IN('NPD Member','NPD Manager') AND NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRolePermission old WHERE old.RoleID=r.ID AND old.PageKey=p.PageKey);
-- Sales can request recipes and read approved sheets; this grants no NPD editing scope.
INSERT dbo.WorkspaceRolePermission(RoleID,PageKey,AccessLevel)
 SELECT r.ID,p.PageKey,'display' FROM dbo.WorkspaceRole r
 CROSS JOIN(VALUES('recipe-requests'),('recipe-sheets'))p(PageKey)
 WHERE EXISTS(SELECT 1 FROM dbo.WorkspaceRolePermission sales WHERE sales.RoleID=r.ID AND sales.PageKey='opportunities' AND sales.AccessLevel='edit')
 AND NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRolePermission old WHERE old.RoleID=r.ID AND old.PageKey=p.PageKey);
COMMIT TRANSACTION;
