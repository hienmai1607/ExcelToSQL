USE [test]
GO

/****** Object:  Table [dbo].[Currency]    Script Date: 9/11/2026 9:55:37 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Currency](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[CurrencyCode] [char](3) NOT NULL,
	[CurrencyName] [varchar](50) NOT NULL,
 CONSTRAINT [PK_Currency] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Currency_Code] UNIQUE NONCLUSTERED 
(
	[CurrencyCode] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

USE [test]
GO

/****** Object:  Table [dbo].[Customer]    Script Date: 9/11/2026 9:55:51 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Customer](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[CustomerName] [varchar](200) NOT NULL,
	[MarketID] [int] NOT NULL,
	[CurrencyID] [int] NOT NULL,
	[Status] [varchar](10) NOT NULL,
	[CreatedAt] [datetime2](7) NOT NULL,
	[CreatedBy] [int] NOT NULL,
	[UpdatedAt] [datetime2](7) NULL,
	[UpdatedBy] [int] NULL,
	[RowVersion] [timestamp] NOT NULL,
 CONSTRAINT [PK_Customer] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Customer_Name] UNIQUE NONCLUSTERED 
(
	[CustomerName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[Customer] ADD  DEFAULT ('Active') FOR [Status]
GO

ALTER TABLE [dbo].[Customer] ADD  DEFAULT (sysutcdatetime()) FOR [CreatedAt]
GO

ALTER TABLE [dbo].[Customer]  WITH CHECK ADD  CONSTRAINT [FK_Customer_CreatedBy] FOREIGN KEY([CreatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[Customer] CHECK CONSTRAINT [FK_Customer_CreatedBy]
GO

ALTER TABLE [dbo].[Customer]  WITH CHECK ADD  CONSTRAINT [FK_Customer_Currency] FOREIGN KEY([CurrencyID])
REFERENCES [dbo].[Currency] ([ID])
GO

ALTER TABLE [dbo].[Customer] CHECK CONSTRAINT [FK_Customer_Currency]
GO

ALTER TABLE [dbo].[Customer]  WITH CHECK ADD  CONSTRAINT [FK_Customer_Market] FOREIGN KEY([MarketID])
REFERENCES [dbo].[Market] ([ID])
GO

ALTER TABLE [dbo].[Customer] CHECK CONSTRAINT [FK_Customer_Market]
GO

ALTER TABLE [dbo].[Customer]  WITH CHECK ADD  CONSTRAINT [FK_Customer_UpdatedBy] FOREIGN KEY([UpdatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[Customer] CHECK CONSTRAINT [FK_Customer_UpdatedBy]
GO

ALTER TABLE [dbo].[Customer]  WITH CHECK ADD  CONSTRAINT [CK_Customer_Status] CHECK  (([Status]='Block' OR [Status]='Active'))
GO

ALTER TABLE [dbo].[Customer] CHECK CONSTRAINT [CK_Customer_Status]
GO

USE [test]
GO

/****** Object:  Table [dbo].[Market]    Script Date: 9/11/2026 9:56:03 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Market](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[MarketCode] [varchar](10) NOT NULL,
	[MarketName] [varchar](100) NOT NULL,
 CONSTRAINT [PK_Market] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Market_Code] UNIQUE NONCLUSTERED 
(
	[MarketCode] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Market_Name] UNIQUE NONCLUSTERED 
(
	[MarketName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

USE [test]
GO

/****** Object:  Table [dbo].[Opportunity]    Script Date: 9/11/2026 9:56:16 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Opportunity](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[OpportunityNumber] [varchar](20) NOT NULL,
	[CustomerID] [int] NOT NULL,
	[OpportunityDesc] [varchar](300) NOT NULL,
	[BidOpen] [date] NOT NULL,
	[BidClose] [date] NOT NULL,
	[Stage] [varchar](20) NOT NULL,
	[CreatedAt] [datetime2](7) NOT NULL,
	[CreatedBy] [int] NOT NULL,
	[UpdatedAt] [datetime2](7) NULL,
	[UpdatedBy] [int] NULL,
	[RowVersion] [timestamp] NOT NULL,
 CONSTRAINT [PK_Opportunity] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Opportunity_Number] UNIQUE NONCLUSTERED 
(
	[OpportunityNumber] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[Opportunity] ADD  DEFAULT ('Draft') FOR [Stage]
GO

ALTER TABLE [dbo].[Opportunity] ADD  DEFAULT (sysutcdatetime()) FOR [CreatedAt]
GO

ALTER TABLE [dbo].[Opportunity]  WITH CHECK ADD  CONSTRAINT [FK_Opportunity_CreatedBy] FOREIGN KEY([CreatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[Opportunity] CHECK CONSTRAINT [FK_Opportunity_CreatedBy]
GO

ALTER TABLE [dbo].[Opportunity]  WITH CHECK ADD  CONSTRAINT [FK_Opportunity_Customer] FOREIGN KEY([CustomerID])
REFERENCES [dbo].[Customer] ([ID])
GO

ALTER TABLE [dbo].[Opportunity] CHECK CONSTRAINT [FK_Opportunity_Customer]
GO

ALTER TABLE [dbo].[Opportunity]  WITH CHECK ADD  CONSTRAINT [FK_Opportunity_UpdatedBy] FOREIGN KEY([UpdatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[Opportunity] CHECK CONSTRAINT [FK_Opportunity_UpdatedBy]
GO

ALTER TABLE [dbo].[Opportunity]  WITH CHECK ADD  CONSTRAINT [CK_Opportunity_BidDates] CHECK  (([BidClose]>=[BidOpen]))
GO

ALTER TABLE [dbo].[Opportunity] CHECK CONSTRAINT [CK_Opportunity_BidDates]
GO

ALTER TABLE [dbo].[Opportunity]  WITH CHECK ADD  CONSTRAINT [CK_Opportunity_Stage] CHECK  (([Stage]='Closed' OR [Stage]='Canceled' OR [Stage]='In progress' OR [Stage]='Draft'))
GO

ALTER TABLE [dbo].[Opportunity] CHECK CONSTRAINT [CK_Opportunity_Stage]
GO

USE [test]
GO

/****** Object:  Table [dbo].[OpportunityItem]    Script Date: 9/11/2026 9:56:46 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[OpportunityItem](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[OpportunityID] [int] NOT NULL,
	[ProductID] [int] NOT NULL,
	[ItemDescription] [varchar](300) NOT NULL,
	[AnnualUnit] [int] NOT NULL,
	[EstPctAwarded] [decimal](5, 2) NULL,
	[ShelfPrice] [decimal](10, 2) NULL,
	[Stage] [varchar](20) NOT NULL,
	[CreatedAt] [datetime2](7) NOT NULL,
	[CreatedBy] [int] NOT NULL,
	[UpdatedAt] [datetime2](7) NULL,
	[UpdatedBy] [int] NULL,
	[RowVersion] [timestamp] NOT NULL,
 CONSTRAINT [PK_OpportunityItem] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_OpportunityItem_OppProduct] UNIQUE NONCLUSTERED 
(
	[OpportunityID] ASC,
	[ProductID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[OpportunityItem] ADD  DEFAULT ('Draft') FOR [Stage]
GO

ALTER TABLE [dbo].[OpportunityItem] ADD  DEFAULT (sysutcdatetime()) FOR [CreatedAt]
GO

ALTER TABLE [dbo].[OpportunityItem]  WITH CHECK ADD  CONSTRAINT [FK_OpportunityItem_CreatedBy] FOREIGN KEY([CreatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[OpportunityItem] CHECK CONSTRAINT [FK_OpportunityItem_CreatedBy]
GO

ALTER TABLE [dbo].[OpportunityItem]  WITH CHECK ADD  CONSTRAINT [FK_OpportunityItem_Opportunity] FOREIGN KEY([OpportunityID])
REFERENCES [dbo].[Opportunity] ([ID])
GO

ALTER TABLE [dbo].[OpportunityItem] CHECK CONSTRAINT [FK_OpportunityItem_Opportunity]
GO

ALTER TABLE [dbo].[OpportunityItem]  WITH CHECK ADD  CONSTRAINT [FK_OpportunityItem_Product] FOREIGN KEY([ProductID])
REFERENCES [dbo].[Product] ([ID])
GO

ALTER TABLE [dbo].[OpportunityItem] CHECK CONSTRAINT [FK_OpportunityItem_Product]
GO

ALTER TABLE [dbo].[OpportunityItem]  WITH CHECK ADD  CONSTRAINT [FK_OpportunityItem_UpdatedBy] FOREIGN KEY([UpdatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[OpportunityItem] CHECK CONSTRAINT [FK_OpportunityItem_UpdatedBy]
GO

ALTER TABLE [dbo].[OpportunityItem]  WITH CHECK ADD  CONSTRAINT [CK_OpportunityItem_PctAwarded] CHECK  (([EstPctAwarded] IS NULL OR [EstPctAwarded]>=(0) AND [EstPctAwarded]<=(100)))
GO

ALTER TABLE [dbo].[OpportunityItem] CHECK CONSTRAINT [CK_OpportunityItem_PctAwarded]
GO

ALTER TABLE [dbo].[OpportunityItem]  WITH CHECK ADD  CONSTRAINT [CK_OpportunityItem_Stage] CHECK  (([Stage]='Canceled' OR [Stage]='Lost' OR [Stage]='Awarded' OR [Stage]='Proposed' OR [Stage]='In progress' OR [Stage]='Revising' OR [Stage]='Draft'))
GO

ALTER TABLE [dbo].[OpportunityItem] CHECK CONSTRAINT [CK_OpportunityItem_Stage]
GO

USE [test]
GO

/****** Object:  Table [dbo].[Product]    Script Date: 9/11/2026 9:57:00 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Product](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[ProductCode] [varchar](20) NOT NULL,
	[ProductName] [varchar](200) NOT NULL,
	[WeightGrams] [decimal](10, 2) NOT NULL,
	[WeightOz]  AS (CONVERT([decimal](10,2),round([WeightGrams]/(28.3495231),(2)))) PERSISTED,
	[CreatedAt] [datetime2](7) NOT NULL,
	[CreatedBy] [int] NOT NULL,
	[UpdatedAt] [datetime2](7) NULL,
	[UpdatedBy] [int] NULL,
	[RowVersion] [timestamp] NOT NULL,
 CONSTRAINT [PK_Product] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Product_Code] UNIQUE NONCLUSTERED 
(
	[ProductCode] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Product_Name] UNIQUE NONCLUSTERED 
(
	[ProductName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[Product] ADD  DEFAULT (sysutcdatetime()) FOR [CreatedAt]
GO

ALTER TABLE [dbo].[Product]  WITH CHECK ADD  CONSTRAINT [FK_Product_CreatedBy] FOREIGN KEY([CreatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[Product] CHECK CONSTRAINT [FK_Product_CreatedBy]
GO

ALTER TABLE [dbo].[Product]  WITH CHECK ADD  CONSTRAINT [FK_Product_UpdatedBy] FOREIGN KEY([UpdatedBy])
REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[Product] CHECK CONSTRAINT [FK_Product_UpdatedBy]
GO

USE [test]
GO

/****** Object:  Table [dbo].[UserAccess]    Script Date: 9/11/2026 9:58:00 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[UserAccess](
	[AccessID] [int] IDENTITY(1,1) NOT NULL,
	[UserID] [int] NOT NULL,
	[Scope] [nvarchar](50) NOT NULL,
	[RowVersion] [rowversion] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[AccessID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_UserAccess] UNIQUE NONCLUSTERED 
(
	[UserID] ASC,
	[Scope] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

USE [test]
GO

/****** Object:  Table [dbo].[Users]    Script Date: 9/11/2026 10:05:09 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Users](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[UserName] [nvarchar](100) NOT NULL,
	[IsActive] [bit] NOT NULL,
	[RowVersion] [rowversion] NOT NULL,
 CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Users_UserName] UNIQUE NONCLUSTERED 
(
	[UserName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[Users] ADD  DEFAULT ((1)) FOR [IsActive]
GO

ALTER TABLE [dbo].[UserAccess] WITH CHECK ADD CONSTRAINT [FK_UserAccess_User]
FOREIGN KEY([UserID]) REFERENCES [dbo].[Users] ([ID])
GO

ALTER TABLE [dbo].[UserAccess] CHECK CONSTRAINT [FK_UserAccess_User]
GO

ALTER TABLE [dbo].[UserAccess] WITH CHECK ADD CONSTRAINT [CK_UserAccess_Scope]
CHECK ([Scope] IN (N'Admin', N'Customer', N'Product', N'Opportunity'))
GO

ALTER TABLE [dbo].[UserAccess] CHECK CONSTRAINT [CK_UserAccess_Scope]
GO

