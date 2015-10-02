USE [Events]
GO

ALTER TABLE [dbo].[EventProperties] DROP CONSTRAINT [FK_EventProperties_Events]
GO

/****** Object:  Table [dbo].[EventProperties]    Script Date: 29/09/2015 13:23:08 ******/
DROP TABLE [dbo].[EventProperties]
GO

/****** Object:  Table [dbo].[EventProperties]    Script Date: 29/09/2015 13:23:08 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[EventProperties](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[EventId] [int] NOT NULL,
	[PropertyName] [nvarchar](50) NOT NULL,
	[PropertyValue] [nvarchar](MAX) NULL,
 CONSTRAINT [PK_EventProperties] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]

GO

ALTER TABLE [dbo].[EventProperties]  WITH CHECK ADD CONSTRAINT [FK_EventProperties_Events] FOREIGN KEY([EventId])
REFERENCES [dbo].[Events] ([Id])
GO

ALTER TABLE [dbo].[EventProperties] CHECK CONSTRAINT [FK_EventProperties_Events]
GO


