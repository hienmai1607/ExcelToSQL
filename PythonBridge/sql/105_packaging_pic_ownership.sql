-- Apply after migration 104, in the application database.
-- No user/role records are changed. All definitions update atomically.
-- Persist safe module settings even when SQLCMD starts with them OFF.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.WorkspaceRoleScope','U') IS NULL
  OR OBJECT_ID('dbo.fn_WorkspaceAccess','FN') IS NULL
  THROW 52996,'Apply migration 104 before Packaging PIC ownership.',1;

 EXEC sys.sp_executesql N'
 CREATE OR ALTER FUNCTION dbo.fn_PackagingPICMember(@UserID INT)
 RETURNS BIT AS
 BEGIN
  DECLARE @Allowed BIT=0;
  IF EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@UserID AND IsActive=1)
  AND EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@UserID AND Scope=N''Packaging'')
  AND (dbo.fn_WorkspaceAccess(@UserID,''requests'',1)=1
   OR EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=@UserID AND a.Scope=N''Packaging''
    AND NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRoleScope d WHERE d.UserID=a.UserID AND d.Scope=a.Scope)))
   SET @Allowed=1;
  RETURN @Allowed;
 END;';
 EXEC sys.sp_executesql N'
 CREATE OR ALTER FUNCTION dbo.fn_PackagingManagerAccess(@UserID INT)
 RETURNS BIT AS
 BEGIN
  DECLARE @Allowed BIT=0;
  IF EXISTS(SELECT 1 FROM dbo.Users WHERE ID=@UserID AND IsActive=1)
  AND (EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@UserID AND Scope=N''Admin'')
   OR EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=@UserID AND a.Scope=N''PackagingManager''
    AND NOT EXISTS(SELECT 1 FROM dbo.WorkspaceRoleScope d WHERE d.UserID=a.UserID AND d.Scope=a.Scope)))
   SET @Allowed=1;
  RETURN @Allowed;
 END;';

 -- Patch existing audited implementations, preserving all later response fields,
 -- validation, transactions, optimistic concurrency, mix behavior and audit hooks.
 DECLARE @P SYSNAME,@Old NVARCHAR(MAX),@New NVARCHAR(MAX),@D NVARCHAR(MAX),@NeedsAlter BIT;
 DECLARE changes CURSOR LOCAL FAST_FORWARD FOR SELECT * FROM (VALUES
 (N'dbo.usp_Packaging_Authorize',
  N'(@Action=''Review'' AND Scope=N''PackagingManager'')',
  N'(@Action=''Review'' AND Scope=N''PackagingManager'' AND dbo.fn_PackagingManagerAccess(@ActorID)=1)'),
 (N'dbo.usp_PackagingRequestItem_Assign_AuditImplementation',
  N'a.Scope IN(N''Packaging'',N''Admin'')',
  N'a.Scope=N''Packaging'' AND dbo.fn_PackagingPICMember(u.ID)=1'),
 (N'dbo.usp_PackagingRequestItem_Assign_AuditImplementation',
  N'PIC must be active with Packaging or Admin access.',
  N'PIC must be an active Packaging member with Packaging Request edit access.'),
 (N'dbo.usp_PackagingResponse_Batch_AuditImplementation',
  N'(i.PICUserID=@ActorID OR @IsAdmin=1)',
  N'(i.PICUserID=@ActorID AND (@IsAdmin=1 OR dbo.fn_PackagingPICMember(@ActorID)=1))'),
 (N'dbo.usp_PackagingRequestItem_Transition_AuditImplementation',
  N'IF @IsAdmin=0 AND @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID)',
  N'IF @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID OR (@IsAdmin=0 AND dbo.fn_PackagingPICMember(@ActorID)=0))'),
 (N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation',
  N'(@Admin=1 OR PICUserID=@Actor)',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))'),
 (N'dbo.usp_PkgPricing_ItemAuthorize',
  N'(@Admin=1 OR PICUserID=@Actor)',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))'),
 (N'dbo.usp_PkgPricing_ItemAuthorize',
  N'Only the assigned PIC or Admin can save pricing on an unlocked item.',
  N'Only the assigned PIC can save pricing on an unlocked item.'),
 (N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation',
  N'Only the assigned PIC or Admin can edit an unlocked response.',
  N'Only the assigned PIC can edit an unlocked response.')
 ) v(ProcedureName,OldText,NewText);
 OPEN changes;
 FETCH NEXT FROM changes INTO @P,@Old,@New;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @D=OBJECT_DEFINITION(OBJECT_ID(@P));
  IF @D IS NULL THROW 52996,'Required Packaging procedure missing; apply earlier migrations.',1;
  SET @NeedsAlter=0;
  IF CHARINDEX(@New,@D)=0 AND CHARINDEX(N'-- Admin response ownership override (113)',@D)=0
  BEGIN
   IF CHARINDEX(@Old,@D)=0 THROW 52996,'Unexpected Packaging authorization definition; migration rolled back.',1;
   SET @D=REPLACE(@D,@Old,@New);
   SET @NeedsAlter=1;
  END;
  -- Reapplying also repairs previously captured OFF settings without
  -- changing the already-patched ownership rules or any business data.
  IF @NeedsAlter=1 OR EXISTS(SELECT 1 FROM sys.sql_modules
   WHERE object_id=OBJECT_ID(@P) AND (uses_quoted_identifier=0 OR uses_ansi_nulls=0))
  BEGIN
   SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
   EXEC sys.sp_executesql @D;
  END;
  FETCH NEXT FROM changes INTO @P,@Old,@New;
 END;
 CLOSE changes;
 DEALLOCATE changes;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
