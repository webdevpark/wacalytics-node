var AWS         = require('aws-sdk'),
    s3          = new AWS.S3(),
    Wacalytics  = null,
    q           = require('q'),
    zlib        = require('zlib'),
    fs          = require('fs');

Wacalytics = function() {

};

Wacalytics.prototype = {
    constructor: Wacalytics,

    parseLogFile: function(gzipBuffer) {
        var self = this,
            defered = q.defer();

        console.log('buffer in: ', gzipBuffer);

        zlib.unzip(gzipBuffer, function(err, result) {
            if (err) {
                return defered.reject();
            }

            console.log('buffer out: ', result);

            buffer   = new Buffer(result, 'base64');
        });

        return defered.promise;
    },

    readFile: function(srcBucket, srcKey) {
        var defer = q.defer();

        console.log('Reading file ...');

        // s3.getObject({
        //     Bucket: srcBucket,
        //     Key: srcKey
        // },
        // function(err, response) {
        //     if (err) {
        //         return defer.reject(err);
        //     }

        //     defer.resolve(response);
        // });

        fs.readFile('bucket/log.gz', function (err, data) {
            if (err) throw err;

            zlib.unzip(data, function(err, result) {
                console.log(result.toString());

                // fs.writeFile('bucket/test.txt', result);
            });
        });

        return defer.promise;
    },

    handlePut: function(record) {
        var self = this,
            srcBucket = record.s3.bucket.name,
            srcKey    = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        console.log(srcBucket, srcKey);

        return self.readFile(srcBucket, srcKey)
            .then(function(file) {
                if (file.Body) {
                    switch (file.ContentType) {
                        case 'application/x-gzip':
                            return self.parseLogFile(file.Body);

                            break;
                        default:
                            console.log('Unrecognised file type', file.ContentType);
                    }
                }
            });
    },

    eventBus: function(record) {
        var self = this;

        switch (record.eventName) {
            case 'ObjectCreated:Put':
                console.log('File "PUT" event');

                return self.handlePut(record);

                break;
            default:
                console.log('Unrecognised event');
        }
    },

    init: function(event) {
        var self = this,
            tasks = [];

        event.Records.forEach(function(event) {
            tasks.push(self.eventBus(event));
        });

        return q.all(tasks);
    }
};

// For development/testing purposes
exports.handler = function(event, context) {
    var wac = new Wacalytics();

    wac.init(event)
        .then(function() {
            context.done();
        });
}