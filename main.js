var AWS         = require('aws-sdk'),
    zlib        = require('zlib'),
    fs          = require('fs'),
    q           = require('q'),
    wacalytics  = null,
    s3          = null;

s3 = new AWS.S3();

/**
 * wacalytics
 * @singleton
 */

wacalytics = {

    /**
     * writeToDb
     * @param {Event[]} events
     */

    writeToDb: function(events) {
        console.log('[wacalytics] Writing ' + events.length + ' events to DB...');

        // Write to DB ...
    },

    /**
     * parseEventData
     * @param {String} query
     * @return {Object}
     */

    parseEventData: function(query) {
        var output = {},
            pairs = [];

        if (query === '-') {
            return output;
        }

        pairs = query.split('&');

        pairs.forEach(function(pair) {
            var bits = pair.split('='),
                key = bits[0],
                value = bits[1];

            output[key] = value;
        });

        return output;
    },

    /**
     * parseLogFile
     * @param {String} logData
     * @return {Event[]}
     */

    parseLogFile: function(logData) {
        var self = this,
            rows = logData.split('\n'),
            keys = rows[1].split(' '),
            events = [],
            event = null;

        keys.shift();

        rows.shift();
        rows.shift();
        rows.pop();

        console.log('[wacalytics] Found ' + rows.length + ' events');

        rows.forEach(function(row) {
            var fields = row.split('	');

            event = {};

            keys.forEach(function(key, i) {
                event[key] = fields[i];
            });

            event.data = self.parseEventData(event['cs-uri-query']);

            events.push(event);
        });

        return events;
    },

    /**
     * unzipLogFile
     * @param {Buffer} gzipBUffer
     * @return {Promise} -> {String}
     */

    unzipLogFile: function(gzipBuffer) {
        var defered = q.defer(),
            logData = '';

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
     */

    readFile: function(srcBucket, srcKey) {
        var defered = q.defer();

        if (typeof AWS_ENVIRONMENT !== 'undefined') {
            // AWS

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
                return self.parseLogFile(logData);
            })
            .then(function(events) {
                return self.writeToDb(events);
            });
    },

    /**
     * eventBus
     * @param {Record} record
     * @return {Promise}
     */

    eventBus: function(record) {
        var self = this;

        switch (record.eventName) {
            case 'ObjectCreated:Put':
                return self.handlePut(record);

                break;
            default:
                console.log('[wacalytics] Unrecognised event "' + record.eventName + '"');
        }
    },

    /**
     * handleEvent
     * @param {Event} event
     * @return {Promise}
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

exports.handler = function(event, context) {
    wacalytics.handleEvent(event)
        .then(function() {
            context.done();
        })
        .catch(function(e) {
            console.error(e.stack);
        });
};