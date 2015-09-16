var AWS         = require('aws-sdk'),
    s3          = new AWS.S3(),
    Wacalytics  = null,
    q           = require('q');

Wacalytics = function() {

};

Wacalytics.prototype = {
    constructor: Wacalytics,

    readFile: function(srcBucket, srcKey) {
        var defer = q.defer();

        s3.getObject({
            Bucket: srcBucket,
            Key: srcKey
        },
        function(response) {
            defer.resolve(response);
        });

        return defer.promise;
    },

    handlePut: function(record) {
        var self = this,
            srcBucket = record.s3.bucket.name,
            srcKey    = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

        return self.readFile(srcBucket, srcKey)
            .then(function(response) {
                console.log(response);
            });
    },

    eventBus: function(record) {
        var self = this;

        switch (record.eventName) {
            case 'ObjectCreated:Put':
                return self.handlePut(record);

                break;
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