/* global process */
'use strict';

var AWS         = require('aws-sdk'),
    marshalItem = require('dynamodb-marshaler').marshalItem,
    TypedObject = require('typed-object'),
    atob        = require('atob'),
    zlib        = require('zlib'),
    fs          = require('fs'),
    q           = require('q'),
    wacalytics  = null,
    dynamodb    = null,
    s3          = null,
    eventSchema = null,
    createTime  = null;

dynamodb = new AWS.DynamoDB(),
s3       = new AWS.S3();

/**
 * createTime
 * @param {String} dateString
 * @param {String} timeString
 * @return {Number}
 *
 * Convert the log's "date" and "time" strings into a single UNIX timestamp
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
 * eventSchema
 * @schema
 */

eventSchema = {
    id: '',
    timeStamp: -1,
    date: '',
    time: '',
    userAgent: '',
    ipAddress: '',
    location: '',
    data: {}
};

/**
 * wacalytics
 * @singleton
 */

wacalytics = {
    /**
     * insertEventToDb
     * @param {Event} event
     * @return {Promise}
     */

    insertEventToDb: function(event) {
        var defered = q.defer(),
            params  = null,
            newEvent = null;

        // Instantiate a new "TypedObject" to enforce the schema

        newEvent = new TypedObject(eventSchema);

        newEvent.id = event['x-edge-request-id'];

        // If "Time" and "Date" properties are present in the data object,
        // use those, otherwise use the values provided in the log.

        try {
            newEvent.time = event.data.Time || event.time,
            newEvent.date = event.data.Date || event.date,
            newEvent.timeStamp = createTime(newEvent.date, newEvent.time);
            newEvent.userAgent = event['cs(User-Agent)'];
            newEvent.ipAddress = event['c-ip'];
            newEvent.location = event['x-edge-location'];
            newEvent.data = event.data;
        } catch(e) {
            console.warn('[wacalytics] WARNING: An event failed validation.');
            console.error(e);

            defered.resolve();

            return defered.promise;
        }

        // Convert the typed object to an object literal before marshalling:

        params = {
            Item: marshalItem(newEvent.toObject()),
            TableName: 'events'
        };

        console.log('[wacalytics] Putting to DB...');

        dynamodb.putItem(params, function(err, data) {
            if (err) {
                defered.reject(err);

                return defered.promise;
            }

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
            tasks = [];

        console.log('[wacalytics] Writing ' + events.length + ' events to DB...');

        events.forEach(function(event) {
            tasks.push(self.insertEventToDb(event));
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
            eventData = {};

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
            } catch(e) {
                console.error('[wacalytics] Could not parse JSON for event log');
            }
        }

        return eventData;
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

            fs.readFile('bucket/log.gz', function (e, buffer) {
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
            srcKey      = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        return self.readFile(srcBucket, srcKey)
            .then(function(buffer) {
                return self.unzipLogFile(buffer);
            })
            .then(function(logData) {
                return self.parseLogFile(logData, srcKey);
            })
            .then(function(events) {
                return self.writeToDb(events);
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