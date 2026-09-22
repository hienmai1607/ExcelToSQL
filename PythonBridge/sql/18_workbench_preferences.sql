USE [test]
GO
IF OBJECT_ID(N'dbo.WorkbenchPreference',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.WorkbenchPreference(
  UserID INT NOT NULL CONSTRAINT FK_WorkbenchPreference_User REFERENCES dbo.Users(ID),
  PreferenceKey VARCHAR(30) NOT NULL,
  Settings NVARCHAR(MAX) NOT NULL,
  Version INT NOT NULL CONSTRAINT DF_WorkbenchPreference_Version DEFAULT 1,
  UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_WorkbenchPreference_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_WorkbenchPreference PRIMARY KEY(UserID,PreferenceKey),
  CONSTRAINT CK_WorkbenchPreference_Json CHECK(ISJSON(Settings)=1)
 );
END
GO

