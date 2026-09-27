USE [test]
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.UoM','U') IS NULL
 CREATE TABLE dbo.UoM(
 ID INT IDENTITY PRIMARY KEY,UoMCode NVARCHAR(40) NOT NULL UNIQUE,
 UoMName NVARCHAR(500) NULL,Status VARCHAR(10) NOT NULL DEFAULT 'Active',
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2(3) NULL,RowVersion ROWVERSION,
 CONSTRAINT CK_UoM_Code CHECK(LEN(LTRIM(RTRIM(UoMCode)))>0),
 CONSTRAINT CK_UoM_Status CHECK(Status IN('Active','Block')));
-- Preserve legacy labels exactly; do not guess unit conversions.
INSERT dbo.UoM(UoMCode,UoMName,CreatedBy)
 SELECT p.PriceBasis,p.PriceBasis,MIN(p.CreatedBy) FROM dbo.PackagingPrice p
 WHERE NOT EXISTS(SELECT 1 FROM dbo.UoM u WHERE u.UoMCode=p.PriceBasis)
 GROUP BY p.PriceBasis;
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_PackagingPrice_BaseUoM')
 ALTER TABLE dbo.PackagingPrice ADD CONSTRAINT FK_PackagingPrice_BaseUoM FOREIGN KEY(PriceBasis) REFERENCES dbo.UoM(UoMCode);
COMMIT;
GO
IF TYPE_ID('dbo.UoMBatchType') IS NULL
 EXEC(N'CREATE TYPE dbo.UoMBatchType AS TABLE(RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,UoMCode NVARCHAR(40),UoMName NVARCHAR(500),Status VARCHAR(10),RowVersionB64 VARBINARY(8))');
GO
CREATE OR ALTER PROCEDURE dbo.usp_UoM_Batch @Rows dbo.UoMBatchType READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 51101,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') THROW 51102,'Admin access is required for this action.',1;
 IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
 IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1) THROW 51106,'Duplicate record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd CHAR(1),@ID INT,@Name NVARCHAR(40),@UoMName NVARCHAR(500),@Status VARCHAR(10),@RV VARBINARY(8),@Own BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(UoMCode)),''),NULLIF(LTRIM(RTRIM(UoMName)),''),Status,RowVersionB64 FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@UoMName,@Status,@RV;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION UoMRow;
   IF @Cmd NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D' AND @Name IS NULL THROW 51110,'UoM name is required.',1;
   IF @Status IS NOT NULL AND @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
   IF @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingPrice p JOIN dbo.UoM u ON p.PriceBasis=u.UoMCode WHERE u.ID=@ID AND u.UoMCode<>@Name)
    THROW 51111,'Referenced UoM code cannot be changed. Change its name instead.',1;
   IF @Cmd='C'
    INSERT dbo.UoM(UoMCode,UoMName,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Name,@UoMName,COALESCE(@Status,'Active'),@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.UoM SET Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.UoM SET UoMCode=@Name,UoMName=@UoMName,Status=COALESCE(@Status,Status),UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION UoMRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@UoMName,@Status,@RV;
 END
 CLOSE c;DEALLOCATE c;SELECT * FROM @Result ORDER BY RowNum;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_BatchV3
    @Rows dbo.PackagingPriceBatchTypeV3 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Rate DECIMAL(18,10),@Vendor INT,@Material INT,@Currency INT,@Basis NVARCHAR(40),@QFrom DECIMAL(18,4),@QTo DECIMAL(18,4),@Price DECIMAL(18,4),@From DATE,@To DATE,@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,MaterialID,CurrencyID,NULLIF(LTRIM(RTRIM(PriceBasis)),N''),QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,VendorID,ExchangeRateToUSD FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate;
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
                IF @Currency IS NULL AND @Vendor IS NOT NULL SELECT @Currency=CurrencyID FROM dbo.Vendor WHERE ID=@Vendor;
                IF EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@Currency AND CurrencyCode='USD') SET @Rate=1;
                IF @Rate IS NOT NULL AND @Rate<=0 THROW 51111,'Exchange rate must be positive.',1;
                IF NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=@Basis AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingPrice WHERE ID=@ID AND PriceBasis=@Basis))))
                    THROW 51111,'Choose an active Base UoM.',1;
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
                INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy,VendorID,ExchangeRateToUSD)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID,@Vendor,@Rate);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingPrice SET ExchangeRateToUSD=@Rate,VendorID=@Vendor,MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
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
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO
