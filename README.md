# WACalytics Node

An ultra-scaleable lightweight node.js microservice for responding to AWS "Lambda" events when log files are added to a bucket. The plain-text contents of these log files are then parsed into analytics events and saved to a DB.

## Setup

If you do not already have Node.js installed, download it from [here](https://nodejs.org/en/). This will also install node's package manager NPM.

- Navigate to the directory where the wacalytics-node project has been installed
- Run `$ npm install -g node-lambda` to install the node-lambda command line tools
- Run `$ npm install` to will install all other project dependencies

## Development Commands

You may now run one of the following commands from within the project directory:

#### setup

`$ node-lambda setup`

This will create the neccessary environment files to authenticate a connection with AWS (.env and deploy.env). Edit these files so that they contain the appropriate credentials for your AWS account. **These files are not tracked by git for security**.

It will also create an "event.json" which can be used to simulate an incoming AWS lambda event. 

#### run

`$ node-lambda run`

This will run the application locally, and simulate an incoming event using the contents of the "event.json" as the event data.

#### deploy

`$ node-lambda deploy`

This will deploy the application to AWS, providing the credentials in the ".env" are correct.
