-- After 154. Recipe component configuration and captured recipe requirements.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.NPDRecipeSheet','U') IS NULL THROW 52996,'Apply migration 154 first.',1;
IF OBJECT_ID('dbo.RecipeComponent','U') IS NULL
 CREATE TABLE dbo.RecipeComponent(ID INT IDENTITY PRIMARY KEY,ComponentName NVARCHAR(100) NOT NULL UNIQUE,
  SystemKey VARCHAR(30) NULL UNIQUE,Status VARCHAR(10) NOT NULL DEFAULT 'Active' CHECK(Status IN('Active','Block')),
  CreatedBy NVARCHAR(100) NOT NULL,CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION);
-- SQL Server permits only one NULL in an ordinary unique constraint; custom components use generated keys.
IF OBJECT_ID('dbo.ProcessRecipeComponent','U') IS NULL
 CREATE TABLE dbo.ProcessRecipeComponent(ProcessID INT NOT NULL REFERENCES dbo.LossProcessMaster(ID),
  ComponentID INT NOT NULL REFERENCES dbo.RecipeComponent(ID),PRIMARY KEY(ProcessID,ComponentID));
IF COL_LENGTH('dbo.ProductGradeVersion','RequiresRecipeConfirmation') IS NULL
 ALTER TABLE dbo.ProductGradeVersion ADD RequiresRecipeConfirmation BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('dbo.NPDRecipeSheet','SeasoningLossPct') IS NULL
 ALTER TABLE dbo.NPDRecipeSheet ADD SeasoningLossPct DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK(SeasoningLossPct>=0 AND SeasoningLossPct<100);
IF COL_LENGTH('dbo.NPDRecipeRequestItem','IsLinked') IS NULL
 ALTER TABLE dbo.NPDRecipeRequestItem ADD IsLinked BIT NOT NULL DEFAULT 1;
GO
UPDATE dbo.NPDRecipeRequestItem SET IsLinked=0 WHERE IsOpen=0 AND ActiveSheetID IS NULL AND IsLinked<>0;
;WITH Links AS(SELECT ID,ROW_NUMBER() OVER(PARTITION BY OpportunityItemID ORDER BY IsOpen DESC,ID DESC) n
 FROM dbo.NPDRecipeRequestItem WHERE IsLinked=1)
 UPDATE r SET IsLinked=0 FROM dbo.NPDRecipeRequestItem r JOIN Links l ON l.ID=r.ID WHERE l.n>1;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.NPDRecipeRequestItem') AND name='UX_NPDRecipeRequestItem_Linked')
 CREATE UNIQUE INDEX UX_NPDRecipeRequestItem_Linked ON dbo.NPDRecipeRequestItem(OpportunityItemID) WHERE IsLinked=1;
INSERT dbo.RecipeComponent(ComponentName,SystemKey,CreatedBy)
 SELECT n.Name,n.SystemKey,'Migration 155' FROM(VALUES(N'Salt','Salt'),(N'Oil','Oil'),(N'Seasoning','Seasoning'))n(Name,SystemKey)
 WHERE NOT EXISTS(SELECT 1 FROM dbo.RecipeComponent c WHERE c.SystemKey=n.SystemKey);
IF NOT EXISTS(SELECT 1 FROM dbo.LossProcessMaster WHERE ProcessType=N'Seasoning')
 INSERT dbo.LossProcessMaster(ProcessType,Sequence,LossPct,Status,Shared,CreatedBy)
 SELECT N'Seasoning',1,0,'Active',0,MIN(UserID) FROM dbo.UserAccess WHERE Scope='Admin';
INSERT dbo.ProcessRecipeComponent(ProcessID,ComponentID)
 SELECT p.ID,c.ID FROM dbo.LossProcessMaster p CROSS JOIN dbo.RecipeComponent c WHERE p.ProcessType=N'Seasoning' AND c.SystemKey='Seasoning'
 AND NOT EXISTS(SELECT 1 FROM dbo.ProcessRecipeComponent existing WHERE existing.ProcessID=p.ID AND existing.ComponentID=c.ID);
-- Retain existing confirmed recipes as enabled; other existing products remain optional.
UPDATE i SET ProductGradeSnapshot=JSON_MODIFY(i.ProductGradeSnapshot,'$.RequiresRecipeConfirmation',CAST(1 AS BIT))
 FROM dbo.OpportunityItem i WHERE ISJSON(i.ProductGradeSnapshot)=1 AND EXISTS(
 SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID)
 AND JSON_VALUE(i.ProductGradeSnapshot,'$.RequiresRecipeConfirmation') IS NULL;
UPDATE i SET ProductGradeSnapshot=JSON_MODIFY(i.ProductGradeSnapshot,'$.RecipeRequirements',JSON_QUERY(
 (SELECT TOP(1) r.LaunchingDate,r.SpecialComments FROM dbo.NPDRecipeRequestItem r
  WHERE r.OpportunityItemID=i.ID AND r.IsLinked=1 ORDER BY r.ID DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)))
 FROM dbo.OpportunityItem i WHERE ISJSON(i.ProductGradeSnapshot)=1 AND JSON_QUERY(i.ProductGradeSnapshot,'$.RecipeRequirements') IS NULL
 AND EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID AND r.IsLinked=1);
UPDATE r SET GradeSnapshot=JSON_MODIFY(JSON_MODIFY(r.GradeSnapshot,'$.RequiresRecipeConfirmation',CAST(1 AS BIT)),
 '$.RecipeRequirements',JSON_QUERY(i.ProductGradeSnapshot,'$.RecipeRequirements'))
 FROM dbo.NPDRecipeRequestItem r JOIN dbo.OpportunityItem i ON i.ID=r.OpportunityItemID
 WHERE r.IsLinked=1 AND JSON_VALUE(r.GradeSnapshot,'$.RequiresRecipeConfirmation') IS NULL;
INSERT dbo.WorkspaceRolePermission(RoleID,PageKey,AccessLevel)
 SELECT r.ID,'recipe-components',p.AccessLevel FROM dbo.WorkspaceRole r
 JOIN dbo.WorkspaceRolePermission p ON p.RoleID=r.ID AND p.PageKey='loss-processes'
 WHERE NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRolePermission old WHERE old.RoleID=r.ID AND old.PageKey='recipe-components');
COMMIT TRANSACTION;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_RecipeLock ON dbo.OpportunityItem AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM inserted) RETURN;
 IF NOT (UPDATE(ProductGradeSnapshot) OR UPDATE(ProductID)) RETURN;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
   WHERE EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID AND r.IsLinked=1)
   AND (i.ProductID<>d.ProductID
    OR COALESCE(JSON_VALUE(i.ProductGradeSnapshot,'$.RequiresRecipeConfirmation'),'false')<>COALESCE(JSON_VALUE(d.ProductGradeSnapshot,'$.RequiresRecipeConfirmation'),'false')
    OR COALESCE(JSON_VALUE(i.ProductGradeSnapshot,'$.RecipeRequirements.LaunchingDate'),'')<>COALESCE(JSON_VALUE(d.ProductGradeSnapshot,'$.RecipeRequirements.LaunchingDate'),'')
    OR COALESCE(JSON_VALUE(i.ProductGradeSnapshot,'$.RecipeRequirements.SpecialComments'),'')<>COALESCE(JSON_VALUE(d.ProductGradeSnapshot,'$.RecipeRequirements.SpecialComments'),'')
    OR EXISTS(SELECT ParentID,ID,RawGradeID,RawMaterialID,Grade,RatioPct,Process FROM OPENJSON(i.ProductGradeSnapshot,'$.items')
      WITH(ParentID VARCHAR(80),ID INT,RawGradeID INT,RawMaterialID INT,Grade NVARCHAR(100),RatioPct DECIMAL(9,6),Process BIT)
      EXCEPT SELECT ParentID,ID,RawGradeID,RawMaterialID,Grade,RatioPct,Process FROM OPENJSON(d.ProductGradeSnapshot,'$.items')
      WITH(ParentID VARCHAR(80),ID INT,RawGradeID INT,RawMaterialID INT,Grade NVARCHAR(100),RatioPct DECIMAL(9,6),Process BIT))
    OR EXISTS(SELECT ParentID,ID,RawGradeID,RawMaterialID,Grade,RatioPct,Process FROM OPENJSON(d.ProductGradeSnapshot,'$.items')
      WITH(ParentID VARCHAR(80),ID INT,RawGradeID INT,RawMaterialID INT,Grade NVARCHAR(100),RatioPct DECIMAL(9,6),Process BIT)
      EXCEPT SELECT ParentID,ID,RawGradeID,RawMaterialID,Grade,RatioPct,Process FROM OPENJSON(i.ProductGradeSnapshot,'$.items')
      WITH(ParentID VARCHAR(80),ID INT,RawGradeID INT,RawMaterialID INT,Grade NVARCHAR(100),RatioPct DECIMAL(9,6),Process BIT))))
 THROW 52996,'Grades and Recipe requirements are locked by a linked Recipe Request. Close the recipe link before changing them.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_RecipeDefaults ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM inserted) RETURN;
 UPDATE target SET ProductGradeSnapshot=JSON_MODIFY(target.ProductGradeSnapshot,'$.RequiresRecipeConfirmation',CAST(1 AS BIT))
 FROM dbo.OpportunityItem target JOIN inserted i ON i.ID=target.ID
 WHERE ISJSON(target.ProductGradeSnapshot)=1 AND JSON_VALUE(target.ProductGradeSnapshot,'$.RequiresRecipeConfirmation') IS NULL
 AND EXISTS(SELECT 1 FROM dbo.ProductGradeVersion v WHERE v.ProductID=target.ProductID AND v.Status='Active' AND v.RequiresRecipeConfirmation=1);
END;
GO
