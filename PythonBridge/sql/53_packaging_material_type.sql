USE [test];
GO
-- After 52. Optional FK assignment; existing materials remain unassigned.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.PackagingMaterial','PackagingTypeID') IS NULL
 ALTER TABLE dbo.PackagingMaterial ADD PackagingTypeID INT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_PackagingMaterial_PackagingType')
 ALTER TABLE dbo.PackagingMaterial WITH CHECK ADD CONSTRAINT FK_PackagingMaterial_PackagingType
 FOREIGN KEY(PackagingTypeID) REFERENCES dbo.PackagingType(ID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PackagingMaterial') AND name='IX_PackagingMaterial_PackagingType')
 CREATE INDEX IX_PackagingMaterial_PackagingType ON dbo.PackagingMaterial(PackagingTypeID);
GO
IF TYPE_ID('dbo.PackagingMaterialBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.PackagingMaterialBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,MaterialCode NVARCHAR(40),MaterialName NVARCHAR(200),
 Description NVARCHAR(500),UnitOfMeasure NVARCHAR(20),Status VARCHAR(10),RowVersionB64 VARBINARY(8),
 PackagingTypeID INT,PackagingTypeSet BIT)');
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingMaterial_BatchV2
    @Rows dbo.PackagingMaterialBatchTypeV2 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Code NVARCHAR(40),@Name NVARCHAR(200),@Description NVARCHAR(500),@Unit NVARCHAR(20),@Status VARCHAR(10),@TypeID INT,@TypeSet BIT;
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,NULLIF(LTRIM(RTRIM(MaterialCode)),N''),NULLIF(LTRIM(RTRIM(MaterialName)),N''),Description,NULLIF(LTRIM(RTRIM(UnitOfMeasure)),N''),Status,PackagingTypeID,PackagingTypeSet FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status,@TypeID,@TypeSet;
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
                IF @Command='U' AND COALESCE(@TypeSet,0)=0
                    SELECT @TypeID=PackagingTypeID FROM dbo.PackagingMaterial WHERE ID=@ID;
                IF @TypeID IS NOT NULL AND NOT EXISTS(
                    SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@TypeID
                    AND (Status='Active' OR (@Command='U' AND EXISTS(
                        SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND PackagingTypeID=@TypeID))))
                    THROW 51111,'Choose an active Packaging Type from Packaging Type Master.',1;

                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingMaterial WHERE ID=@ID;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Name IS NULL OR @Unit IS NULL THROW 51110,'Material Name and Unit of Measure are required.',1;
                IF NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=@Unit AND
                 (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND UnitOfMeasure=@Unit))))
                 THROW 51111,'Choose an active Unit of Measure from UoM Master.',1;
            END;
            IF @Command IN('U','D') AND @Code IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND MaterialCode COLLATE Latin1_General_100_BIN2<>@Code COLLATE Latin1_General_100_BIN2)
                THROW 51110,'Material code is read-only.',1;
            IF @Command='C'
            BEGIN
                IF @Code IS NOT NULL THROW 51110,'Material code is generated automatically. Leave it blank.',1;
                DECLARE @Number BIGINT;
                SET @Number=NEXT VALUE FOR dbo.PackagingMaterialCodeSequence;
                SET @Code='PKG-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                WHILE EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE MaterialCode=@Code)
                BEGIN
                    SET @Number=NEXT VALUE FOR dbo.PackagingMaterialCodeSequence;
                    SET @Code='PKG-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                END;
                INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,Description,UnitOfMeasure,Status,CreatedBy,PackagingTypeID)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Code,@Name,@Description,@Unit,COALESCE(@Status,'Active'),@ActorID,@TypeID);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingMaterial SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingMaterial SET MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit,PackagingTypeID=@TypeID,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
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
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status,@TypeID,@TypeSet;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT r.*,m.MaterialCode AS NewMaterialCode FROM @Result r LEFT JOIN dbo.PackagingMaterial m ON m.ID=r.NewID ORDER BY r.RowNum;
END;
GO

