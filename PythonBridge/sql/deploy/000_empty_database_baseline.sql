/*
    Fresh-install baseline for a dedicated, empty database.
    The deployment runner supplies the database context; do not add USE here.
    This script intentionally fails if an application table already exists.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF EXISTS (
    SELECT 1 FROM sys.tables
    WHERE schema_id = SCHEMA_ID(N'dbo')
)
    THROW 52800, 'Fresh baseline requires an empty dedicated database.', 1;
GO

BEGIN TRANSACTION;

CREATE TABLE dbo.Users(
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    UserName NVARCHAR(100) NOT NULL CONSTRAINT UQ_Users_UserName UNIQUE,
    IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
    RowVersion ROWVERSION NOT NULL
);

CREATE TABLE dbo.UserAccess(
    AccessID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserAccess PRIMARY KEY,
    UserID INT NOT NULL,
    Scope NVARCHAR(50) NOT NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT UQ_UserAccess UNIQUE(UserID, Scope),
    CONSTRAINT FK_UserAccess_User FOREIGN KEY(UserID) REFERENCES dbo.Users(ID),
    CONSTRAINT CK_UserAccess_Scope CHECK(Scope IN(N'Admin',N'Customer',N'Product',N'Opportunity'))
);

CREATE TABLE dbo.Market(
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Market PRIMARY KEY,
    MarketCode VARCHAR(10) NOT NULL CONSTRAINT UQ_Market_Code UNIQUE,
    MarketName VARCHAR(100) NOT NULL CONSTRAINT UQ_Market_Name UNIQUE,
    RowVersion ROWVERSION NOT NULL
);

CREATE TABLE dbo.Currency(
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Currency PRIMARY KEY,
    CurrencyCode CHAR(3) NOT NULL CONSTRAINT UQ_Currency_Code UNIQUE,
    CurrencyName VARCHAR(50) NOT NULL,
    RowVersion ROWVERSION NOT NULL
);

CREATE TABLE dbo.Product(
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Product PRIMARY KEY,
    ProductCode VARCHAR(20) NOT NULL CONSTRAINT UQ_Product_Code UNIQUE,
    ProductName VARCHAR(200) NOT NULL CONSTRAINT UQ_Product_Name UNIQUE,
    WeightGrams DECIMAL(10,2) NOT NULL,
    WeightOz AS CONVERT(DECIMAL(10,2), ROUND(WeightGrams / 28.3495231, 2)) PERSISTED,
    Status VARCHAR(10) NOT NULL CONSTRAINT DF_Product_Status DEFAULT('Active'),
    CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Product_CreatedAt DEFAULT(SYSUTCDATETIME()),
    CreatedBy INT NOT NULL,
    UpdatedAt DATETIME2(7) NULL,
    UpdatedBy INT NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_Product_CreatedBy FOREIGN KEY(CreatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT FK_Product_UpdatedBy FOREIGN KEY(UpdatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT CK_Product_Status CHECK(Status IN('Active','Block')),
    CONSTRAINT CK_Product_WeightGrams_Positive CHECK(WeightGrams > 0)
);

CREATE TABLE dbo.Customer(
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Customer PRIMARY KEY,
    CustomerName VARCHAR(200) NOT NULL CONSTRAINT UQ_Customer_Name UNIQUE,
    MarketID INT NOT NULL,
    CurrencyID INT NOT NULL,
    Status VARCHAR(10) NOT NULL CONSTRAINT DF_Customer_Status DEFAULT('Active'),
    CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Customer_CreatedAt DEFAULT(SYSUTCDATETIME()),
    CreatedBy INT NOT NULL,
    UpdatedAt DATETIME2(7) NULL,
    UpdatedBy INT NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_Customer_Market FOREIGN KEY(MarketID) REFERENCES dbo.Market(ID),
    CONSTRAINT FK_Customer_Currency FOREIGN KEY(CurrencyID) REFERENCES dbo.Currency(ID),
    CONSTRAINT FK_Customer_CreatedBy FOREIGN KEY(CreatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT FK_Customer_UpdatedBy FOREIGN KEY(UpdatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT CK_Customer_Status CHECK(Status IN('Active','Block'))
);

CREATE TABLE dbo.Opportunity(
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Opportunity PRIMARY KEY,
    OpportunityNumber VARCHAR(20) NOT NULL CONSTRAINT UQ_Opportunity_Number UNIQUE,
    CustomerID INT NOT NULL,
    OpportunityDesc VARCHAR(300) NOT NULL,
    BidOpen DATE NOT NULL,
    BidClose DATE NOT NULL,
    Stage VARCHAR(20) NOT NULL CONSTRAINT DF_Opportunity_Stage DEFAULT('Draft'),
    CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Opportunity_CreatedAt DEFAULT(SYSUTCDATETIME()),
    CreatedBy INT NOT NULL,
    UpdatedAt DATETIME2(7) NULL,
    UpdatedBy INT NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_Opportunity_Customer FOREIGN KEY(CustomerID) REFERENCES dbo.Customer(ID),
    CONSTRAINT FK_Opportunity_CreatedBy FOREIGN KEY(CreatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT FK_Opportunity_UpdatedBy FOREIGN KEY(UpdatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT CK_Opportunity_BidDates CHECK(BidClose >= BidOpen),
    CONSTRAINT CK_Opportunity_Stage CHECK(Stage IN('Draft','In progress','Closed','Canceled'))
);

CREATE TABLE dbo.OpportunityItem(
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OpportunityItem PRIMARY KEY,
    OpportunityID INT NOT NULL,
    ProductID INT NOT NULL,
    ItemDescription VARCHAR(300) NOT NULL,
    AnnualUnit INT NOT NULL,
    EstPctAwarded DECIMAL(5,2) NULL,
    ShelfPrice DECIMAL(10,2) NULL,
    Stage VARCHAR(20) NOT NULL CONSTRAINT DF_OpportunityItem_Stage DEFAULT('Draft'),
    CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_OpportunityItem_CreatedAt DEFAULT(SYSUTCDATETIME()),
    CreatedBy INT NOT NULL,
    UpdatedAt DATETIME2(7) NULL,
    UpdatedBy INT NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT UQ_OpportunityItem_OppProduct UNIQUE(OpportunityID, ProductID),
    CONSTRAINT FK_OpportunityItem_Opportunity FOREIGN KEY(OpportunityID) REFERENCES dbo.Opportunity(ID),
    CONSTRAINT FK_OpportunityItem_Product FOREIGN KEY(ProductID) REFERENCES dbo.Product(ID),
    CONSTRAINT FK_OpportunityItem_CreatedBy FOREIGN KEY(CreatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT FK_OpportunityItem_UpdatedBy FOREIGN KEY(UpdatedBy) REFERENCES dbo.Users(ID),
    CONSTRAINT CK_OpportunityItem_PctAwarded CHECK(EstPctAwarded IS NULL OR EstPctAwarded BETWEEN 0 AND 100),
    CONSTRAINT CK_OpportunityItem_Stage CHECK(Stage IN('Draft','Revising','In progress','Proposed','Awarded','Lost','Canceled'))
);

CREATE TABLE dbo.BridgeDeploymentHistory(
    DeploymentID VARCHAR(100) NOT NULL CONSTRAINT PK_BridgeDeploymentHistory PRIMARY KEY,
    AppliedAtUtc DATETIME2(7) NOT NULL CONSTRAINT DF_BridgeDeploymentHistory_AppliedAt DEFAULT(SYSUTCDATETIME()),
    AppliedBy SYSNAME NOT NULL CONSTRAINT DF_BridgeDeploymentHistory_AppliedBy DEFAULT(ORIGINAL_LOGIN())
);

COMMIT TRANSACTION;
GO

CREATE TYPE dbo.CurrencyBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
    CurrencyCode CHAR(3) NULL, CurrencyName VARCHAR(50) NULL,
    RowVersionB64 VARBINARY(8) NULL
);
GO
CREATE TYPE dbo.MarketBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
    MarketCode VARCHAR(10) NULL, MarketName VARCHAR(100) NULL,
    RowVersionB64 VARBINARY(8) NULL
);
GO
CREATE TYPE dbo.CustomerBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
    CustomerName VARCHAR(200) NULL, MarketID INT NULL, CurrencyID INT NULL,
    Status VARCHAR(10) NULL, RowVersionB64 VARBINARY(8) NULL
);
GO
CREATE TYPE dbo.OpportunityHeaderBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
    OpportunityNumber VARCHAR(20) NULL, CustomerID INT NULL,
    OpportunityDesc VARCHAR(300) NULL, BidOpen DATE NULL, BidClose DATE NULL,
    Stage VARCHAR(20) NULL, RowVersionB64 VARBINARY(8) NULL
);
GO
CREATE TYPE dbo.OpportunityItemBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
    OpportunityNumber VARCHAR(20) NOT NULL, ProductID INT NULL,
    ItemDescription VARCHAR(300) NULL, AnnualUnit INT NULL,
    EstPctAwarded DECIMAL(5,2) NULL, ShelfPrice DECIMAL(10,2) NULL,
    Stage VARCHAR(20) NULL, RowVersionB64 VARBINARY(8) NULL
);
GO
CREATE TYPE dbo.ProductBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
    ProductCode VARCHAR(20) NULL, ProductName VARCHAR(200) NULL,
    WeightValue DECIMAL(10,4) NULL, WeightUnit VARCHAR(2) NULL,
    Status VARCHAR(10) NULL, RowVersionB64 VARBINARY(8) NULL
);
GO
CREATE TYPE dbo.UserBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
    UserName NVARCHAR(100) NULL, IsActive BIT NULL,
    RowVersionB64 VARBINARY(8) NULL
);
GO
CREATE TYPE dbo.UserAccessBatchType AS TABLE(
    RowNum INT NOT NULL, Command CHAR(1) NOT NULL, AccessID INT NULL,
    UserID INT NULL, Scope NVARCHAR(50) NULL,
    RowVersionB64 VARBINARY(8) NULL
);
GO

INSERT dbo.BridgeDeploymentHistory(DeploymentID)
VALUES('000_empty_database_baseline');
GO
