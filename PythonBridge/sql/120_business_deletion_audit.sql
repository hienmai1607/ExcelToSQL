-- Business deletion audit only. Admin masters and immutable history are not deletion targets.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.BusinessDeletionAudit','U') IS NULL
 CREATE TABLE dbo.BusinessDeletionAudit(
  ID BIGINT IDENTITY PRIMARY KEY,
  EntityKey NVARCHAR(40) NOT NULL,
  RecordID INT NOT NULL,
  DeletedRowVersion BINARY(8) NOT NULL,
  RecordLabel NVARCHAR(250) NULL,
  DeletedBy INT NOT NULL REFERENCES dbo.Users(ID),
  DeletedAt DATETIME2(3) NOT NULL CONSTRAINT DF_BusinessDeletionAudit_At DEFAULT SYSUTCDATETIME()
 );
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
