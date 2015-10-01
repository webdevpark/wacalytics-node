/* global process */
'use strict';

var AWS         = require('aws-sdk'),
    atob        = require('atob'),
    zlib        = require('zlib'),
    fs          = require('fs'),
    q           = require('q'),

    eventSchema = require('../schemas/event-schema-mongo'),
    db          = require('../db/mongo'),

    wacCreate   = null,
    s3          = null,
    createTime  = null,
    EventModel  = null,

    LOG_PATH    = 'bucket/reallivedata.gz';

/**
 * createTime
 * @param {String} dateString
 * @param {String} timeString
 * @return {Number}
 *
 * Convert "date" and "time" strings into a single Unix timestamp
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
    connectionOpen: false,

    /**
     * init
     * @param {Record} record
     * @param {MongooseModel}
     * @return {Promise}
     *
     * Manages the full lifecycle of any incoming "ObjectCreated:put" event
     */

    init: function(record) {
        var self        = this,
            srcBucket   = record.s3.bucket.name,
            dstBucket   = record.s3.bucket.name + '-processed',
            dstBuffer   = '',
            srcKey      = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')),
            startTime   = Date.now();

        // Init S3 APIs

        s3 = new AWS.S3();

        console.log('[wacalytics-create] Source bucket:', srcBucket);
        console.log('[wacalytics-create] Destination bucket:', dstBucket);

        return db.init()
            .then(function() {
                return self.readFile(srcBucket, srcKey);
            })
            .then(function(buffer) {
                console.log('[wacalytics-create] File read in ' + (Date.now() - startTime) + 'ms');

                dstBuffer = buffer;

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

                return self.createEvents(events, EventModel);
            })
            .then(function() {
                console.log('[wacalytics-create] DB writes done in ' + (Date.now() - startTime) + 'ms');

                return self.copyLogToProcessed(srcKey, dstBucket, dstBuffer);
            })
            .then(function() {
                return self.deleteOriginalLog(srcKey, srcBucket);
            })
            .catch(function(e) {
                console.log('[wacalytics-create] The operation failed with errors');

                console.error(e.stack);
            });
    },

    /**
     * readFile
     * @param {String} srcBucket
     * @param {String} srcKey
     * @return {Promise} -> {Buffer}
     *
     * Reads an incoming file from S3 into a gzipped buffer. When running
     * locally, it will read the test file specified as LOG_PATH to
     * simulate an S3 getObject
     */

    readFile: function(srcBucket, srcKey) {
        var defered = q.defer();

        if (process.env.AWS_LAMBDA_FUNCTION_NAME) {

            // Running remotely on AWS

            console.log('[wacalytics-create] Detected AWS environment');

            console.log(srcBucket, srcKey);

            s3.getObject({
                Bucket: srcBucket,
                Key: srcKey
            },
            function(e, file) {
                if (e) {
                    console.log('[wacalytics-create] Error reading file');

                    return defered.reject(e);
                }

                console.log('[wacalytics-create] Read file successfully: ', file);

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
     * unzipLogFile
     * @param {Buffer} gzipBUffer
     * @return {Promise} -> {String}
     *
     * Unzips a gzip buffer into a plain-text string
     */

    unzipLogFile: function(gzipBuffer) {
        var defered = q.defer();

        console.log('[wacalytics-create] Unzipping buffer ...');

        zlib.unzip(gzipBuffer, function(e, buffer) {
            if (e) {
                console.log('[wacalytics-create] Buffer could not be unzipped');

                return defered.reject(e);
            }

            console.log('[wacalytics-create] Buffer unzipped successfully');

            defered.resolve(buffer.toString());
        });

        return defered.promise;
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
            var bits    = pair.split('='),
                key     = bits[0],
                value   = bits[1];

            // Define a new property on the params object:

            params[key] = value;
        });

        if (params.eventData || params.event_data) {
            // If an "eventData" param is present, base64 decode the eventData:

            eventJson = atob(params.eventData || params.event_data);

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
     * createEvents
     * @param {Event[]} events
     */

    createEvents: function(events, EventModel) {
        var event = null,
            validEvents = [],
            newEvent = null,
            i = 0;

        for (i = 0; event = events[i]; i++) {
            newEvent = {};

            newEvent._id = event['x-edge-request-id'];

            // If "Time" and "Date" properties are present in the data object,
            // use those, otherwise use the values provided in the log.

            if (event.data.Time) {
                newEvent.time = event.data.Time;

                delete event.data.Time;
            } else {
                newEvent.time = event.time;
            }

            if (event.data.Date) {
                newEvent.date = event.data.Date;

                delete event.data.Date;
            } else {
                newEvent.date = event.date;
            }

            if (event.data['Event Name']) {
                // Put the event name on the top level for better indexing

                newEvent.name = event.data['Event Name'];
            }

            // If "UserAgent" and "IpAddress" are present in the data object,
            // use those, otherwise use the values provided in the log.

            if (event.data.UserAgent) {
                newEvent.userAgent = event.data.UserAgent;

                delete event.data.UserAgent;
            } else {
                newEvent.userAgent = event['cs(User-Agent)'];
            }

            if (event.data.IpAddress) {
                newEvent.ipAddress = event.data.IpAddress;

                delete event.data.IpAddress;
            } else {
                newEvent.ipAddress = event['c-ip'];
            }

            // Generate a Unix timestamp from the date and time properties:

            newEvent.timeStamp = createTime(newEvent.date, newEvent.time);

            // Set all other useful properties:

            newEvent.location = event['x-edge-location'];
            newEvent.data = event.data;

            if (Object.getOwnPropertyNames(event.data).length) {
                // Only add the event if it has data

                validEvents.push(newEvent);
            }
        }

        return db.write(validEvents);
    },

    /**
     * moveLogToProcessed
     * @param {String} key
     * @param {String} bucket
     * @param {Buffer} body
     * @return {Promise}
     */

    copyLogToProcessed: function(key, bucket, body) {
        var defered = q.defer();

        console.log('[wacalaytics-create] Copying "' + key + '" to bucket "' + bucket + '"');

        s3.putObject({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'application/x-gzip'
        }, function(err, data) {
            if (err) {
                console.log(err);

                return defered.reject(err);
            }

            defered.resolve();
        });

        return defered.promise;
    },

    /**
     * deleteOriginalLog
     * @param {String} key
     * @param {String} bucket
     * @return {Promise}
     */

    deleteOriginalLog: function(key, bucket) {
        var defered = q.defer();

        console.log('[wacalaytics-create] Deleting original file "' + key + '"');

        s3.deleteObject({
            Bucket: bucket,
            Key: key
        }, function(err) {
            if (err) {
                return defered.reject(err);
            }

            defered.resolve();
        });

        return defered.promise;
    }
};

module.exports = wacCreate;