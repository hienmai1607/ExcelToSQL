USE [test];
GO
IF OBJECT_ID(N'dbo.PackagingItemAttachment',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.PackagingItemAttachment(
  ID UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  ItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
  OriginalName NVARCHAR(255) NOT NULL,
  StorageProvider VARCHAR(20) NOT NULL DEFAULT('local'),
  StorageKey VARCHAR(36) NOT NULL UNIQUE,
  ContentType VARCHAR(100) NOT NULL,
  SizeBytes BIGINT NOT NULL CHECK(SizeBytes BETWEEN 1 AND 10485760),
  SHA256 CHAR(64) NOT NULL,
  UploadedBy INT NOT NULL REFERENCES dbo.Users(ID),
  UploadedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME())
 );
 CREATE INDEX IX_PackagingAttachment_Item ON dbo.PackagingItemAttachment(ItemID,UploadedAt);
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingAttachment_Authorize
 @Username NVARCHAR(100), @ItemID INT, @ForWrite BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT,@Stage VARCHAR(20),@PIC INT,@Requester INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Read',@Actor OUTPUT;
 SELECT @Stage=i.Stage,@PIC=i.PICUserID,@Requester=h.RequestedBy
 FROM dbo.PackagingConfigurationRequestItem i
 JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID WHERE i.ID=@ItemID;
 IF @Stage IS NULL THROW 51201,'Packaging item not found.',1;
 IF @ForWrite=1
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND
   (Scope IN(N'Admin',N'PackagingManager') OR
   (Scope=N'Packaging' AND @PIC=@Actor) OR (Scope=N'Opportunity' AND @Requester=@Actor)))
   THROW 51202,'Only the requester, assigned PIC, PackagingManager or Admin may upload.',1;
  IF @Stage NOT IN('Assigned','Working','Returned')
   THROW 51203,'Attachments are locked for this item stage.',1;
 END;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingAttachment_Read
 @Username NVARCHAR(100), @ItemID INT, @ID UNIQUEIDENTIFIER=NULL
AS
BEGIN
 SET NOCOUNT ON;
 EXEC dbo.usp_PackagingAttachment_Authorize @Username,@ItemID,0;
 SELECT a.*,u.UserName AS UploadedByName FROM dbo.PackagingItemAttachment a
 JOIN dbo.Users u ON u.ID=a.UploadedBy
 WHERE a.ItemID=@ItemID AND (@ID IS NULL OR a.ID=@ID) ORDER BY a.UploadedAt,a.ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingAttachment_Save
 @Username NVARCHAR(100),@ItemID INT,@ID UNIQUEIDENTIFIER,
 @OriginalName NVARCHAR(255),@StorageKey VARCHAR(36),@ContentType VARCHAR(100),
 @SizeBytes BIGINT,@SHA256 CHAR(64)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 BEGIN TRY
  BEGIN TRANSACTION;
  -- Serialize attachment additions and stage transitions on the same item.
  DECLARE @LockedID INT;
  SELECT @LockedID=ID FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ItemID;
  EXEC dbo.usp_PackagingAttachment_Authorize @Username,@ItemID,1;
  IF EXISTS(SELECT 1 FROM dbo.PackagingItemAttachment WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID)
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.PackagingItemAttachment WHERE ID=@ID AND ItemID=@ItemID
     AND OriginalName=@OriginalName AND SizeBytes=@SizeBytes AND SHA256=@SHA256 AND ContentType=@ContentType)
     THROW 51204,'Upload key already belongs to a different file.',1;
  END
  ELSE
  BEGIN
   IF (SELECT COUNT(*) FROM dbo.PackagingItemAttachment WHERE ItemID=@ItemID)>=20
    THROW 51205,'Maximum 20 attachments per item.',1;
   INSERT dbo.PackagingItemAttachment(ID,ItemID,OriginalName,StorageKey,ContentType,SizeBytes,SHA256,UploadedBy)
   SELECT @ID,@ItemID,@OriginalName,@StorageKey,@ContentType,@SizeBytes,@SHA256,ID
   FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
  END
  COMMIT;
 END TRY
 BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK;
  THROW;
 END CATCH;
 EXEC dbo.usp_PackagingAttachment_Read @Username,@ItemID,@ID;
END;
GO
