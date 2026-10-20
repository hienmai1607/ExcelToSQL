-- Private user feedback: reports are not approved training examples or facts.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH(N'dbo.LocalAIChatTurn',N'Feedback') IS NULL
 ALTER TABLE dbo.LocalAIChatTurn ADD Feedback NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.LocalAIChatTurn',N'FeedbackUpdatedAt') IS NULL
 ALTER TABLE dbo.LocalAIChatTurn ADD FeedbackUpdatedAt DATETIME2 NULL;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.LocalAIChatTurn') AND name=N'CK_LocalAIChatTurn_Feedback')
 EXEC(N'ALTER TABLE dbo.LocalAIChatTurn ADD CONSTRAINT CK_LocalAIChatTurn_Feedback CHECK(DATALENGTH(Feedback)<=8000);');
COMMIT;
