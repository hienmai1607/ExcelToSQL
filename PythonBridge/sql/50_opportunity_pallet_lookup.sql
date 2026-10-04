USE [test];
GO
-- After 49. Sales can choose pallets without access to Pallet Master maintenance.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityPalletLookup_Read
 @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT p.ID,p.PalletSize
 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID
 WHERE p.Status='Active' AND u.Status='Active'
 ORDER BY p.PalletSize,p.ID;
END;
GO
