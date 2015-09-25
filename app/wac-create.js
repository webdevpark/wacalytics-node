/* global process */
'use strict';

var AWS         = require('aws-sdk'),
    marshaler   = require('dynamodb-marshaler'),
    TypedObject = require('typed-object'),
    atob        = require('atob'),
    zlib        = require('zlib'),
    fs          = require('fs'),
    q           = require('q'),

    eventSchema = require('../schemas/event-schema'),

    wacCreate     = null,
    dynamodb    = null,
    s3          = null,
    createTime  = null,

    LOG_PATH    = 'bucket/reallivedata.gz';

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
 * wacCreate
 */

wacCreate = {

    /**
     * insertBatchToDb
     * @param {Event[]} eventBatch
     * @param {Number} index
     * @param {Object} progress
     * @return {Promise}
     *
     * Creates and writes batches of 25 events to the DB using "batchWriteItem"
     * to reduce throughput and the overall duration
     */

    insertBatchToDb: function(eventBatch, index, progress) {
        var defered = q.defer(),
            params  = null,
            newEvent = null,
            puts = [],
            event = null,
            i = -1;

        for (i = 0; event = eventBatch[i]; i++) {
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
                console.warn('[wacalytics-create] WARNING: An event failed validation');
                console.error(e);

                defered.resolve();

                return defered.promise;
            }

            // Convert the typed object to an object literal before marshalling:

            puts.push({
                PutRequest: {
                    Item: marshaler.marshalItem(newEvent.toObject())
                }
            });
        }

        // Construct the DynamoDB params object

        params = {
            RequestItems: {
                'events': puts
            }
        };

        dynamodb.batchWriteItem(params, function(err, data) {
            if (err) {
                defered.reject(err);

                return defered.promise;
            }

            progress.completed++;

            console.log(
                '[wacalytics-create] Batch ' +
                progress.completed +
                '/' + progress.total +
                ' added to DB'
            );

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
            batches = [],
            progress = null,
            i = 0;

        // Reduce the events array in to batches of 25

        for (i = 0; i < events.length; i += 25) {
            batches.push(events.slice(i, i + 25));
        }

        console.log(
            '[wacalytics-create] Writing ' +
            events.length +
            ' events to DB in ' +
            batches.length +
            ' batches'
        );

        progress = {
            total: batches.length,
            completed: 0
        };

        batches.forEach(function(eventBatch, i) {
            tasks.push(self.insertBatchToDb(eventBatch, i, progress));
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
                console.error('[wacalytics-create] Could not parse JSON for event log');
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

        console.log('[wacalytics-create] Found ' + rows.length + ' events');

        rows.forEach(function(row) {
            // In each row, fields are seperated by "tab" characters.
            // Split each column into a array of fields:

            var fields = row.split('\t'),
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
                '[wacalytics-create] WARNING: There are ' +
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

            console.log('[wacalytics-create] Detected AWS environment');

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
                            console.log('[wacalytics-create] Unrecognised file type', file.ContentType);
                    }
                }
            });
        } else {
            // Local development

            console.log('[wacalytics-create] Detected local dev environment');

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
     * init
     * @param {Record} record
     * @return {Promise}
     *
     * handlePut manages the full lifecycle of anincoming
     * "ObjectCreated:put" event
     */

    init: function(record) {
        var self        = this,
            srcBucket   = record.s3.bucket.name,
            srcKey      = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')),
            startTime   = Date.now();

        // Init S3 APIs

        s3       = new AWS.S3();
        dynamodb = new AWS.DynamoDB({
            apiVersion: '2012-08-10'
        });

        return self.readFile(srcBucket, srcKey)
            .then(function(buffer) {
                console.log('[wacalytics-create] File read in ' + (Date.now() - startTime) + 'ms');

                startTime = Date.now();

                return self.unzipLogFile(buffer);
            })
            .then(function(logData) {
                console.log('[wacalytics-create] Log unzipped in ' + (Date.now() - startTime) + 'ms');

                startTime = Date.now();

                return self.parseLogFile(logData, srcKey);
            })
            .then(function(events) {
                console.log('[wacalytics-create] Log parsed in ' + (Date.now() - startTime) + 'ms');

                startTime = Date.now();

                return self.writeToDb(events);
            })
            .then(function() {
                console.log('[wacalytics-create] DB writes done in ' + (Date.now() - startTime) + 'ms');
            });
    }
};

module.exports = wacCreate;