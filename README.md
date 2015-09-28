# WACalytics Node

A scaleable analytics microservice for AWS using S3, Lambda, and DynamoDB.
​
## Requirements & Setup

You will need an Amazon Web Services account to develop and deploy this application. Within your AWS account you will need the following services:
- An S3 bucket containing a 1px GIF image
- A second S3 bucket to house CloudFront log files
- A DynamoDB instance with an "events" table
- A Lambda function instance to deploy to
- An API Gateway GET endpoint with a "q" parameter

If you do not already have Node.js installed, download it from [here](https://nodejs.org/en/). This will also install node's package manager NPM.
​
- Navigate to the directory where the wacalytics-node project has been installed
- Run `$ npm install -g node-lambda` to install the node-lambda command line tools
- Run `$ npm install` to will install all other project dependencies

## Overview

This application forms the back-end of an analytics microservive for logging and querying high-volume analytics events. The application is divided into 4 distinct components:

### WacWrite

The source application that is being tracked should generate analytics events by making XHR GET requests to the location of the 1px gif in the S3 bucket. With each request, event data can be included as an `event_data` query string paramater. The value of this parameter should be a Base64 encoded JSON string.

As GET requests are made to S3, they are logged by CloudFront and written out to in batches to gzipped log files in the second bucket. A S3 "Lambda" event is triggered whever a log file is written into the bucket which triggers the the "WacWrite" function.

The WacWrite function retreives and unzips the newly generate log file, parses its plain text contents into the appropriate number of event objects, and writes them to the database.

### WacRead

The WacRead function is triggered by GET requests made to an API Gateway endpoint. The query is passed as the value of a "q" query string parameter, which again is a Base64 encoded JSON object.

The database is then queried and returns an array of chronological results as per the requested pagination settings.

### WacUpdate

(in progress)

### WacDelete

(in progress)

## Development Commands

You may now run one of the following commands from within the project directory:
​
#### setup

`$ node-lambda setup`

This will create the necessary environment files to authenticate a connection with AWS (.env and deploy.env). Edit these files so that they contain the appropriate credentials for your AWS account. **These files are not tracked by git for security**.

You should then create a `configs` directory in the root and add two new files to it, named `config.env.development`, and `config.env.production`. Place the contents of your .env file into these, and make sure the AWS_ENVIRONMENT properties are set to `development` and `production` respectively. The AWS_HANDLER property must also be set to `main.handler` in both files. You may edit any other properties as needed to target either local development or the production environment specifically. The configs directory is also not tracked by git for security.

The setup command will also create an "event.json" which can be used to simulate an incoming AWS lambda event.

#### run

`$ gulp --run`

This will hint all JavaScript, run the application locally using the "development" config file, and simulate an incoming event using the contents of the "event.json" as the event data.
​
#### deploy

`$ gulp --deploy`

This will hint all JavaScript and deploy the application to AWS using the "production" config file, providing the credentials are correct.