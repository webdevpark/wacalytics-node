/* global process */
'use strict';

var AWS         = require('aws-sdk'),
    marshaler   = require('dynamodb-marshaler'),
    TypedObject = require('typed-object'),
    atob        = require('atob'),
    zlib        = require('zlib'),
    fs          = require('fs'),
    q           = require('q'),
    wacalytics  = null,
    dynamodb    = null,
    s3          = null,
    querySchema = null,
    eventSchema = null,
    createTime  = null,

    LOG_PATH    = 'bucket/reallivedata.gz';

dynamodb = new AWS.DynamoDB({
    apiVersion: '2012-08-10'
}),
s3       = new AWS.S3();

/**
 * createTime
 * @param {String} dateString
 * @param {String} timeString
 * @return {Number}
 *
 * Convert the log's "date" and "time" strings into a single Unix timestamp
 */

createTime = function(dateString, timeString) {
    var timeStamp = -1,
        date = null;

    dateString = dateString.replace(/-/g, '/');

    date = new Date(dateString + ' ' + timeString);

    timeStamp = date.getTime() / 1000;

    return timeStamp;
};

/**
 * querySchema
 * @schema
 */

querySchema = {
    startTime: -1,
    endTime: -1,
    conditions: []
};

/**
 * eventSchema
 * @schema
 */

eventSchema = {
    event_source: 'Website',
    event_id: '',
    event_timeStamp: -1,
    event_date: '',
    event_time: '',
    event_userAgent: '',
    event_ipAddress: '',
    event_location: '',
    event_data: {}
};

/**
 * wacalytics
 * @singleton
 */

wacalytics = {
    /**
     * buildDynamoQuery
     * @param {Query} query
     * @return {Object}
     */

    buildDynamoQuery: function(query) {
        var filterConditionStrings      = [],
            filterExpression            = '',
            expressionAttributeValues   = null,
            params                      = null,
            condition                   = null,
            valueObj                    = null,
            typeIdentifier              = '',
            sanitizedKey                = '',
            sanitizedVar                = '',
            i                           = -1;

        // Populate the default, top-level expression attributes

        expressionAttributeValues = {
            ':v_source': {
                S: 'Website'
            },
            ':v_startTime': {
                N: query.startTime.toString()
            },
            ':v_endTime': {
                N: query.endTime.toString()
            }
        };

        // Parse the query conditions into an expression with attributes

        for (i = 0; condition = query.conditions[i]; i++) {
            sanitizedVar = ':v_' + condition.property.replace(/ /g, '_'),
            sanitizedKey = 'event_data.' + condition.property.replace(/ /g, '_'),
            valueObj = {};

            switch (typeof condition.value) {
                case 'string':
                    typeIdentifier = 'S';

                    break;
                case 'number':
                    typeIdentifier = 'N';

                    break;
                case 'boolean':
                    typeIdentifier = 'B';

                    break;
            }

            if (condition.value) {
                valueObj[typeIdentifier] = condition.value.toString();
            }

            switch (condition.operator.toLowerCase()) {
                case 'exists':
                    // e.g. "attribute_exists (data.Errors)"

                    filterConditionStrings.push(
                        'attribute_exists (' + sanitizedKey + ')'
                    );

                    break;
                case 'not_exists':
                    // e.g. "attribute_not_exists (data.Errors)"

                    filterConditionStrings.push(
                        'attribute_not_exists (' + sanitizedKey + ')'
                    );

                    break;
                case 'contains':
                    expressionAttributeValues[sanitizedVar + '_substring'] = valueObj;

                    // e.g. "contains (data.User_Email, :v_data.User_Email-substring)"

                    filterConditionStrings.push(
                        'contains (' + sanitizedKey + ', ' + sanitizedVar + '_substring)'
                    );

                    break;
                default:
                    // All other operators: '=', '<>', '<', '>', '<=', '>='

                    expressionAttributeValues[sanitizedVar] = valueObj;

                    // e.g. "data.User_Email = :v_data.User_Email"

                    filterConditionStrings.push(
                        sanitizedKey + ' ' + condition.operator + ' ' + sanitizedVar
                    );
            }
        }

        // Join all the condition strings into a single string with "AND" seperators

        // e.g. "data.User_Email = v:_data.User_Email AND data.Interaction_Type = v:_data.Interaction_Type"

        filterExpression = filterConditionStrings.join(' AND ');

        // Create the params object with the constructed values

        params = {
            TableName: 'events',
            IndexName: 'event_source-event_timeStamp-index', // index neccessary for secondary key queries
            KeyConditionExpression: // Top-level conditions
                '(event_timeStamp BETWEEN :v_startTime AND :v_endTime) AND ' +
                'event_source = :v_source',
            FilterExpression: filterExpression, // Nested conditions
            ExpressionAttributeValues: expressionAttributeValues // All attributes
        };

        return params;
    },

    /**
     * readFromDb
     * @param {Query} query
     * @return {Promise}
     */

    readFromDb: function(query) {
        var self = this,
            defered = q.defer(),
            params = self.buildDynamoQuery(query);

        console.log('[wacalytics] Querying DB...');

        console.log(params.FilterExpression);

        dynamodb.query(params, function(err, data) {
            var items = [];

            if (err) {
                defered.reject(err);
            }

            if (!data) {
                console.log('[wacalytics] No items found');
            } else {
                items = data.Items.map(marshaler.unmarshalItem);

                console.log('[wacalytics] ' + data.Count + ' items found');

                // console.log(items[0]);
            }

            defered.resolve();
        });

        return defered.promise;
    },

    /**
     * insertEventToDb
     * @param {Event} event
     * @param {Number} index
     * @param {Object} progress
     * @return {Promise}
     */

    insertEventToDb: function(event, index, progress) {
        var defered = q.defer(),
            params  = null,
            newEvent = null;

        // Instantiate a new "TypedObject" to enforce the schema

        newEvent = new TypedObject(eventSchema);

        newEvent.event_id = event['x-edge-request-id'];

        try {
            // If "Time" and "Date" properties are present in the data object,
            // use those, otherwise use the values provided in the log.

            if (event.data.Time) {
                newEvent.event_time = event.data.Time;

                delete event.data.Time;
            } else {
                newEvent.event_time = event.time;
            }

            if (event.data.Date) {
                newEvent.event_date = event.data.Date;

                delete event.data.Date;
            } else {
                newEvent.event_date = event.date;
            }

            // If "UserAgent" and "IpAddress" are present in the data object,
            // use those, otherwise use the values provided in the log.

            if (event.data.UserAgent) {
                newEvent.event_userAgent = event.data.UserAgent;

                delete event.data.UserAgent;
            } else {
                newEvent.event_userAgent = event['cs(User-Agent)'];
            }

            if (event.data.IpAddress) {
                newEvent.event_ipAddress = event.data.IpAddress;

                delete event.data.IpAddress;
            } else {
                newEvent.event_ipAddress = event['c-ip'];
            }

            // Generate a Unix timestamp from the date and time properties:

            newEvent.event_timeStamp = createTime(newEvent.event_date, newEvent.event_time);

            // Set all other useful properties:

            newEvent.event_location = event['x-edge-location'];
            newEvent.event_data = event.data;
        } catch(e) {
            console.warn('[wacalytics] WARNING: An event failed validation.');
            console.error(e);

            defered.resolve();

            return defered.promise;
        }

        // Convert the typed object to an object literal before marshalling:

        params = {
            Item: marshaler.marshalItem(newEvent.toObject()),
            TableName: 'events'
        };

        dynamodb.putItem(params, function(err, data) {
            if (err) {
                defered.reject(err);

                return defered.promise;
            }

            progress.completed++;

            // console.log('[wacalytics] Event ' + progress.completed +
            // '/' + progress.total + ' added to DB');

            defered.resolve();
        });

        return defered.promise;
    },

    /**
     * writeToDb
     * @param {Event[]} events
     */

    writeToDb: function(events) {
        var self = this,
            tasks = [],
            progress = {
                total: events.length,
                completed: 0
            };

        console.log('[wacalytics] Writing ' + events.length + ' events to DB...');

        events.forEach(function(event, i) {
            tasks.push(self.insertEventToDb(event, i, progress));
        });

        return q.all(tasks);
    },

    /**
     * parseEventData
     * @param {String} query
     * @param {Event} event
     * @return {Object}
     *
     * Parses key-value pairs from a GET query string into an object
     */

    parseEventData: function(query, event) {
        var pairs = [],
            params = {},
            eventJson = '',
            eventData = {},
            sanitizedEventData = {},
            sanitizedKey = '',
            key = '';

        // Split the query every "&" into an array of key-value pairs:

        pairs = query.split('&');

        if (!pairs.length) {
            return eventData;
        }

        // Iterate through the pairs and break them down into keys and value:

        pairs.forEach(function(pair) {
            var bits = pair.split('='),
                key = bits[0],
                value = bits[1];

            // Define a new property on the params object:

            params[key] = value;
        });

        if (params.eventData) {
            // If an "eventData" param is present, base64 decode the eventData:

            eventJson = atob(params.eventData);

            // Parse the JSON string into an object:

            try {
                eventData = JSON.parse(eventJson);

                for (key in eventData) {
                    // Replace all spaces in data keys with underscores
                    // for DynamoDB query compatibility

                    sanitizedKey = key.replace(/ /g, '_');

                    sanitizedEventData[sanitizedKey] = eventData[key];
                }
            } catch(e) {
                console.error('[wacalytics] Could not parse JSON for event log');
            }
        }

        return sanitizedEventData;
    },

    /**
     * parseLogFile
     * @param {String} logData
     * @param {String} srcKey
     * @return {Event[]}
     *
     * Parses the plain-text contents of the log file into
     * "Event" objects to be saved to the DB
     */

    parseLogFile: function(logData, srcKey) {
        var self = this,
            rows = [],
            keys = [],
            events = [],
            offset = -1;

        // Split the logData every line break to create an array of rows:

        rows = logData.split('\n');

        // The column keys are found on the 2nd row, extract
        // and split them every "space" character:

        keys = rows[1].split(' ');

        // Remove the first "#Fields" item of the keys array,
        // as we don't need this:

        keys.shift();

        // The actual logs start from row 3 and end on the penultimate line.
        // Slice the rows into a new array to extract only the log data:

        rows = rows.slice(2, rows.length - 1);

        console.log('[wacalytics] Found ' + rows.length + ' events');

        rows.forEach(function(row) {
            // In each row, fields are seperated by "tab" characters.
            // Split each column into a array of fields:

            var fields = row.split('	'),
                event = {},
                queryString = '';

            // Instantiate a new object literal to contain the event:

            // Iterate through each key and assign properties to the event object by index:

            keys.forEach(function(key, i) {
                event[key] = fields[i];
            });

            // Custom event data is encoded into the GET query string.
            // Parse it into a "data" sub-object:

            queryString = event['cs-uri-query'];

            if (queryString !== '-') {
                event.data = self.parseEventData(queryString, event);

                // Push the event into the events array:

                events.push(event);
            }
        });

        offset = rows.length - events.length;

        if (offset > 0) {
            console.warn(
                '[wacalytics] WARNING: There are ' +
                offset +
                ' invalid requests in file "' +
                srcKey +
                '"'
            );
        }

        return events;
    },

    /**
     * unzipLogFile
     * @param {Buffer} gzipBUffer
     * @return {Promise} -> {String}
     *
     * Unzips a gzip buffer into a plain-text string
     */

    unzipLogFile: function(gzipBuffer) {
        var defered = q.defer();

        zlib.unzip(gzipBuffer, function(e, buffer) {
            if (e) {
                return defered.reject(e);
            }

            defered.resolve(buffer.toString());
        });

        return defered.promise;
    },

    /**
     * readFile
     * @param {String} srcBucket
     * @param {String} srcKey
     * @return {Promise} -> {Buffer}
     *
     * Reads an incoming file from S3 into a gzipped buffer. When running
     * locally, it will read the test file in bucket/log.gz to simulate an
     * S3 getObject
     */

    readFile: function(srcBucket, srcKey) {
        var defered = q.defer();

        if (process.env.AWS_LAMBDA_FUNCTION_NAME === 'wacalytics-node-production') {
            // The AWS_ENVIRONMENT global variable exists,
            // so assume we are running remotely

            console.log('[wacalytics] Detected AWS environment');

            s3.getObject({
                Bucket: srcBucket,
                Key: srcKey
            },
            function(e, file) {
                if (e) {
                    return defered.reject(e);
                }

                if (file.Body) {
                    switch (file.ContentType) {
                        case 'application/x-gzip':
                            defered.resolve(file.Body);

                            break;
                        default:
                            console.log('[wacalytics] Unrecognised file type', file.ContentType);
                    }
                }
            });
        } else {
            // Local development

            console.log('[wacalytics] Detected local dev environment');

            fs.readFile(LOG_PATH, function (e, buffer) {
                if (e) {
                    defered.reject(e);
                }

                defered.resolve(buffer);
            });
        }

        return defered.promise;
    },

    /**
     * handlePut
     * @param {Record} record
     * @return {Promise}
     *
     * handlePut manages the full lifecycle of anincoming
     * "ObjectCreated:put" event
     */

    handlePut: function(record) {
        var self        = this,
            srcBucket   = record.s3.bucket.name,
            srcKey      = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')),
            startTime   = Date.now();

        return self.readFile(srcBucket, srcKey)
            .then(function(buffer) {
                console.log('[wacalytics] File read in ' + (Date.now() - startTime) + 'ms');

                startTime = Date.now();

                return self.unzipLogFile(buffer);
            })
            .then(function(logData) {
                console.log('[wacalytics] Log unzipped in ' + (Date.now() - startTime) + 'ms');

                startTime = Date.now();

                return self.parseLogFile(logData, srcKey);
            })
            .then(function(events) {
                console.log('[wacalytics] Log parsed in ' + (Date.now() - startTime) + 'ms');

                startTime = Date.now();

                // return self.writeToDb(events);
            })
            .then(function() {
                var query = new TypedObject(querySchema);

                console.log('[wacalytics] DB writes done in ' + (Date.now() - startTime) + 'ms');

                startTime = Date.now();

                // An example query:

                query.startTime     = 0;
                query.endTime       = 9999999999;

                query.conditions = [
                    {
                        property: 'Interaction Type',
                        operator: '=',
                        value: 'Signed In'
                    },
                    {
                        property: 'Browser',
                        operator: '=',
                        value: 'Chrome'
                    },
                    {
                        property: 'User Email',
                        operator: 'contains',
                        value: '@wearecolony.com'
                    }
                    // {
                    //     property: 'Errors',
                    //     operator: 'exists'
                    // }
                ];

                return self.readFromDb(query);
            })
            .then(function() {
                console.log('[wacalytics] DB read done in ' + (Date.now() - startTime) + 'ms');
            });
    },

    /**
     * eventBus
     * @param {Record} record
     * @return {Promise}
     *
     * The eventBus checks for the record's "eventName"
     * property and delagates it to the appropriate handler method
     */

    eventBus: function(record) {
        var self = this;

        switch (record.eventName) {
            case 'ObjectCreated:Put':
                console.log('[wacalytics] Incoming "ObjectCreated:Put" event');

                return self.handlePut(record);
            default:
                console.log('[wacalytics] Unrecognised event "' + record.eventName + '"');
        }
    },

    /**
     * handleEvent
     * @param {Event} event
     * @return {Promise}
     *
     * As events come in, they enter wacalytics here. As each event
     * contains an array of "records", we loop through them here
     * before delagating each record them to the appropriate handler
     */

    handleEvent: function(event) {
        var self    = this,
            tasks   = [];

        event.Records.forEach(function(event) {
            tasks.push(self.eventBus(event));
        });

        return q.all(tasks);
    }
};

module.exports = wacalytics;