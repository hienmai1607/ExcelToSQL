USE [test]
GO

/****** Object:  UserDefinedTableType [dbo].[CurrencyBatchType]    Script Date: 9/11/2026 9:43:37 AM ******/
CREATE TYPE [dbo].[CurrencyBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[ID] [int] NULL,
	[CurrencyCode] [char](3) NULL,
	[CurrencyName] [varchar](50) NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

USE [test]
GO

/****** Object:  UserDefinedTableType [dbo].[MarketBatchType]    Script Date: 9/11/2026 9:46:10 AM ******/
CREATE TYPE [dbo].[MarketBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[ID] [int] NULL,
	[MarketCode] [varchar](10) NULL,
	[MarketName] [varchar](100) NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

USE [test]
GO

USE [test]
GO

/****** Object:  UserDefinedTableType [dbo].[CustomerBatchType]    Script Date: 9/11/2026 9:45:51 AM ******/
CREATE TYPE [dbo].[CustomerBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[ID] [int] NULL,
	[CustomerName] [varchar](200) NULL,
	[MarketID] [int] NULL,
	[CurrencyID] [int] NULL,
	[Status] [varchar](10) NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

/****** Object:  UserDefinedTableType [dbo].[OpportunityHeaderBatchType]    Script Date: 9/11/2026 9:46:42 AM ******/
CREATE TYPE [dbo].[OpportunityHeaderBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[ID] [int] NULL,
	[OpportunityNumber] [varchar](20) NULL,
	[CustomerID] [int] NULL,
	[OpportunityDesc] [varchar](300) NULL,
	[BidOpen] [date] NULL,
	[BidClose] [date] NULL,
	[Stage] [varchar](20) NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

USE [test]
GO

/****** Object:  UserDefinedTableType [dbo].[OpportunityItemBatchType]    Script Date: 9/11/2026 9:47:12 AM ******/
CREATE TYPE [dbo].[OpportunityItemBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[ID] [int] NULL,
	[OpportunityNumber] [varchar](20) NOT NULL,
	[ProductID] [int] NULL,
	[ItemDescription] [varchar](300) NULL,
	[AnnualUnit] [int] NULL,
	[EstPctAwarded] [decimal](5, 2) NULL,
	[ShelfPrice] [decimal](10, 2) NULL,
	[Stage] [varchar](20) NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

USE [test]
GO

/****** Object:  UserDefinedTableType [dbo].[ProductBatchType]    Script Date: 9/11/2026 9:47:29 AM ******/
CREATE TYPE [dbo].[ProductBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[ID] [int] NULL,
	[ProductCode] [varchar](20) NULL,
	[ProductName] [varchar](200) NULL,
	[WeightValue] [decimal](10, 4) NULL,
	[WeightUnit] [varchar](2) NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

USE [test]
GO

CREATE TYPE [dbo].[UserBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[ID] [int] NULL,
	[UserName] [nvarchar](100) NULL,
	[IsActive] [bit] NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

CREATE TYPE [dbo].[UserAccessBatchType] AS TABLE(
	[RowNum] [int] NOT NULL,
	[Command] [char](1) NOT NULL,
	[AccessID] [int] NULL,
	[UserID] [int] NULL,
	[Scope] [nvarchar](50) NULL,
	[RowVersionB64] [varbinary](8) NULL
)
GO

