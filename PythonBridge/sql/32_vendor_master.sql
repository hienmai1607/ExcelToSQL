USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.Vendor','U') IS NULL
 CREATE TABLE dbo.Vendor(
 ID INT IDENTITY PRIMARY KEY,VendorName NVARCHAR(200) NOT NULL UNIQUE,
 Address NVARCHAR(500) NULL,Status VARCHAR(10) NOT NULL DEFAULT 'Active',
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2(3) NULL,RowVersion ROWVERSION,
 CONSTRAINT CK_Vendor_Name CHECK(LEN(LTRIM(RTRIM(VendorName)))>0),
 CONSTRAINT CK_Vendor_Status CHECK(Status IN('Active','Block')));
IF COL_LENGTH('dbo.PackagingPrice','VendorID') IS NULL
 ALTER TABLE dbo.PackagingPrice ADD VendorID INT NULL REFERENCES dbo.Vendor(ID);
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PackagingPrice') AND name='IX_PackagingPrice_Vendor')
 CREATE INDEX IX_PackagingPrice_Vendor ON dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,VendorID,Status,EffectiveFrom);
IF TYPE_ID('dbo.VendorBatchType') IS NULL
 EXEC(N'CREATE TYPE dbo.VendorBatchType AS TABLE(RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1) NOT NULL,ID INT NULL,VendorName NVARCHAR(200),Address NVARCHAR(500),Status VARCHAR(10),RowVersionB64 VARBINARY(8))');
IF TYPE_ID('dbo.PackagingPriceBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.PackagingPriceBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1) NOT NULL,ID INT NULL,
 MaterialID INT,CurrencyID INT,PriceBasis NVARCHAR(40),QuantityFrom DECIMAL(18,4),QuantityTo DECIMAL(18,4),
 UnitPrice DECIMAL(18,4),EffectiveFrom DATE,EffectiveTo DATE,Status VARCHAR(10),RowVersionB64 VARBINARY(8),VendorID INT)');
GO
CREATE OR ALTER PROCEDURE dbo.usp_Vendor_Batch @Rows dbo.VendorBatchType READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
 IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1) THROW 51106,'Duplicate record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd CHAR(1),@ID INT,@Name NVARCHAR(200),@Address NVARCHAR(500),@Status VARCHAR(10),@RV VARBINARY(8),@Own BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(VendorName)),''),NULLIF(LTRIM(RTRIM(Address)),''),Status,RowVersionB64 FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@Address,@Status,@RV;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION VendorRow;
   IF @Cmd NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D' AND @Name IS NULL THROW 51110,'Vendor name is required.',1;
   IF @Status IS NOT NULL AND @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
   IF @Cmd='C'
    INSERT dbo.Vendor(VendorName,Address,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Name,@Address,COALESCE(@Status,'Active'),@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.Vendor SET Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.Vendor SET VendorName=@Name,Address=@Address,Status=COALESCE(@Status,Status),UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION VendorRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@Address,@Status,@RV;
 END
 CLOSE c;DEALLOCATE c;SELECT * FROM @Result ORDER BY RowNum;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_BatchV2
    @Rows dbo.PackagingPriceBatchTypeV2 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Vendor INT,@Material INT,@Currency INT,@Basis NVARCHAR(40),@QFrom DECIMAL(18,4),@QTo DECIMAL(18,4),@Price DECIMAL(18,4),@From DATE,@To DATE,@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,MaterialID,CurrencyID,NULLIF(LTRIM(RTRIM(PriceBasis)),N''),QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,VendorID FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Vendor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Vendor AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingPrice WHERE ID=@ID AND VendorID=@Vendor))))
                    THROW 51112,'Choose an active Vendor.',1;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @Currency IS NULL OR @Basis IS NULL OR @QFrom IS NULL OR @Price IS NULL OR @From IS NULL
                        THROW 51111,'Currency, basis, quantity from, price and effective from are required.',1;
                    IF NOT EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Material AND Status='Active')
                        THROW 51112,'Active Packaging Material is required.',1;
                    /* Half-open quantity intervals [from,to); inclusive effective dates. */
                    IF COALESCE(@Status,'Active')='Active' AND EXISTS(
                        SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                        WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis AND (VendorID=@Vendor OR (VendorID IS NULL AND @Vendor IS NULL))
                          AND Status='Active' AND (@Command='C' OR ID<>@ID)
                          AND (@To IS NULL OR EffectiveFrom<=@To)
                          AND (EffectiveTo IS NULL OR @From<=EffectiveTo)
                          AND (@QTo IS NULL OR QuantityFrom<@QTo)
                          AND (QuantityTo IS NULL OR @QFrom<QuantityTo))
                        THROW 51113,'Active price date and quantity ranges overlap.',1;
            END;
            IF @Command='C'
            BEGIN
                INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy,VendorID)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID,@Vendor);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingPrice SET VendorID=@Vendor,MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            IF @OwnTran=1 COMMIT;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingRow;
            ELSE IF XACT_STATE()=-1 THROW;
            DELETE @Result WHERE RowNum=@RowNum;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),@ID,NULL);
        END CATCH;
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO


-- Existing clients keep their original TVP and preserve an existing Vendor on update.
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_Batch @Rows dbo.PackagingPriceBatchType READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @New dbo.PackagingPriceBatchTypeV2;
 INSERT @New SELECT r.*,CASE WHEN r.Command='C' THEN NULL ELSE p.VendorID END
 FROM @Rows r LEFT JOIN dbo.PackagingPrice p ON p.ID=r.ID;
 EXEC dbo.usp_PackagingPrice_BatchV2 @New,@Username;
END
GO
