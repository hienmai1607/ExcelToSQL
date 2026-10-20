-- After 127. Reusable child Packaging Types; legacy ParentTypeID retains the first link.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.PackagingTypeParent','U') IS NULL
 CREATE TABLE dbo.PackagingTypeParent(
  PackagingTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  ParentTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  CONSTRAINT PK_PackagingTypeParent PRIMARY KEY(PackagingTypeID,ParentTypeID),
  CONSTRAINT CK_PackagingTypeParent_NotSelf CHECK(PackagingTypeID<>ParentTypeID));
 EXEC(N'CREATE OR ALTER VIEW dbo.v_PackagingTypeEdges AS
 SELECT ID PackagingTypeID,ParentTypeID FROM dbo.PackagingType WHERE ParentTypeID IS NOT NULL
 UNION SELECT PackagingTypeID,ParentTypeID FROM dbo.PackagingTypeParent;');
 EXEC(N'CREATE OR ALTER FUNCTION dbo.fn_PackagingTypeUnder(@Child INT,@Ancestor INT)
 RETURNS BIT AS BEGIN
  DECLARE @Seen TABLE(ID INT PRIMARY KEY);DECLARE @Next TABLE(ID INT PRIMARY KEY);
  INSERT @Seen VALUES(@Child);INSERT @Next VALUES(@Child);
  WHILE EXISTS(SELECT 1 FROM @Next) BEGIN
   IF EXISTS(SELECT 1 FROM @Next WHERE ID=@Ancestor) RETURN 1;
   DECLARE @More TABLE(ID INT PRIMARY KEY);DELETE @More;
   INSERT @More SELECT DISTINCT e.ParentTypeID FROM dbo.v_PackagingTypeEdges e JOIN @Next n ON n.ID=e.PackagingTypeID
    WHERE NOT EXISTS(SELECT 1 FROM @Seen s WHERE s.ID=e.ParentTypeID);
   DELETE @Next;INSERT @Next SELECT ID FROM @More;INSERT @Seen SELECT ID FROM @More;
  END;RETURN 0;
 END;');
 EXEC(N'CREATE OR ALTER TRIGGER dbo.tr_PackagingTypeParent_Graph ON dbo.PackagingTypeParent AFTER INSERT,UPDATE AS
 BEGIN
  SET NOCOUNT ON;
  DECLARE @Lock INT;
  EXEC @Lock=sys.sp_getapplock @Resource=N''PackagingTypeHierarchy'',@LockMode=''Exclusive'',@LockOwner=''Transaction'',@LockTimeout=10000;
  IF @Lock<0 THROW 51108,''Packaging Type hierarchy is busy. Retry.'',1;
  IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.PackagingType p ON p.ID=i.ParentTypeID
   WHERE p.FinalComponent=1 OR p.PackagingOrder=N''Pallet'' OR dbo.fn_PackagingTypeUnder(i.ParentTypeID,i.PackagingTypeID)=1)
   THROW 51111,''Parent links cannot create cycles or use Single/Pallet parents.'',1;
 END;');
 -- Decorate existing one-row-per-type views rather than multiplying catalog records.
 DECLARE @Web NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.v_PackagingTypeWeb'));
 IF CHARINDEX('ParentTypeIDsJSON',@Web)=0 BEGIN
  SET @Web=REPLACE(@Web,'SELECT p.*,','SELECT p.*,
   (SELECT N''[''+STRING_AGG(CONVERT(NVARCHAR(MAX),e.ParentTypeID),N'','') WITHIN GROUP(ORDER BY e.ParentTypeID)+N'']'' FROM dbo.v_PackagingTypeEdges e WHERE e.PackagingTypeID=p.ID) ParentTypeIDsJSON,
   (SELECT STRING_AGG(CONVERT(NVARCHAR(MAX),q.PackagingType),N''; '') WITHIN GROUP(ORDER BY q.PackagingType) FROM dbo.v_PackagingTypeEdges e JOIN dbo.PackagingType q ON q.ID=e.ParentTypeID WHERE e.PackagingTypeID=p.ID) ParentTypes,');
  SET @Web=REPLACE(@Web,'FROM dbo.PackagingType c WHERE c.ParentTypeID=p.ID','FROM dbo.v_PackagingTypeEdges c WHERE c.ParentTypeID=p.ID');
  SET @Web=STUFF(@Web,1,CHARINDEX('VIEW',UPPER(@Web))+3,'ALTER VIEW');EXEC(@Web);
 END;
 SET @Web=OBJECT_DEFINITION(OBJECT_ID('dbo.v_PackagingTypeWeb'));
 IF CHARINDEX('ParentTypeNamesJSON',@Web)=0 BEGIN
  SET @Web=REPLACE(@Web,'SELECT p.*,','SELECT p.*,
   (SELECT q.PackagingType AS Name FROM dbo.v_PackagingTypeEdges e JOIN dbo.PackagingType q ON q.ID=e.ParentTypeID
    WHERE e.PackagingTypeID=p.ID ORDER BY q.PackagingType FOR JSON PATH) ParentTypeNamesJSON,');
  SET @Web=STUFF(@Web,1,CHARINDEX('VIEW',UPPER(@Web))+3,'ALTER VIEW');EXEC(@Web);
 END;
 -- Save all links in the existing per-row transaction and hierarchy lock.
 DECLARE @D NVARCHAR(MAX)=REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch')),CHAR(13),'');
 IF CHARINDEX('-- Multiple parents (128)',@D)=0 BEGIN
  IF CHARINDEX('   IF @Cmd<>''D'''+CHAR(10)+'   BEGIN',@D)=0 THROW 52998,'Unexpected Packaging Type writer.',1;
  SET @D=REPLACE(@D,'DECLARE @ChosenOrders TABLE','DECLARE @Parents TABLE(ID INT PRIMARY KEY);
 DECLARE @ParentJSON NVARCHAR(MAX),@ParentsSet BIT;
 DECLARE @ChosenOrders TABLE');
  SET @D=REPLACE(@D,'   IF @Cmd<>''D'''+CHAR(10)+'   BEGIN','   -- Multiple parents (128)
   DELETE @Parents;SET @ParentsSet=0;
   SELECT @ParentsSet=1,@ParentJSON=j.value FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
    WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''ParentTypeIDs'';
   IF @ParentsSet=1 BEGIN
    IF ISJSON(@ParentJSON)<>1 OR LEFT(LTRIM(@ParentJSON),1)<>''[''
     THROW 51111,''Parent Types must be an array of distinct IDs.'',1;
    IF EXISTS(SELECT 1 FROM OPENJSON(@ParentJSON) WHERE [type]<>2 OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1)
     OR (SELECT COUNT(*) FROM OPENJSON(@ParentJSON))>100
     OR EXISTS(SELECT [value] FROM OPENJSON(@ParentJSON) GROUP BY [value] HAVING COUNT(*)>1)
     THROW 51111,''Choose up to 100 distinct Parent Types.'',1;
    INSERT @Parents SELECT CONVERT(INT,[value]) FROM OPENJSON(@ParentJSON);
    -- Keep the current first parent when possible to avoid unnecessary geometry changes.
    SELECT @Parent=ParentTypeID FROM dbo.PackagingType WHERE ID=@ID AND ParentTypeID IN(SELECT ID FROM @Parents);
    IF @Parent IS NULL OR NOT EXISTS(SELECT 1 FROM @Parents WHERE ID=@Parent) SELECT @Parent=MIN(ID) FROM @Parents;
    SET @ParentSet=1;
   END ELSE IF @Cmd=''U'' AND COALESCE(@ParentSet,0)=0
    INSERT @Parents SELECT ParentTypeID FROM dbo.v_PackagingTypeEdges WHERE PackagingTypeID=@ID;
   ELSE IF @Parent IS NOT NULL INSERT @Parents VALUES(@Parent);
   IF @Cmd<>''D''
   BEGIN
    IF EXISTS(SELECT 1 FROM @Parents x LEFT JOIN dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK) ON p.ID=x.ID
     WHERE p.ID IS NULL OR p.FinalComponent=1 OR p.PackagingOrder=N''Pallet''
      OR (p.Status<>''Active'' AND NOT EXISTS(SELECT 1 FROM dbo.v_PackagingTypeEdges e WHERE e.PackagingTypeID=@ID AND e.ParentTypeID=p.ID)))
     THROW 51111,''Choose active non-Single Parent Types.'',1;
    IF EXISTS(SELECT 1 FROM @Parents WHERE ID=@ID OR dbo.fn_PackagingTypeUnder(ID,@ID)=1)
     THROW 51111,''Parent Type cannot be this type or one of its descendants.'',1;');
  SET @D=REPLACE(@D,'IF @FinalComponent=1 AND EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ParentTypeID=@ID)',
   'IF @FinalComponent=1 AND EXISTS(SELECT 1 FROM dbo.v_PackagingTypeEdges WHERE ParentTypeID=@ID)');
  SET @D=REPLACE(@D,'   IF @Cmd=''C'''+CHAR(10)+'    INSERT dbo.PackagingType','   IF @Cmd<>''D'' AND @ID IS NOT NULL BEGIN
    DELETE dbo.PackagingTypeParent WHERE PackagingTypeID=@ID;
    INSERT dbo.PackagingTypeParent SELECT @ID,ID FROM @Parents WHERE ID<>@Parent;
   END;
   IF @Cmd=''C'''+CHAR(10)+'    INSERT dbo.PackagingType');
  SET @D=REPLACE(@D,'   IF @Own=1 COMMIT;','   IF @Cmd<>''D'' BEGIN
    SELECT @ID=NewID FROM @Result WHERE RowNum=@Row;
    IF @Cmd=''C'' INSERT dbo.PackagingTypeParent SELECT @ID,ID FROM @Parents WHERE ID<>@Parent;
    IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID
     WHERE dbo.fn_PackagingTypeUnder(d.PackagingTypeID,p.PackagingTypeID)=0)
     THROW 51111,''Remap child dimension definitions before removing a parent link.'',1;
   END;
   IF @Own=1 COMMIT;');
  SET @D=STUFF(@D,1,CHARINDEX('PROCEDURE',UPPER(@D))+8,'ALTER PROCEDURE');EXEC(@D);
 END;
 -- Geometry is tied to an explicit root dimension, not the arbitrary first parent.
 DECLARE @Name SYSNAME,@Body NVARCHAR(MAX);
 DECLARE fixes CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.objects WHERE name IN(
  'tr_PackagingDimension_ParentGeometry','tr_PackagingType_ShippingDimensions','tr_PackagingType_FinalComponent');
 OPEN fixes;FETCH NEXT FROM fixes INTO @Name;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @Body=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
  SET @Body=REPLACE(@Body,'p.PackagingTypeID<>t.RootTypeID','(p.ID IS NOT NULL AND dbo.fn_PackagingTypeUnder(t.ID,p.PackagingTypeID)=0)');
  SET @Body=REPLACE(@Body,'JOIN dbo.PackagingType c WITH(UPDLOCK,HOLDLOCK) ON c.ParentTypeID=i.ID','JOIN dbo.v_PackagingTypeEdges c ON c.ParentTypeID=i.ID');
  SET @Body=STUFF(@Body,1,CHARINDEX('TRIGGER',UPPER(@Body))+6,'ALTER TRIGGER');EXEC(@Body);
  FETCH NEXT FROM fixes INTO @Name;
 END;CLOSE fixes;DEALLOCATE fixes;
 SET @Body=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_SaveV2'));
 IF CHARINDEX('-- Parent context (128)',@Body)=0 BEGIN
  IF CHARINDEX('IF @Root IS NULL',@Body)=0 THROW 52998,'Unexpected dimension writer.',1;
  SET @Body=REPLACE(@Body,'IF @Root IS NULL','-- Parent context (128)
 IF @Root<>@PackagingTypeID AND @ParentDimensionID IS NOT NULL
  SELECT @Root=p.PackagingTypeID FROM dbo.PackagingDimension p
   WHERE p.ID=@ParentDimensionID AND p.ParentDimensionID IS NULL
    AND dbo.fn_PackagingTypeUnder(@PackagingTypeID,p.PackagingTypeID)=1;
 IF @Root IS NULL');
  SET @Body=STUFF(@Body,1,CHARINDEX('PROCEDURE',UPPER(@Body))+8,'ALTER PROCEDURE');EXEC(@Body);
 END;
 SET @Body=OBJECT_DEFINITION(OBJECT_ID('dbo.v_PackagingDimensionWeb'));
 SET @Body=REPLACE(@Body,'t.ParentTypeID,t.RootTypeID,','t.ParentTypeID,COALESCE(p.PackagingTypeID,t.RootTypeID) AS RootTypeID,');
 SET @Body=STUFF(@Body,1,CHARINDEX('VIEW',UPPER(@Body))+3,'ALTER VIEW');EXEC(@Body);
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
