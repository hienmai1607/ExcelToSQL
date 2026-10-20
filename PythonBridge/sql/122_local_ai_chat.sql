-- Private, bounded conversation history. Not a model-training dataset.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.LocalAIChatTurn',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.LocalAIChatTurn(
  ID BIGINT IDENTITY PRIMARY KEY,
  UserID INT NOT NULL REFERENCES dbo.Users(ID),
  ConversationID UNIQUEIDENTIFIER NOT NULL,
  RequestID UNIQUEIDENTIFIER NOT NULL,
  RequestDigest CHAR(64) NOT NULL,
  Mode VARCHAR(10) NOT NULL,
  Source VARCHAR(20) NULL,
  Question NVARCHAR(MAX) NOT NULL,
  Result NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Result)=1),
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_LocalAIChatTurn_Request UNIQUE(UserID,RequestID)
 );
 CREATE INDEX IX_LocalAIChatTurn_Owner ON dbo.LocalAIChatTurn(UserID,ConversationID,ID);
END;
-- API limits count Unicode code points; SQL NVARCHAR(n) counts UTF-16 units.
IF COL_LENGTH(N'dbo.LocalAIChatTurn',N'Question')<>-1
 ALTER TABLE dbo.LocalAIChatTurn ALTER COLUMN Question NVARCHAR(MAX) NOT NULL;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.LocalAIChatTurn') AND name=N'CK_LocalAIChatTurn_Question')
 ALTER TABLE dbo.LocalAIChatTurn ADD CONSTRAINT CK_LocalAIChatTurn_Question CHECK(DATALENGTH(Question)<=16000);
COMMIT;
