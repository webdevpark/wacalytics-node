USE [Events]
GO

/****** Object:  Table [dbo].[Events]    Script Date: 29/09/2015 13:23:00 ******/
DROP TABLE [dbo].[Events]
GO

/****** Object:  Table [dbo].[Events]    Script Date: 29/09/2015 13:23:00 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Events](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[EventDate] [datetime] NOT NULL,
	[IpAddress] [nvarchar](20) NOT NULL,
	[AwsEventId] [nvarchar](MAX) NOT NULL,
	[UserId] [nvarchar](50) NOT NULL,
	[EventName] [nvarchar](50) NOT NULL
 CONSTRAINT [PK_Events] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]

GO


