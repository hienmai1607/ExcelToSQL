USE [test];
GO
-- Run after 37. Separate raw-material records, shared Vendor/Currency/UoM.
-- Reuse the established batch input types, not the Packaging data tables.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.CK_UserAccess_Scope','C') IS NOT NULL
 ALTER TABLE dbo.UserAccess DROP CONSTRAINT CK_UserAccess_Scope;
ALTER TABLE dbo.UserAccess WITH CHECK ADD CONSTRAINT CK_UserAccess_Scope
 CHECK(Scope IN(N'Admin',N'Customer',N'Product',N'Opportunity',N'Packaging',N'PackagingManager',N'RawMaterial'));
IF OBJECT_ID('dbo.RawMaterial','U') IS NULL
BEGIN
    CREATE TABLE dbo.RawMaterial (
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
        CONSTRAINT CK_RawMaterial_Text CHECK(LEN(LTRIM(RTRIM(MaterialCode)))>0
            AND LEN(LTRIM(RTRIM(MaterialName)))>0 AND LEN(LTRIM(RTRIM(UnitOfMeasure)))>0),
        CONSTRAINT CK_RawMaterial_Status CHECK(Status IN('Active','Block'))
    );
    CREATE INDEX IX_RawMaterial_Name ON dbo.RawMaterial(MaterialName,ID);
END;
IF OBJECT_ID('dbo.RawMaterialPrice','U') IS NULL
BEGIN
    CREATE TABLE dbo.RawMaterialPrice (
        ID INT IDENTITY PRIMARY KEY,
        MaterialID INT NOT NULL REFERENCES dbo.RawMaterial(ID),
        CurrencyID INT NOT NULL REFERENCES dbo.Currency(ID),
        VendorID INT NULL REFERENCES dbo.Vendor(ID),
        ExchangeRateToUSD DECIMAL(18,10) NULL CHECK(ExchangeRateToUSD>0),
        UnitUSDPrice AS CONVERT(DECIMAL(38,8),UnitPrice / NULLIF(ExchangeRateToUSD,0)),
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
        CONSTRAINT CK_RawMaterialPrice_Values CHECK(UnitPrice>=0 AND QuantityFrom>=0
            AND (QuantityTo IS NULL OR QuantityTo>QuantityFrom)
            AND (EffectiveTo IS NULL OR EffectiveTo>=EffectiveFrom) AND LEN(LTRIM(RTRIM(PriceBasis)))>0),
        CONSTRAINT CK_RawMaterialPrice_Status CHECK(Status IN('Active','Block'))
    );
    CREATE INDEX IX_RawMaterialPrice_Lookup ON dbo.RawMaterialPrice(MaterialID,CurrencyID,PriceBasis,Status,EffectiveFrom);
END;
COMMIT;
GO
IF OBJECT_ID('dbo.RawMaterialCodeSequence','SO') IS NULL
BEGIN
 DECLARE @Start BIGINT;
 SELECT @Start=COALESCE(MAX(TRY_CONVERT(BIGINT,SUBSTRING(MaterialCode,5,10))),0)+1
 FROM dbo.RawMaterial WHERE MaterialCode LIKE 'RAW-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND LEN(MaterialCode)=14;
 DECLARE @DDL NVARCHAR(MAX)=N'CREATE SEQUENCE dbo.RawMaterialCodeSequence AS BIGINT START WITH '+CONVERT(NVARCHAR(20),@Start)+N' INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999999 NO CYCLE CACHE 50;';
 EXEC sys.sp_executesql @DDL;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_RawMaterial_Authorize
 @Username NVARCHAR(100), @ActorID INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 SET @ActorID=NULL;
 SELECT @ActorID=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @ActorID IS NULL THROW 51101,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND Scope IN(N'Admin',N'RawMaterial'))
  THROW 51102,'RawMaterial access is required for this action.',1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_RawMaterial_Batch
    @Rows dbo.PackagingMaterialBatchType READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_RawMaterial_Authorize @Username,@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Code NVARCHAR(40),@Name NVARCHAR(200),@Description NVARCHAR(500),@Unit NVARCHAR(20),@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,NULLIF(LTRIM(RTRIM(MaterialCode)),N''),NULLIF(LTRIM(RTRIM(MaterialName)),N''),Description,NULLIF(LTRIM(RTRIM(UnitOfMeasure)),N''),Status FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.RawMaterial WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.RawMaterial WHERE ID=@ID;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Name IS NULL OR @Unit IS NULL THROW 51110,'Material Name and Unit of Measure are required.',1;
                IF NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=@Unit AND
                 (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE ID=@ID AND UnitOfMeasure=@Unit))))
                 THROW 51111,'Choose an active Unit of Measure from UoM Master.',1;
            END;
            IF @Command IN('U','D') AND @Code IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE ID=@ID AND MaterialCode COLLATE Latin1_General_100_BIN2<>@Code COLLATE Latin1_General_100_BIN2)
                THROW 51110,'Material code is read-only.',1;
            IF @Command='C'
            BEGIN
                IF @Code IS NOT NULL THROW 51110,'Material code is generated automatically. Leave it blank.',1;
                DECLARE @Number BIGINT;
                SET @Number=NEXT VALUE FOR dbo.RawMaterialCodeSequence;
                SET @Code='RAW-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                WHILE EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE MaterialCode=@Code)
                BEGIN
                    SET @Number=NEXT VALUE FOR dbo.RawMaterialCodeSequence;
                    SET @Code='RAW-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                END;
                INSERT dbo.RawMaterial(MaterialCode,MaterialName,Description,UnitOfMeasure,Status,CreatedBy)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Code,@Name,@Description,@Unit,COALESCE(@Status,'Active'),@ActorID);
            END
            ELSE IF @Command='D'
                UPDATE dbo.RawMaterial SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.RawMaterial SET MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
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
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT r.*,m.MaterialCode AS NewMaterialCode FROM @Result r LEFT JOIN dbo.RawMaterial m ON m.ID=r.NewID ORDER BY r.RowNum;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_RawMaterialPrice_BatchV3
    @Rows dbo.PackagingPriceBatchTypeV3 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_RawMaterial_Authorize @Username,@ActorID OUTPUT;
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
                SELECT 1 FROM dbo.RawMaterialPrice WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Vendor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Vendor AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.RawMaterialPrice WHERE ID=@ID AND VendorID=@Vendor))))
                    THROW 51112,'Choose an active Vendor.',1;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.RawMaterialPrice WHERE ID=@ID;
                IF @Currency IS NULL AND @Vendor IS NOT NULL SELECT @Currency=CurrencyID FROM dbo.Vendor WHERE ID=@Vendor;
                IF EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@Currency AND CurrencyCode='USD') SET @Rate=1;
                IF @Rate IS NOT NULL AND @Rate<=0 THROW 51111,'Exchange rate must be positive.',1;
                IF NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=@Basis AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.RawMaterialPrice WHERE ID=@ID AND PriceBasis=@Basis))))
                    THROW 51111,'Choose an active Base UoM.',1;
                IF @Currency IS NULL OR @Basis IS NULL OR @QFrom IS NULL OR @Price IS NULL OR @From IS NULL
                        THROW 51111,'Currency, basis, quantity from, price and effective from are required.',1;
                    IF NOT EXISTS(SELECT 1 FROM dbo.RawMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Material AND Status='Active')
                        THROW 51112,'Active Raw Material is required.',1;
                    /* Half-open quantity intervals [from,to); inclusive effective dates. */
                    IF COALESCE(@Status,'Active')='Active' AND EXISTS(
                        SELECT 1 FROM dbo.RawMaterialPrice WITH(UPDLOCK,HOLDLOCK)
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
                INSERT dbo.RawMaterialPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy,VendorID,ExchangeRateToUSD)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID,@Vendor,@Rate);
            END
            ELSE IF @Command='D'
                UPDATE dbo.RawMaterialPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.RawMaterialPrice SET ExchangeRateToUSD=@Rate,VendorID=@Vendor,MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
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
   IF @Cmd='U' AND (EXISTS(SELECT 1 FROM dbo.RawMaterialPrice p JOIN dbo.UoM u ON p.PriceBasis=u.UoMCode WHERE u.ID=@ID AND u.UoMCode<>@Name)
    OR EXISTS(SELECT 1 FROM dbo.RawMaterial m JOIN dbo.UoM u ON m.UnitOfMeasure=u.UoMCode WHERE u.ID=@ID AND u.UoMCode<>@Name)
    OR EXISTS(SELECT 1 FROM dbo.PackagingPrice p JOIN dbo.UoM u ON p.PriceBasis=u.UoMCode WHERE u.ID=@ID AND u.UoMCode<>@Name)
    OR EXISTS(SELECT 1 FROM dbo.PackagingMaterial m JOIN dbo.UoM u ON m.UnitOfMeasure=u.UoMCode WHERE u.ID=@ID AND u.UoMCode<>@Name))
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

CREATE OR ALTER PROCEDURE dbo.usp_UserAccess_Batch
 @Rows dbo.UserAccessBatchType READONLY,@Username NVARCHAR(100),@IsAdmin BIT=0
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT OFF;
 DECLARE @R TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
 DECLARE @ActorID INT;
 SELECT @ActorID=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.UserName=@Username AND u.IsActive=1;
 IF @ActorID IS NULL BEGIN INSERT @R SELECT RowNum,'ERROR','Admin access is required for this action.',NULL,NULL FROM @Rows;SELECT * FROM @R ORDER BY RowNum;RETURN;END;
 DECLARE @rn INT,@cmd CHAR(1),@aid INT,@uid INT,@scope NVARCHAR(50),@rv VARBINARY(8),@oldUid INT,@oldScope NVARCHAR(50),@OwnTran BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),AccessID,UserID,NULLIF(LTRIM(RTRIM(Scope)),N''),RowVersionB64 FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @rn,@cmd,@aid,@uid,@scope,@rv;
 WHILE @@FETCH_STATUS=0 BEGIN
  BEGIN TRY
   SET @OwnTran=0;
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @OwnTran=1;END;
   IF @cmd='C' BEGIN
    IF @scope IS NULL OR @scope NOT IN(N'Admin',N'Customer',N'Product',N'Opportunity',N'Packaging',N'PackagingManager',N'RawMaterial') THROW 51010,'Invalid Scope.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@uid AND IsActive=1) THROW 51011,'User not found or inactive.',1;
    INSERT dbo.UserAccess(UserID,Scope) VALUES(@uid,@scope);DECLARE @newaid INT=SCOPE_IDENTITY();
    INSERT @R SELECT @rn,'OK','Created',AccessID,RowVersion FROM dbo.UserAccess WHERE AccessID=@newaid;
   END ELSE IF @cmd IN('U','D') BEGIN
    SET @oldUid=NULL;SET @oldScope=NULL;SELECT @oldUid=UserID,@oldScope=Scope FROM dbo.UserAccess WHERE AccessID=@aid;
    IF @oldUid IS NULL INSERT @R VALUES(@rn,'ERROR','Row not found',NULL,NULL);
    ELSE IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE AccessID=@aid AND RowVersion=@rv) INSERT @R VALUES(@rn,'ERROR','Concurrency conflict',NULL,NULL);
    ELSE IF @oldUid=@ActorID AND @oldScope=N'Admin' AND (@cmd='D' OR @scope<>N'Admin' OR @uid<>@ActorID) INSERT @R VALUES(@rn,'ERROR','You cannot remove your own Admin access.',NULL,NULL);
    ELSE IF @oldScope=N'Admin' AND (@cmd='D' OR @scope<>N'Admin') AND
      (SELECT COUNT(*) FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope=N'Admin')<=1
      INSERT @R VALUES(@rn,'ERROR','The final active Admin access cannot be removed.',NULL,NULL);
    ELSE IF @cmd='D' BEGIN DELETE dbo.UserAccess WHERE AccessID=@aid AND RowVersion=@rv;INSERT @R VALUES(@rn,'OK','Deleted',@aid,NULL);END
    ELSE BEGIN
     IF @scope IS NULL OR @scope NOT IN(N'Admin',N'Customer',N'Product',N'Opportunity',N'Packaging',N'PackagingManager',N'RawMaterial') THROW 51012,'Invalid Scope.',1;
     IF NOT EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@uid AND IsActive=1) THROW 51013,'User not found or inactive.',1;
     UPDATE dbo.UserAccess SET UserID=@uid,Scope=@scope WHERE AccessID=@aid AND RowVersion=@rv;
     INSERT @R SELECT @rn,'OK','Updated',AccessID,RowVersion FROM dbo.UserAccess WHERE AccessID=@aid;
    END
   END ELSE INSERT @R VALUES(@rn,'ERROR','Invalid command; use C, U, or D.',NULL,NULL);
   IF @OwnTran=1 COMMIT;
  END TRY BEGIN CATCH IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;INSERT @R VALUES(@rn,'ERROR',ERROR_MESSAGE(),NULL,NULL);END CATCH;
  FETCH NEXT FROM c INTO @rn,@cmd,@aid,@uid,@scope,@rv;
 END
 CLOSE c;DEALLOCATE c;SELECT * FROM @R ORDER BY RowNum;
END
GO
