# WACalytics Node

An ultra-scaleable lightweight node.js microservice for responding to AWS "Lambda" events when log files are added to a bucket. The plain-text contents of these log files are then parsed into analytics events and saved to a DB.
​
## Setup

If you do not already have Node.js installed, download it from [here](https://nodejs.org/en/). This will also install node's package manager NPM.
​
- Navigate to the directory where the wacalytics-node project has been installed
- Run `$ npm install -g node-lambda` to install the node-lambda command line tools
- Run `$ npm install` to will install all other project dependencies

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