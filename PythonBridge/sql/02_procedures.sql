USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Currency_Batch]    Script Date: 9/11/2026 9:48:34 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* =======================================================================
   usp_Currency_Batch  (Admin-only)
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Currency_Batch]
    @Rows     dbo.CurrencyBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Result TABLE (
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, NewRowVersion VARBINARY(8) NULL
    );

    IF @IsAdmin = 0
    BEGIN
        INSERT INTO @Result (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'Currency is Admin-only' FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END

    DECLARE @RowNum INT, @Command CHAR(1), @ID INT, @Code CHAR(3), @Name VARCHAR(50), @ClientRV VARBINARY(8);
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum, Command, ID, CurrencyCode, CurrencyName, RowVersionB64 FROM @Rows ORDER BY RowNum;
    OPEN c;
    FETCH NEXT FROM c INTO @RowNum, @Command, @ID, @Code, @Name, @ClientRV;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        BEGIN TRY
            BEGIN TRANSACTION;
            IF @Command = 'C'
            BEGIN
                INSERT INTO dbo.Currency (CurrencyCode, CurrencyName) VALUES (@Code, @Name);
                DECLARE @NewID INT = SCOPE_IDENTITY();
                INSERT INTO @Result VALUES (@RowNum, 'OK', 'Created', @NewID, NULL);
            END
            ELSE IF @Command = 'U'
            BEGIN
                UPDATE dbo.Currency SET CurrencyCode = @Code, CurrencyName = @Name WHERE ID = @ID;
                IF @@ROWCOUNT = 0
                    INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Row not found', NULL, NULL);
                ELSE
                    INSERT INTO @Result VALUES (@RowNum, 'OK', 'Updated', @ID, NULL);
            END
            ELSE IF @Command = 'D'
            BEGIN
                DELETE FROM dbo.Currency WHERE ID = @ID;
                IF @@ROWCOUNT = 0
                    INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Row not found', NULL, NULL);
                ELSE
                    INSERT INTO @Result VALUES (@RowNum, 'OK', 'Deleted', @ID, NULL);
            END
            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            INSERT INTO @Result VALUES (@RowNum, 'ERROR', ERROR_MESSAGE(), NULL, NULL);
        END CATCH
        FETCH NEXT FROM c INTO @RowNum, @Command, @ID, @Code, @Name, @ClientRV;
    END
    CLOSE c; DEALLOCATE c;
    SELECT * FROM @Result ORDER BY RowNum;
END
GO

USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Currency_Read]    Script Date: 9/11/2026 9:49:17 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


CREATE   PROCEDURE [dbo].[usp_Currency_Read]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1000) ID, CurrencyCode, CurrencyName FROM dbo.Currency ORDER BY CurrencyName;
END
GO

USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Customer_Batch]    Script Date: 9/11/2026 9:49:45 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Market_Batch]    Script Date: 9/11/2026 9:50:05 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* =======================================================================
   usp_Market_Batch  (Admin-only)
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Market_Batch]
    @Rows     dbo.MarketBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Result TABLE (
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, NewRowVersion VARBINARY(8) NULL
    );

    IF @IsAdmin = 0
    BEGIN
        INSERT INTO @Result (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'Market is Admin-only' FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END

    DECLARE @RowNum INT, @Command CHAR(1), @ID INT, @Code VARCHAR(10), @Name VARCHAR(100), @ClientRV VARBINARY(8);
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum, Command, ID, MarketCode, MarketName, RowVersionB64 FROM @Rows ORDER BY RowNum;
    OPEN c;
    FETCH NEXT FROM c INTO @RowNum, @Command, @ID, @Code, @Name, @ClientRV;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        BEGIN TRY
            BEGIN TRANSACTION;
            IF @Command = 'C'
            BEGIN
                INSERT INTO dbo.Market (MarketCode, MarketName) VALUES (@Code, @Name);
                DECLARE @NewID INT = SCOPE_IDENTITY();
                INSERT INTO @Result VALUES (@RowNum, 'OK', 'Created', @NewID, NULL);
            END
            ELSE IF @Command = 'U'
            BEGIN
                UPDATE dbo.Market SET MarketCode = @Code, MarketName = @Name WHERE ID = @ID;
                IF @@ROWCOUNT = 0
                    INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Row not found', NULL, NULL);
                ELSE
                    INSERT INTO @Result VALUES (@RowNum, 'OK', 'Updated', @ID, NULL);
            END
            ELSE IF @Command = 'D'
            BEGIN
                DELETE FROM dbo.Market WHERE ID = @ID;
                IF @@ROWCOUNT = 0
                    INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Row not found', NULL, NULL);
                ELSE
                    INSERT INTO @Result VALUES (@RowNum, 'OK', 'Deleted', @ID, NULL);
            END
            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            INSERT INTO @Result VALUES (@RowNum, 'ERROR', ERROR_MESSAGE(), NULL, NULL);
        END CATCH
        FETCH NEXT FROM c INTO @RowNum, @Command, @ID, @Code, @Name, @ClientRV;
    END
    CLOSE c; DEALLOCATE c;
    SELECT * FROM @Result ORDER BY RowNum;
END
GO
USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Market_Read]    Script Date: 9/11/2026 9:50:21 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* =======================================================================
   usp_Market_Read / usp_Currency_Read
   Read access is intentionally OPEN to any authenticated user (not
   Admin-only like the write procs) — everyone needs to see valid
   Market/Currency options to fill dropdowns even though only Admins can
   change them. Small reference tables; no pagination needed, but capped
   defensively anyway.
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Market_Read]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1000) ID, MarketCode, MarketName FROM dbo.Market ORDER BY MarketName;
END
GO


/* =======================================================================
   usp_Customer_Batch
   Updated from the earlier free-text design: MarketID/CurrencyID are now
   validated FKs, not free text. Scope = 'Customer' matches your real
   UserAccess data.
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Customer_Batch]
    @Rows     dbo.CustomerBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Result TABLE (
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, NewRowVersion VARBINARY(8) NULL
    );

    -- Audit columns are INT foreign keys to dbo.Users, so resolve the
    -- authenticated user once rather than writing the username text.
    DECLARE @UserID INT;
    SELECT @UserID = ID
    FROM dbo.Users
    WHERE UserName = @Username AND IsActive = 1;

    IF @UserID IS NULL
    BEGIN
        INSERT INTO @Result (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'Unknown or inactive user' FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END

    IF @IsAdmin = 0 AND NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.ID = ua.UserID
        WHERE u.UserName = @Username AND u.IsActive = 1 AND ua.Scope = 'Customer'
    )
    BEGIN
        INSERT INTO @Result (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'User not authorized for Customer entity' FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END

    DECLARE @RowNum INT, @Command CHAR(1), @ID INT, @Name VARCHAR(200), @MktID INT, @CcyID INT,
            @Status VARCHAR(10), @ClientRV VARBINARY(8);
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum, Command, ID, CustomerName, MarketID, CurrencyID, Status, RowVersionB64
        FROM @Rows ORDER BY RowNum;
    OPEN c;
    FETCH NEXT FROM c INTO @RowNum, @Command, @ID, @Name, @MktID, @CcyID, @Status, @ClientRV;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        BEGIN TRY
            BEGIN TRANSACTION;

            IF @Command IN ('C', 'U') AND NOT EXISTS (SELECT 1 FROM dbo.Market WHERE ID = @MktID)
            BEGIN
                INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Invalid Market ID', NULL, NULL);
            END
            ELSE IF @Command IN ('C', 'U') AND NOT EXISTS (SELECT 1 FROM dbo.Currency WHERE ID = @CcyID)
            BEGIN
                INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Invalid Currency ID', NULL, NULL);
            END
            ELSE IF @Command = 'C'
            BEGIN
                INSERT INTO dbo.Customer (CustomerName, MarketID, CurrencyID, Status, CreatedBy)
                VALUES (@Name, @MktID, @CcyID, COALESCE(NULLIF(@Status, ''), 'Active'), @UserID);

                DECLARE @NewID INT = SCOPE_IDENTITY();
                DECLARE @NewRV VARBINARY(8) = (SELECT RowVersion FROM dbo.Customer WHERE ID = @NewID);
                INSERT INTO @Result VALUES (@RowNum, 'OK', 'Created', @NewID, @NewRV);
            END
            ELSE IF @Command = 'U'
            BEGIN
                UPDATE dbo.Customer
                SET CustomerName = @Name, MarketID = @MktID, CurrencyID = @CcyID,
                    Status = COALESCE(NULLIF(@Status, ''), Status), UpdatedBy = @UserID, UpdatedAt = SYSUTCDATETIME()
                WHERE ID = @ID AND RowVersion = @ClientRV;

                IF @@ROWCOUNT = 0
                BEGIN
                    IF EXISTS (SELECT 1 FROM dbo.Customer WHERE ID = @ID)
                        INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Concurrency conflict', NULL, NULL);
                    ELSE
                        INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Row not found', NULL, NULL);
                END
                ELSE
                    INSERT INTO @Result
                        SELECT @RowNum, 'OK', 'Updated', ID, RowVersion FROM dbo.Customer WHERE ID = @ID;
            END
            ELSE IF @Command = 'D'
            BEGIN
                DELETE FROM dbo.Customer WHERE ID = @ID AND RowVersion = @ClientRV;
                IF @@ROWCOUNT = 0
                    INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Concurrency conflict or not found', NULL, NULL);
                ELSE
                    INSERT INTO @Result VALUES (@RowNum, 'OK', 'Deleted', @ID, NULL);
            END

            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            INSERT INTO @Result VALUES (@RowNum, 'ERROR', ERROR_MESSAGE(), NULL, NULL);
        END CATCH
        FETCH NEXT FROM c INTO @RowNum, @Command, @ID, @Name, @MktID, @CcyID, @Status, @ClientRV;
    END
    CLOSE c; DEALLOCATE c;
    SELECT * FROM @Result ORDER BY RowNum;
END
GO
USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Customer_Read]    Script Date: 9/11/2026 9:51:21 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* =======================================================================
   usp_Customer_Read
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Customer_Read]
    @Username    NVARCHAR(100),
    @IsAdmin     BIT = 0,
    @CustomerName VARCHAR(200) = NULL,
    @MarketID    INT = NULL,
    @Status      VARCHAR(10) = NULL,
    @PageNumber  INT = 1,
    @PageSize    INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize > 500 SET @PageSize = 500;
    IF @PageSize < 1 SET @PageSize = 1;
    IF @PageNumber < 1 SET @PageNumber = 1;

    IF @IsAdmin = 0 AND NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.ID = ua.UserID
        WHERE u.UserName = @Username AND u.IsActive = 1
          AND ua.Scope IN ('Customer', 'Opportunity')
    )
    BEGIN
        SELECT CAST(NULL AS INT) AS ID WHERE 1 = 0;  -- empty result set, not an error — matches read semantics
        RETURN;
    END

    -- Return user-facing codes as well as the internal keys.  The Excel
    -- sheet displays the codes; MarketID, CurrencyID, ID and RowVersion are
    -- retained in hidden columns for later update/delete requests.
    SELECT
        c.ID, c.CustomerName, c.MarketID, m.MarketCode,
        c.CurrencyID, cur.CurrencyCode,
        c.Status, c.CreatedAt, c.CreatedBy, c.UpdatedAt, c.UpdatedBy, c.RowVersion,
        COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Customer c
    JOIN dbo.Market m ON m.ID = c.MarketID
    JOIN dbo.Currency cur ON cur.ID = c.CurrencyID
    WHERE (@CustomerName IS NULL OR c.CustomerName LIKE @CustomerName + '%')
      AND (@MarketID IS NULL OR c.MarketID = @MarketID)
      AND (@Status IS NULL OR c.Status = @Status)
    ORDER BY c.CustomerName
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Opportunity_HeaderDetail_Batch]    Script Date: 9/11/2026 9:51:51 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* =======================================================================
   usp_Opportunity_HeaderDetail_Batch
   Processes Header rows and Item rows in ONE transaction per call, so a
   Create that includes both header and items either fully succeeds or
   fully rolls back — items are matched to their header via
   OpportunityNumber within the same batch (temp Ref problem from the
   old design is avoided: the number is generated server-side, not
   scanned from a column).
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Opportunity_HeaderDetail_Batch]
    @HeaderRows dbo.OpportunityHeaderBatchType READONLY,
    @ItemRows   dbo.OpportunityItemBatchType READONLY,
    @Username   NVARCHAR(100),
    @IsAdmin    BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @HeaderResult TABLE (
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, OpportunityNumber VARCHAR(20) NULL, NewRowVersion VARBINARY(8) NULL
    );
    DECLARE @ItemResult TABLE (
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, NewRowVersion VARBINARY(8) NULL
    );

    -- CreatedBy and UpdatedBy reference dbo.Users(ID), not UserName.
    DECLARE @UserID INT;
    SELECT @UserID = ID
    FROM dbo.Users
    WHERE UserName = @Username AND IsActive = 1;

    IF @UserID IS NULL
    BEGIN
        INSERT INTO @HeaderResult (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'Unknown or inactive user' FROM @HeaderRows;
        INSERT INTO @ItemResult (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'Unknown or inactive user' FROM @ItemRows;
        SELECT * FROM @HeaderResult ORDER BY RowNum;
        SELECT * FROM @ItemResult ORDER BY RowNum;
        RETURN;
    END

    -- Whole-batch authorization: Opportunity scope is entity-level, not
    -- Market/Customer-scoped (per actual UserAccess data — Scope = 'Opportunity').
    IF @IsAdmin = 0 AND NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.ID = ua.UserID
        WHERE u.UserName = @Username AND u.IsActive = 1 AND ua.Scope = 'Opportunity'
    )
    BEGIN
        INSERT INTO @HeaderResult (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'User not authorized for Opportunity entity' FROM @HeaderRows;
        INSERT INTO @ItemResult (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'User not authorized for Opportunity entity' FROM @ItemRows;
        SELECT * FROM @HeaderResult ORDER BY RowNum;
        SELECT * FROM @ItemResult ORDER BY RowNum;
        RETURN;
    END

    -- Map of OpportunityNumber -> resolved OpportunityID for this batch,
    -- so newly created headers are immediately usable by item rows below.
    DECLARE @NumberToID TABLE (OpportunityNumber VARCHAR(20) PRIMARY KEY, OpportunityID INT);

    BEGIN TRY
        BEGIN TRANSACTION;

        /* ---- Header rows ---- */
        DECLARE @HRowNum INT, @HCmd CHAR(1), @HID INT, @HNumber VARCHAR(20), @CustID INT,
                @Desc VARCHAR(300), @BOpen DATE, @BClose DATE, @Stage VARCHAR(20), @HClientRV VARBINARY(8);

        DECLARE h_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT RowNum, Command, ID, OpportunityNumber, CustomerID, OpportunityDesc,
                   BidOpen, BidClose, Stage, RowVersionB64
            FROM @HeaderRows ORDER BY RowNum;

        OPEN h_cursor;
        FETCH NEXT FROM h_cursor INTO @HRowNum, @HCmd, @HID, @HNumber, @CustID, @Desc, @BOpen, @BClose, @Stage, @HClientRV;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            IF @HCmd = 'C'
            BEGIN
                -- A sequence is safe under concurrent saves; MAX(ID)+1 is not.
                DECLARE @GenNumber VARCHAR(20) =
                    'OPP-' + CAST(YEAR(SYSUTCDATETIME()) AS VARCHAR(4)) + '-' +
                    RIGHT('00000' + CAST(NEXT VALUE FOR dbo.OpportunityNumberSequence AS VARCHAR(10)), 5);

                INSERT INTO dbo.Opportunity (OpportunityNumber, CustomerID, OpportunityDesc, BidOpen, BidClose, Stage, CreatedBy)
                VALUES (@GenNumber, @CustID, @Desc, @BOpen, @BClose, ISNULL(@Stage,'Draft'), @UserID);

                DECLARE @NewOppID INT = SCOPE_IDENTITY();
                DECLARE @NewOppRV VARBINARY(8) = (SELECT RowVersion FROM dbo.Opportunity WHERE ID = @NewOppID);

                INSERT INTO @NumberToID VALUES (@GenNumber, @NewOppID);
                -- Also register the client's placeholder OpportunityNumber (if the
                -- header row arrived with one, e.g. "NEW1" typed by the user in
                -- Excel before the real number exists) so that Item rows in the
                -- SAME BATCH referencing that placeholder resolve correctly. The
                -- placeholder itself is never stored — only @GenNumber is.
                IF @HNumber IS NOT NULL AND @HNumber <> ''
                    INSERT INTO @NumberToID VALUES (@HNumber, @NewOppID);
                INSERT INTO @HeaderResult VALUES (@HRowNum, 'OK', 'Created', @NewOppID, @GenNumber, @NewOppRV);
            END
            ELSE IF @HCmd = 'U'
            BEGIN
                UPDATE dbo.Opportunity
                SET CustomerID = @CustID, OpportunityDesc = @Desc, BidOpen = @BOpen,
                    BidClose = @BClose, Stage = ISNULL(@Stage, Stage),
                    UpdatedBy = @UserID, UpdatedAt = SYSUTCDATETIME()
                WHERE ID = @HID AND RowVersion = @HClientRV;

                IF @@ROWCOUNT = 0
                BEGIN
                    IF EXISTS (SELECT 1 FROM dbo.Opportunity WHERE ID = @HID)
                        INSERT INTO @HeaderResult VALUES (@HRowNum, 'ERROR', 'Concurrency conflict', NULL, NULL, NULL);
                    ELSE
                        INSERT INTO @HeaderResult VALUES (@HRowNum, 'ERROR', 'Row not found', NULL, NULL, NULL);
                END
                ELSE
                BEGIN
                    INSERT INTO @NumberToID SELECT OpportunityNumber, ID FROM dbo.Opportunity WHERE ID = @HID;
                    INSERT INTO @HeaderResult
                        SELECT @HRowNum, 'OK', 'Updated', ID, OpportunityNumber, RowVersion
                        FROM dbo.Opportunity WHERE ID = @HID;
                END
            END
            ELSE IF @HCmd = 'D'
            BEGIN
                DELETE FROM dbo.Opportunity WHERE ID = @HID AND RowVersion = @HClientRV;
                IF @@ROWCOUNT = 0
                    INSERT INTO @HeaderResult VALUES (@HRowNum, 'ERROR', 'Concurrency conflict or not found', NULL, NULL, NULL);
                ELSE
                    INSERT INTO @HeaderResult VALUES (@HRowNum, 'OK', 'Deleted', @HID, NULL, NULL);
            END

            FETCH NEXT FROM h_cursor INTO @HRowNum, @HCmd, @HID, @HNumber, @CustID, @Desc, @BOpen, @BClose, @Stage, @HClientRV;
        END
        CLOSE h_cursor;
        DEALLOCATE h_cursor;

        -- Bail out before touching items if any header row failed —
        -- keeps the header+items create atomic as designed.
        IF EXISTS (SELECT 1 FROM @HeaderResult WHERE Status = 'ERROR')
        BEGIN
            ROLLBACK TRANSACTION;
            -- A preceding header may have reported Created/Updated before a
            -- later header failed. None of those writes survived the rollback.
            UPDATE @HeaderResult
            SET Status = 'ERROR', Message = 'Rolled back — header batch failed',
                NewID = NULL, OpportunityNumber = NULL, NewRowVersion = NULL;
            SELECT * FROM @HeaderResult ORDER BY RowNum;
            SELECT RowNum, 'ERROR' AS Status, 'Skipped — header batch failed' AS Message, NULL AS NewID, NULL AS NewRowVersion
            FROM @ItemRows ORDER BY RowNum;
            RETURN;
        END

        /* ---- Item rows ---- */
        DECLARE @IRowNum INT, @ICmd CHAR(1), @IID INT, @INumber VARCHAR(20), @ProdID INT,
                @IDesc VARCHAR(300), @AnnUnit INT, @Pct DECIMAL(5,2), @Shelf DECIMAL(10,2),
                @IStage VARCHAR(20), @IClientRV VARBINARY(8);

        DECLARE i_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT RowNum, Command, ID, OpportunityNumber, ProductID, ItemDescription,
                   AnnualUnit, EstPctAwarded, ShelfPrice, Stage, RowVersionB64
            FROM @ItemRows ORDER BY RowNum;

        OPEN i_cursor;
        FETCH NEXT FROM i_cursor INTO @IRowNum, @ICmd, @IID, @INumber, @ProdID, @IDesc, @AnnUnit, @Pct, @Shelf, @IStage, @IClientRV;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            DECLARE @ResolvedOppID INT = (SELECT OpportunityID FROM @NumberToID WHERE OpportunityNumber = @INumber);
            IF @ResolvedOppID IS NULL
                SELECT @ResolvedOppID = ID FROM dbo.Opportunity WHERE OpportunityNumber = @INumber;

            IF @ResolvedOppID IS NULL
            BEGIN
                INSERT INTO @ItemResult VALUES (@IRowNum, 'ERROR', 'Opportunity Number not found in batch or database', NULL, NULL);
            END
            ELSE IF @ICmd = 'C'
            BEGIN
                INSERT INTO dbo.OpportunityItem (OpportunityID, ProductID, ItemDescription, AnnualUnit, EstPctAwarded, ShelfPrice, Stage, CreatedBy)
                VALUES (
                    @ResolvedOppID, @ProdID, @IDesc, @AnnUnit,
                    NULLIF(@Pct, CAST(-999.99 AS DECIMAL(5,2))),
                    NULLIF(@Shelf, CAST(-99999999.99 AS DECIMAL(10,2))),
                    ISNULL(@IStage,'Draft'), @UserID
                );

                DECLARE @NewItemID INT = SCOPE_IDENTITY();
                DECLARE @NewItemRV VARBINARY(8) = (SELECT RowVersion FROM dbo.OpportunityItem WHERE ID = @NewItemID);
                INSERT INTO @ItemResult VALUES (@IRowNum, 'OK', 'Created', @NewItemID, @NewItemRV);
            END
            ELSE IF @ICmd = 'U'
            BEGIN
                UPDATE dbo.OpportunityItem
                SET ProductID = @ProdID, ItemDescription = @IDesc, AnnualUnit = @AnnUnit,
                    EstPctAwarded = NULLIF(@Pct, CAST(-999.99 AS DECIMAL(5,2))),
                    ShelfPrice = NULLIF(@Shelf, CAST(-99999999.99 AS DECIMAL(10,2))),
                    Stage = ISNULL(@IStage, Stage),
                    UpdatedBy = @UserID, UpdatedAt = SYSUTCDATETIME()
                WHERE ID = @IID AND RowVersion = @IClientRV;

                IF @@ROWCOUNT = 0
                BEGIN
                    IF EXISTS (SELECT 1 FROM dbo.OpportunityItem WHERE ID = @IID)
                        INSERT INTO @ItemResult VALUES (@IRowNum, 'ERROR', 'Concurrency conflict', NULL, NULL);
                    ELSE
                        INSERT INTO @ItemResult VALUES (@IRowNum, 'ERROR', 'Row not found', NULL, NULL);
                END
                ELSE
                    INSERT INTO @ItemResult
                        SELECT @IRowNum, 'OK', 'Updated', ID, RowVersion FROM dbo.OpportunityItem WHERE ID = @IID;
            END
            ELSE IF @ICmd = 'D'
            BEGIN
                DELETE FROM dbo.OpportunityItem WHERE ID = @IID AND RowVersion = @IClientRV;
                IF @@ROWCOUNT = 0
                    INSERT INTO @ItemResult VALUES (@IRowNum, 'ERROR', 'Concurrency conflict or not found', NULL, NULL);
                ELSE
                    INSERT INTO @ItemResult VALUES (@IRowNum, 'OK', 'Deleted', @IID, NULL);
            END

            FETCH NEXT FROM i_cursor INTO @IRowNum, @ICmd, @IID, @INumber, @ProdID, @IDesc, @AnnUnit, @Pct, @Shelf, @IStage, @IClientRV;
        END
        CLOSE i_cursor;
        DEALLOCATE i_cursor;

        IF EXISTS (SELECT 1 FROM @ItemResult WHERE Status = 'ERROR')
        BEGIN
            ROLLBACK TRANSACTION;
            -- Never return an OK result for a write that was rolled back.
            UPDATE @HeaderResult
            SET Status = 'ERROR', Message = 'Rolled back — an item row failed',
                NewID = NULL, OpportunityNumber = NULL, NewRowVersion = NULL;
            UPDATE @ItemResult
            SET Status = 'ERROR', Message = 'Rolled back — an item row failed',
                NewID = NULL, NewRowVersion = NULL;
        END
        ELSE
        BEGIN
            COMMIT TRANSACTION;
        END

        SELECT * FROM @HeaderResult ORDER BY RowNum;
        SELECT * FROM @ItemResult ORDER BY RowNum;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @Err VARCHAR(500) = ERROR_MESSAGE();
        -- A SQL exception also rolls back every prior row, including those
        -- which had already been recorded as OK in the table variable.
        DELETE FROM @HeaderResult;
        INSERT INTO @HeaderResult
            SELECT RowNum, 'ERROR', @Err, NULL, NULL, NULL FROM @HeaderRows;
        SELECT * FROM @HeaderResult ORDER BY RowNum;
        DELETE FROM @ItemResult;
        INSERT INTO @ItemResult
            SELECT RowNum, 'ERROR', @Err, NULL, NULL FROM @ItemRows;
        SELECT * FROM @ItemResult ORDER BY RowNum;
    END CATCH
END
GO


/* =======================================================================
   usp_Opportunity_Read
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Opportunity_Read]
    @Username         NVARCHAR(100),
    @IsAdmin          BIT = 0,
    @OpportunityNumber VARCHAR(20) = NULL,   -- exact match when provided
    @CustomerID       INT = NULL,
    @Stage            VARCHAR(20) = NULL,
    @BidOpenFrom      DATE = NULL,
    @BidOpenTo        DATE = NULL,
    @PageNumber       INT = 1,
    @PageSize         INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize > 500 SET @PageSize = 500;
    IF @PageSize < 1 SET @PageSize = 1;
    IF @PageNumber < 1 SET @PageNumber = 1;

    IF @IsAdmin = 0 AND NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.ID = ua.UserID
        WHERE u.UserName = @Username AND u.IsActive = 1 AND ua.Scope = 'Opportunity'
    )
    BEGIN
        SELECT CAST(NULL AS INT) AS ID WHERE 1 = 0;
        RETURN;
    END

    SELECT
        o.ID, o.OpportunityNumber, o.CustomerID, c.CustomerName, o.OpportunityDesc,
        o.BidOpen, o.BidClose, o.Stage,
        o.CreatedAt, o.CreatedBy, o.UpdatedAt, o.UpdatedBy, o.RowVersion,
        COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Opportunity o
    JOIN dbo.Customer c ON c.ID = o.CustomerID
    WHERE (@OpportunityNumber IS NULL OR o.OpportunityNumber = @OpportunityNumber)
      AND (@CustomerID IS NULL OR o.CustomerID = @CustomerID)
      AND (@Stage IS NULL OR o.Stage = @Stage)
      AND (@BidOpenFrom IS NULL OR o.BidOpen >= @BidOpenFrom)
      AND (@BidOpenTo IS NULL OR o.BidOpen <= @BidOpenTo)
    ORDER BY o.BidOpen DESC, o.OpportunityNumber
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Product_Batch]    Script Date: 9/11/2026 10:07:59 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* ---------- Result row shape shared by both procs ---------------------
   RowNum, Status ('OK'/'ERROR'), Message, NewID (for Create),
   NewRowVersion (for Excel to store for the next edit cycle)          */

/* =======================================================================
   usp_Product_Batch
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Product_Batch]
    @Rows       dbo.ProductBatchType READONLY,
    @Username   NVARCHAR(100),
    @IsAdmin    BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Result TABLE (
        RowNum        INT,
        Status        VARCHAR(10),
        Message       VARCHAR(500),
        NewID         INT NULL,
        NewRowVersion VARBINARY(8) NULL
    );

    -- CreatedBy and UpdatedBy reference dbo.Users(ID), not UserName.
    DECLARE @UserID INT;
    SELECT @UserID = ID
    FROM dbo.Users
    WHERE UserName = @Username AND IsActive = 1;

    IF @UserID IS NULL
    BEGIN
        INSERT INTO @Result (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'Unknown or inactive user' FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END

    IF @IsAdmin = 0 AND NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.ID = ua.UserID
        WHERE u.UserName = @Username AND u.IsActive = 1 AND ua.Scope = 'Product'
    )
    BEGIN
        INSERT INTO @Result (RowNum, Status, Message)
        SELECT RowNum, 'ERROR', 'User not authorized for Product entity'
        FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END

    DECLARE @RowNum INT, @Command CHAR(1), @ID INT, @Code VARCHAR(20), @Name VARCHAR(200),
            @WeightValue DECIMAL(10,4), @WeightUnit VARCHAR(2), @WeightGrams DECIMAL(10,2), @ClientRV VARBINARY(8);

    DECLARE row_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum, Command, ID, ProductCode, ProductName, WeightValue, WeightUnit, RowVersionB64
        FROM @Rows ORDER BY RowNum;

    OPEN row_cursor;
    FETCH NEXT FROM row_cursor INTO @RowNum, @Command, @ID, @Code, @Name, @WeightValue, @WeightUnit, @ClientRV;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        BEGIN TRY
            BEGIN TRANSACTION;

            -- Convert once, here, regardless of Create or Update — grams is the only
            -- unit that ever reaches the table. oz -> g factor: 1 oz = 28.3495231 g.
            SET @WeightGrams = CASE
                WHEN LOWER(ISNULL(@WeightUnit, 'g')) = 'oz' THEN ROUND(@WeightValue * 28.3495231, 2)
                ELSE ROUND(@WeightValue, 2)
            END;

            IF @Command = 'C'
            BEGIN
                INSERT INTO dbo.Product (ProductCode, ProductName, WeightGrams, CreatedBy)
                VALUES (@Code, @Name, @WeightGrams, @UserID);

                DECLARE @NewID INT = SCOPE_IDENTITY();
                DECLARE @NewRV VARBINARY(8) = (SELECT RowVersion FROM dbo.Product WHERE ID = @NewID);

                INSERT INTO @Result VALUES (@RowNum, 'OK', 'Created', @NewID, @NewRV);
            END
            ELSE IF @Command = 'U'
            BEGIN
                UPDATE dbo.Product
                SET ProductCode = @Code, ProductName = @Name, WeightGrams = @WeightGrams,
                    UpdatedBy = @UserID, UpdatedAt = SYSUTCDATETIME()
                WHERE ID = @ID AND RowVersion = @ClientRV;

                DECLARE @Rc INT = @@ROWCOUNT;   -- inline capture: avoids the sp_prepexec reset issue

                IF @Rc = 0
                BEGIN
                    IF EXISTS (SELECT 1 FROM dbo.Product WHERE ID = @ID)
                        INSERT INTO @Result VALUES (@RowNum, 'ERROR',
                            'Row changed since last read (concurrency conflict)', NULL, NULL);
                    ELSE
                        INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Row not found', NULL, NULL);
                END
                ELSE
                BEGIN
                    DECLARE @UpdRV VARBINARY(8) = (SELECT RowVersion FROM dbo.Product WHERE ID = @ID);
                    INSERT INTO @Result VALUES (@RowNum, 'OK', 'Updated', @ID, @UpdRV);
                END
            END
            ELSE IF @Command = 'D'
            BEGIN
                DELETE FROM dbo.Product WHERE ID = @ID AND RowVersion = @ClientRV;
                DECLARE @DelRc INT = @@ROWCOUNT;

                IF @DelRc = 0
                BEGIN
                    IF EXISTS (SELECT 1 FROM dbo.Product WHERE ID = @ID)
                        INSERT INTO @Result VALUES (@RowNum, 'ERROR',
                            'Row changed since last read (concurrency conflict)', NULL, NULL);
                    ELSE
                        INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Row not found', NULL, NULL);
                END
                ELSE
                    INSERT INTO @Result VALUES (@RowNum, 'OK', 'Deleted', @ID, NULL);
            END
            ELSE
            BEGIN
                INSERT INTO @Result VALUES (@RowNum, 'ERROR', 'Unknown command: ' + @Command, NULL, NULL);
            END

            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            INSERT INTO @Result VALUES (@RowNum, 'ERROR', ERROR_MESSAGE(), NULL, NULL);
        END CATCH

        FETCH NEXT FROM row_cursor INTO @RowNum, @Command, @ID, @Code, @Name, @WeightValue, @WeightUnit, @ClientRV;
    END
    CLOSE row_cursor;
    DEALLOCATE row_cursor;

    SELECT * FROM @Result ORDER BY RowNum;
END
GO

USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_Product_Read]    Script Date: 9/11/2026 10:08:09 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* =======================================================================
   usp_Product_Read
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_Product_Read]
    @ProductCode VARCHAR(20)  = NULL,
    @ProductName VARCHAR(200) = NULL,
    @PageNumber  INT = 1,
    @PageSize    INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize > 500 SET @PageSize = 500;
    IF @PageSize < 1 SET @PageSize = 1;
    IF @PageNumber < 1 SET @PageNumber = 1;

    SELECT
        ID, ProductCode, ProductName, WeightGrams, WeightOz,
        CreatedAt, CreatedBy, UpdatedAt, UpdatedBy, RowVersion,
        COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Product
    WHERE (@ProductCode IS NULL OR ProductCode LIKE @ProductCode + '%')
      AND (@ProductName IS NULL OR ProductName LIKE @ProductName + '%')
    ORDER BY ProductCode
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

USE [test]
GO

/****** Object:  StoredProcedure [dbo].[usp_OpportunityItem_ReadByOpportunity]    Script Date: 9/11/2026 10:08:24 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/* =======================================================================
   usp_OpportunityItem_ReadByOpportunity
   Items are always read in the context of ONE opportunity — natural
   filter, avoids ever scanning the whole item table. Capped defensively
   even so (an opportunity realistically has well under 1000 items).
   ======================================================================= */
CREATE   PROCEDURE [dbo].[usp_OpportunityItem_ReadByOpportunity]
    @Username         NVARCHAR(100),
    @IsAdmin          BIT = 0,
    @OpportunityNumber VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    IF @IsAdmin = 0 AND NOT EXISTS (
        SELECT 1
        FROM dbo.UserAccess AS ua
        JOIN dbo.Users AS u ON u.ID = ua.UserID
        WHERE u.UserName = @Username AND u.IsActive = 1 AND ua.Scope = 'Opportunity'
    )
    BEGIN
        SELECT CAST(NULL AS INT) AS ID WHERE 1 = 0;
        RETURN;
    END

    SELECT TOP (1000)
        oi.ID, oi.OpportunityID, o.OpportunityNumber, oi.ProductID, p.ProductCode, p.ProductName,
        oi.ItemDescription, oi.AnnualUnit, oi.EstPctAwarded, oi.ShelfPrice, oi.Stage,
        oi.CreatedAt, oi.CreatedBy, oi.UpdatedAt, oi.UpdatedBy, oi.RowVersion
    FROM dbo.OpportunityItem oi
    JOIN dbo.Opportunity o ON o.ID = oi.OpportunityID
    JOIN dbo.Product p ON p.ID = oi.ProductID
    WHERE o.OpportunityNumber = @OpportunityNumber
    ORDER BY oi.ID;
END
GO




