-- Apply after 96 in the intended application database.
-- Additive migration: preserves Product.Category strings, IDs and history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.Product','U') IS NULL OR COL_LENGTH('dbo.Product','Category') IS NULL
 OR OBJECT_ID('dbo.Users','U') IS NULL OR OBJECT_ID('dbo.UserAccess','U') IS NULL
 THROW 52964,'Apply the existing Product migrations before Category Master.',1;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ProductCategory','U') IS NULL
BEGIN
 CREATE TABLE dbo.ProductCategory(
  ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductCategory PRIMARY KEY,
  CategoryName NVARCHAR(100) COLLATE Latin1_General_100_CI_AS NOT NULL,
  Status VARCHAR(10) NOT NULL CONSTRAINT DF_ProductCategory_Status DEFAULT 'Active',
  CreatedBy INT NULL CONSTRAINT FK_ProductCategory_CreatedBy REFERENCES dbo.Users(ID),
  CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_ProductCategory_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL CONSTRAINT FK_ProductCategory_UpdatedBy REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT UQ_ProductCategory_Name UNIQUE(CategoryName),
  CONSTRAINT CK_ProductCategory_Status CHECK(Status IN('Active','Block')),
  CONSTRAINT CK_ProductCategory_Name CHECK(LEN(LTRIM(RTRIM(CategoryName)))>0)
 );
END;
-- Seed legacy names only; rerunning must not reactivate blocked categories.
INSERT dbo.ProductCategory(CategoryName)
 SELECT MIN(LTRIM(RTRIM(p.Category)) COLLATE Latin1_General_100_CI_AS)
 FROM dbo.Product p
 WHERE NULLIF(LTRIM(RTRIM(p.Category)),N'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM dbo.ProductCategory c WITH(UPDLOCK,HOLDLOCK)
  WHERE c.CategoryName=LTRIM(RTRIM(p.Category)) COLLATE Latin1_General_100_CI_AS)
 GROUP BY LTRIM(RTRIM(p.Category)) COLLATE Latin1_General_100_CI_AS;
COMMIT;
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductCategory_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),
 @CategoryName NVARCHAR(100),@Status VARCHAR(10)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldName NVARCHAR(100);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain categories.',1;
 SET @CategoryName=LTRIM(RTRIM(@CategoryName));
 IF NULLIF(@CategoryName,N'') IS NULL OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 52964,'Enter a Category name and valid status.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  IF @ID IS NOT NULL
  BEGIN
   SELECT @OldName=CategoryName FROM dbo.ProductCategory WITH(UPDLOCK,HOLDLOCK)
    WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
   IF @OldName IS NULL THROW 52997,'Category changed. Refresh and retry.',1;
   IF @OldName COLLATE Latin1_General_100_BIN2<>@CategoryName COLLATE Latin1_General_100_BIN2
    AND EXISTS(SELECT 1 FROM dbo.Product WITH(HOLDLOCK)
      WHERE LTRIM(RTRIM(Category)) COLLATE Latin1_General_100_CI_AS=@OldName COLLATE Latin1_General_100_CI_AS)
    THROW 52964,'This Category is used by Products. Create a new Category instead of renaming it.',1;
  END;
  IF EXISTS(SELECT 1 FROM dbo.ProductCategory WITH(UPDLOCK,HOLDLOCK)
    WHERE CategoryName=@CategoryName COLLATE Latin1_General_100_CI_AS AND (@ID IS NULL OR ID<>@ID))
   THROW 52964,'That Category name already exists.',1;
  IF @ID IS NULL
  BEGIN
   INSERT dbo.ProductCategory(CategoryName,Status,CreatedBy) VALUES(@CategoryName,@Status,@Actor);
   SET @ID=CONVERT(INT,SCOPE_IDENTITY());
  END ELSE
   UPDATE dbo.ProductCategory SET CategoryName=@CategoryName,Status=@Status,
    UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
  COMMIT;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK;
  THROW;
 END CATCH;
 SELECT ID,CategoryName,Status,RowVersion FROM dbo.ProductCategory WHERE ID=@ID;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_Product_CategoryMaster ON dbo.Product AFTER INSERT,UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 -- Base Product inserts initially have NULL Category; enriched batch writes it
 -- in the same transaction. Blank legacy values may remain unchanged.
 IF NOT UPDATE(Category) RETURN;
 IF EXISTS(
  SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  WHERE NULLIF(LTRIM(RTRIM(i.Category)),N'') IS NOT NULL
   AND (d.ID IS NULL OR ISNULL(LTRIM(RTRIM(i.Category)),N'') COLLATE Latin1_General_100_CI_AS
     <>ISNULL(LTRIM(RTRIM(d.Category)),N'') COLLATE Latin1_General_100_CI_AS)
   AND NOT EXISTS(SELECT 1 FROM dbo.ProductCategory c WITH(HOLDLOCK)
     WHERE c.CategoryName=LTRIM(RTRIM(i.Category)) COLLATE Latin1_General_100_CI_AS AND c.Status='Active')
 )
  THROW 52964,'Choose an active Category from Category Master.',1;
END;
GO
