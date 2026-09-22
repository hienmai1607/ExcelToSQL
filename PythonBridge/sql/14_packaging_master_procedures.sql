USE [test];
GO
/* Admin may perform all Packaging actions; active user validation still applies. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Packaging_Authorize
    @Username NVARCHAR(100), @Action VARCHAR(20), @ActorID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @ActorID=NULL;
    SELECT @ActorID=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
    IF @ActorID IS NULL THROW 51101,'Username is incorrect.',1;
    IF @Action IN('Maintain','Review','Request','Read','MasterRead','Access')
       AND EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND Scope=N'Admin')
        RETURN;
    IF NOT EXISTS(
        SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND (
            (@Action='Maintain' AND Scope=N'Packaging') OR
            (@Action='Review' AND Scope=N'PackagingManager') OR
            (@Action='Request' AND Scope IN(N'Opportunity',N'Admin')) OR
            (@Action='Read' AND Scope IN(N'Packaging',N'PackagingManager',N'Opportunity',N'Admin')) OR
            (@Action='MasterRead' AND Scope IN(N'Packaging',N'PackagingManager',N'Admin')) OR
            (@Action='Access' AND Scope=N'Admin')))
    BEGIN
        DECLARE @Message NVARCHAR(200)=CASE @Action
            WHEN 'Maintain' THEN N'Packaging access is required for this action.'
            WHEN 'Review' THEN N'PackagingManager access is required for this action.'
            WHEN 'Request' THEN N'Opportunity access is required for this action.'
            WHEN 'Access' THEN N'Admin access is required for this action.'
            ELSE N'Packaging read access is required for this action.' END;
        THROW 51102,@Message,1;
    END;
END;
GO
/* Transitional SQL access management until API/Admin workbook scope lists expand. */
CREATE OR ALTER PROCEDURE dbo.usp_Packaging_Access_Set
    @Username NVARCHAR(100), @UserID INT, @Scope NVARCHAR(50), @Enabled BIT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Access',@ActorID OUTPUT;
    IF @Scope IS NULL OR @Scope NOT IN(N'Packaging',N'PackagingManager') OR @Enabled IS NULL
        THROW 51103,'Specify Packaging or PackagingManager and Enabled.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS(SELECT 1 FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE ID=@UserID AND IsActive=1)
            THROW 51104,'User not found or inactive.',1;
        IF @Enabled=1 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WITH(UPDLOCK,HOLDLOCK) WHERE UserID=@UserID AND Scope=@Scope)
            INSERT dbo.UserAccess(UserID,Scope) VALUES(@UserID,@Scope);
        ELSE IF @Enabled=0 DELETE dbo.UserAccess WHERE UserID=@UserID AND Scope=@Scope;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingMaterial_Batch
    @Rows dbo.PackagingMaterialBatchType READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
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
                SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingMaterial WHERE ID=@ID;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Code IS NULL OR @Name IS NULL OR @Unit IS NULL THROW 51110,'Material Code, Name and Unit of Measure are required.',1;
            END;
            IF @Command='C'
            BEGIN
                INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,Description,UnitOfMeasure,Status,CreatedBy)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Code,@Name,@Description,@Unit,COALESCE(@Status,'Active'),@ActorID);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingMaterial SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingMaterial SET MaterialCode=@Code,MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
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
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_Batch
    @Rows dbo.PackagingPriceBatchType READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Material INT,@Currency INT,@Basis NVARCHAR(40),@QFrom DECIMAL(18,4),@QTo DECIMAL(18,4),@Price DECIMAL(18,4),@From DATE,@To DATE,@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,MaterialID,CurrencyID,NULLIF(LTRIM(RTRIM(PriceBasis)),N''),QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status;
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
                        WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis
                          AND Status='Active' AND (@Command='C' OR ID<>@ID)
                          AND (@To IS NULL OR EffectiveFrom<=@To)
                          AND (EffectiveTo IS NULL OR @From<=EffectiveTo)
                          AND (@QTo IS NULL OR QuantityFrom<@QTo)
                          AND (QuantityTo IS NULL OR @QFrom<QuantityTo))
                        THROW 51113,'Active price date and quantity ranges overlap.',1;
            END;
            IF @Command='C'
            BEGIN
                INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingPrice SET MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
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
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingMaterial_Read
    @Username NVARCHAR(100), @Search NVARCHAR(200)=NULL, @Status VARCHAR(10)=NULL,
    @PageNumber INT=1, @PageSize INT=200
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@ActorID OUTPUT;
    IF @PageNumber IS NULL OR @PageNumber<1 OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 500
        THROW 51114,'Page number must be positive; page size must be 1-500.',1;
    SELECT *,COUNT_BIG(*) OVER() AS TotalMatchingRows
    FROM dbo.PackagingMaterial
    WHERE (@Status IS NULL OR Status=@Status)
      AND (@Search IS NULL OR MaterialCode LIKE @Search+'%' OR MaterialName LIKE @Search+'%')
    ORDER BY MaterialCode,ID
    OFFSET (CONVERT(BIGINT,@PageNumber)-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_Read
    @Username NVARCHAR(100), @MaterialID INT=NULL, @CurrencyID INT=NULL,
    @AsOf DATE=NULL, @Quantity DECIMAL(18,4)=NULL, @Status VARCHAR(10)=NULL,
    @PageNumber INT=1, @PageSize INT=200
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@ActorID OUTPUT;
    IF @PageNumber IS NULL OR @PageNumber<1 OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 500
        THROW 51114,'Page number must be positive; page size must be 1-500.',1;
    SELECT p.*,m.MaterialCode,c.CurrencyCode,COUNT_BIG(*) OVER() AS TotalMatchingRows
    FROM dbo.PackagingPrice p
    JOIN dbo.PackagingMaterial m ON m.ID=p.MaterialID
    JOIN dbo.Currency c ON c.ID=p.CurrencyID
    WHERE (@MaterialID IS NULL OR p.MaterialID=@MaterialID)
      AND (@CurrencyID IS NULL OR p.CurrencyID=@CurrencyID)
      AND (@Status IS NULL OR p.Status=@Status)
      AND (@AsOf IS NULL OR (p.EffectiveFrom<=@AsOf AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=@AsOf)))
      AND (@Quantity IS NULL OR (p.QuantityFrom<=@Quantity AND (p.QuantityTo IS NULL OR p.QuantityTo>@Quantity)))
    ORDER BY p.MaterialID,p.CurrencyID,p.PriceBasis,p.EffectiveFrom,p.QuantityFrom,p.ID
    OFFSET (CONVERT(BIGINT,@PageNumber)-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
GO
