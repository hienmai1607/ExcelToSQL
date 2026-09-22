USE [test];
GO
/* Target: existing test database. Run after existing migrations 01-12.
   Rerunnable additive schema: no request history or revision tables. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO
IF OBJECT_ID('dbo.OpportunityItem','U') IS NULL OR OBJECT_ID('dbo.UserAccess','U') IS NULL
    THROW 51100,'Deploy the existing Opportunity and User Access model first.',1;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.PackagingMaterial','U') IS NULL
BEGIN
    CREATE TABLE dbo.PackagingMaterial (
        ID INT IDENTITY PRIMARY KEY,
        MaterialCode NVARCHAR(40) NOT NULL UNIQUE,
        MaterialName NVARCHAR(200) NOT NULL,
        Description NVARCHAR(500) NULL,
        UnitOfMeasure NVARCHAR(20) NOT NULL,
        Status VARCHAR(10) NOT NULL DEFAULT('Active'),
        CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
        CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy INT NULL REFERENCES dbo.Users(ID),
        RowVersion ROWVERSION NOT NULL,
        CONSTRAINT CK_PackagingMaterial_Text CHECK(LEN(LTRIM(RTRIM(MaterialCode)))>0
            AND LEN(LTRIM(RTRIM(MaterialName)))>0 AND LEN(LTRIM(RTRIM(UnitOfMeasure)))>0),
        CONSTRAINT CK_PackagingMaterial_Status CHECK(Status IN('Active','Block'))
    );
    CREATE INDEX IX_PackagingMaterial_Name ON dbo.PackagingMaterial(MaterialName,ID);
END;
IF OBJECT_ID('dbo.PackagingPrice','U') IS NULL
BEGIN
    CREATE TABLE dbo.PackagingPrice (
        ID INT IDENTITY PRIMARY KEY,
        MaterialID INT NOT NULL REFERENCES dbo.PackagingMaterial(ID),
        CurrencyID INT NOT NULL REFERENCES dbo.Currency(ID),
        PriceBasis NVARCHAR(40) NOT NULL,
        QuantityFrom DECIMAL(18,4) NOT NULL DEFAULT(0),
        QuantityTo DECIMAL(18,4) NULL,
        UnitPrice DECIMAL(18,4) NOT NULL,
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        Status VARCHAR(10) NOT NULL DEFAULT('Active'),
        CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
        CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy INT NULL REFERENCES dbo.Users(ID),
        RowVersion ROWVERSION NOT NULL,
        CONSTRAINT CK_PackagingPrice_Values CHECK(UnitPrice>=0 AND QuantityFrom>=0
            AND (QuantityTo IS NULL OR QuantityTo>QuantityFrom)
            AND (EffectiveTo IS NULL OR EffectiveTo>=EffectiveFrom) AND LEN(LTRIM(RTRIM(PriceBasis)))>0),
        CONSTRAINT CK_PackagingPrice_Status CHECK(Status IN('Active','Block'))
    );
    CREATE INDEX IX_PackagingPrice_Lookup ON dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,Status,EffectiveFrom);
END;
IF OBJECT_ID('dbo.PackagingConfigurationRequest','U') IS NULL
BEGIN
    CREATE TABLE dbo.PackagingConfigurationRequest (
        ID INT IDENTITY PRIMARY KEY,
        RequestNumber AS ('PCR-'+CONVERT(VARCHAR(12),ID)) PERSISTED,
        CreationKey UNIQUEIDENTIFIER NOT NULL UNIQUE,
        OpportunityID INT NOT NULL REFERENCES dbo.Opportunity(ID),
        OpportunityNumber VARCHAR(20) NOT NULL,
        CustomerID INT NOT NULL REFERENCES dbo.Customer(ID),
        CustomerName VARCHAR(200) NOT NULL,
        OpportunityDescription VARCHAR(300) NOT NULL,
        BidOpen DATE NOT NULL,
        BidClose DATE NOT NULL,
        SourceRowVersion BINARY(8) NOT NULL,
        RequestedBy INT NOT NULL REFERENCES dbo.Users(ID),
        RequestedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
        ResponseDue DATE NOT NULL,
        RequestNotes NVARCHAR(1000) NULL,
        RowVersion ROWVERSION NOT NULL,
        CONSTRAINT CK_PCR_Due CHECK(ResponseDue>=CONVERT(DATE,RequestedAt))
    );
    CREATE UNIQUE INDEX UX_PCR_Number ON dbo.PackagingConfigurationRequest(RequestNumber);
    CREATE INDEX IX_PCR_Opportunity ON dbo.PackagingConfigurationRequest(OpportunityID,ID);
END;
IF OBJECT_ID('dbo.PackagingConfigurationRequestItem','U') IS NULL
BEGIN
    CREATE TABLE dbo.PackagingConfigurationRequestItem (
        ID INT IDENTITY PRIMARY KEY,
        RequestID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequest(ID),
        OpportunityItemID INT NOT NULL REFERENCES dbo.OpportunityItem(ID),
        ProductID INT NOT NULL REFERENCES dbo.Product(ID),
        ProductCode VARCHAR(20) NOT NULL,
        ProductName VARCHAR(200) NOT NULL,
        ItemDescription VARCHAR(300) NOT NULL,
        AnnualUnit INT NOT NULL,
        SourceRowVersion BINARY(8) NOT NULL,
        PackagingRequirement NVARCHAR(1000) NULL,
        PICUserID INT NULL REFERENCES dbo.Users(ID),
        Stage VARCHAR(20) NOT NULL DEFAULT('Assigned'),
        IsOpen BIT NOT NULL DEFAULT(1),
        MaterialID INT NULL REFERENCES dbo.PackagingMaterial(ID),
        HeightMM DECIMAL(12,2) NULL,
        WidthMM DECIMAL(12,2) NULL,
        LengthMM DECIMAL(12,2) NULL,
        Cost DECIMAL(18,4) NULL,
        CurrencyID INT NULL REFERENCES dbo.Currency(ID),
        CostBasis NVARCHAR(40) NULL,
        ResponseNotes NVARCHAR(1000) NULL,
        SubmittedAt DATETIME2(7) NULL,
        SubmittedBy INT NULL REFERENCES dbo.Users(ID),
        ReviewedAt DATETIME2(7) NULL,
        ReviewedBy INT NULL REFERENCES dbo.Users(ID),
        ManagerComment NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
        CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy INT NULL REFERENCES dbo.Users(ID),
        RowVersion ROWVERSION NOT NULL,
        CONSTRAINT UQ_PCRI_Source UNIQUE(RequestID,OpportunityItemID),
        CONSTRAINT CK_PCRI_Stage CHECK(Stage IN('Assigned','Working','Pending Review','Returned','Approved','Canceled')),
        CONSTRAINT CK_PCRI_Open CHECK((IsOpen=0 AND Stage IN('Approved','Canceled'))
            OR (IsOpen=1 AND Stage IN('Assigned','Working','Pending Review','Returned'))),
        CONSTRAINT CK_PCRI_Numeric CHECK((HeightMM IS NULL OR HeightMM>0)
            AND (WidthMM IS NULL OR WidthMM>0) AND (LengthMM IS NULL OR LengthMM>0)
            AND (Cost IS NULL OR Cost>=0)),
        CONSTRAINT CK_PCRI_Cost CHECK((Cost IS NULL AND CurrencyID IS NULL AND CostBasis IS NULL)
            OR (Cost IS NOT NULL AND CurrencyID IS NOT NULL AND CostBasis IS NOT NULL AND LEN(LTRIM(RTRIM(CostBasis)))>0))
    );
    CREATE UNIQUE INDEX UX_PCRI_ActiveSource ON dbo.PackagingConfigurationRequestItem(OpportunityItemID) WHERE IsOpen=1;
    CREATE INDEX IX_PCRI_Request ON dbo.PackagingConfigurationRequestItem(RequestID,ID);
    CREATE INDEX IX_PCRI_Worklist ON dbo.PackagingConfigurationRequestItem(PICUserID,Stage,ID) INCLUDE(RequestID,ProductCode);
END;
/* Extend valid scopes without assigning access to any user. */
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.UserAccess') AND name='CK_UserAccess_Scope')
    ALTER TABLE dbo.UserAccess DROP CONSTRAINT CK_UserAccess_Scope;
ALTER TABLE dbo.UserAccess WITH CHECK ADD CONSTRAINT CK_UserAccess_Scope
    CHECK(Scope IN(N'Admin',N'Customer',N'Product',N'Opportunity',N'Packaging',N'PackagingManager'));
COMMIT;
GO
IF TYPE_ID('dbo.PackagingMaterialBatchType') IS NULL
EXEC(N'CREATE TYPE dbo.PackagingMaterialBatchType AS TABLE(
    RowNum INT NOT NULL PRIMARY KEY, Command CHAR(1) NOT NULL, ID INT NULL,
    MaterialCode NVARCHAR(40) NULL, MaterialName NVARCHAR(200) NULL,
    Description NVARCHAR(500) NULL, UnitOfMeasure NVARCHAR(20) NULL,
    Status VARCHAR(10) NULL, RowVersionB64 VARBINARY(8) NULL)');
GO
IF TYPE_ID('dbo.PackagingPriceBatchType') IS NULL
EXEC(N'CREATE TYPE dbo.PackagingPriceBatchType AS TABLE(
    RowNum INT NOT NULL PRIMARY KEY, Command CHAR(1) NOT NULL, ID INT NULL,
    MaterialID INT NULL, CurrencyID INT NULL, PriceBasis NVARCHAR(40) NULL,
    QuantityFrom DECIMAL(18,4) NULL, QuantityTo DECIMAL(18,4) NULL,
    UnitPrice DECIMAL(18,4) NULL, EffectiveFrom DATE NULL, EffectiveTo DATE NULL,
    Status VARCHAR(10) NULL, RowVersionB64 VARBINARY(8) NULL)');
GO
IF TYPE_ID('dbo.PackagingRequestSelectionType') IS NULL
EXEC(N'CREATE TYPE dbo.PackagingRequestSelectionType AS TABLE(
    OpportunityItemID INT NOT NULL PRIMARY KEY, ExpectedRowVersion VARBINARY(8) NOT NULL,
    PackagingRequirement NVARCHAR(1000) NULL)');
GO
IF TYPE_ID('dbo.PackagingResponseBatchType') IS NULL
EXEC(N'CREATE TYPE dbo.PackagingResponseBatchType AS TABLE(
    RowNum INT NOT NULL PRIMARY KEY, ID INT NOT NULL UNIQUE,
    MaterialID INT NULL, HeightMM DECIMAL(12,2) NULL, WidthMM DECIMAL(12,2) NULL,
    LengthMM DECIMAL(12,2) NULL, Cost DECIMAL(18,4) NULL, CurrencyID INT NULL,
    CostBasis NVARCHAR(40) NULL, ResponseNotes NVARCHAR(1000) NULL,
    RowVersionB64 VARBINARY(8) NOT NULL)');
GO
