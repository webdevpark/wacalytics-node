var wacCreate    = require('./app/wac-create'),
    wacRead      = require('./app/wac-read'),

    q            = require('q'),

    router       = null,
    exampleQuery = null,
    startTime    = -1;

router = {

    /**
     * handleEvent
     * @param {Event} event
     * @return {Promise}
     *
     * As events come in, they enter wacalytics here. As each S3 event
     * contains an array of "records", we loop through them here
     * before delagating each record to the appropriate handler
     */

    handleEvent: function(event) {
        var self    = this,
            defered = q.defer(),
            tasks   = [];

        if (Array.isArray(event.Records)) {
            // S3 Events

            console.log('[wacalytics] Detected S3 event');

            event.Records.forEach(function(event) {
                tasks.push(self.handleS3Event(event));
            });

            return q.all(tasks);
        } else if (event.method) {
            // API Events

            console.log('[wacalytics] Detected API event');

            return self.handleApiEvent(event);
        } else {
            console.log('[wacalytics] Unknown event type');
            console.log(event);

            defered.reject();

            return defered.promise;
        }
    },

    /**
     * handleS3Event
     * @param {Record} record
     * @return {Promise}
     *
     * Checks for the record's "eventName" property and delagates
     * it to the appropriate class
     */

    handleS3Event: function(record) {
        var defered = q.defer();

        switch (record.eventName) {
            case 'ObjectCreated:Put':
                console.log('[wacalytics] "ObjectCreated:Put" event type');

                return wacCreate.init(record);
            default:
                console.log('[wacalytics] Unrecognised event "' + record.eventName + '"');

                defered.reject();

                return defered.promise;
        }
    },

    /**
     * handleApiEvent
     * @param {Event} event
     * @return {Promise}
     *
     * Checks for the events "method" property and delagates
     * it to the appropriate class
     */

    handleApiEvent: function(event) {
        var defered = q.defer();

        switch (event.method.toUpperCase()) {
            case 'GET':
                console.log('[wacalytics] HTTP GET request');

                return wacRead.init(event.query);
            case 'PUT':
                // return wacUpdate.init();

                break;
            case 'DELETE':
                // return wacDelete.init();

                break;
            default:
                console.log('[wacalytics] Unknown API method');
                console.log(event);

                defered.reject();

                return defered.promise;
        }
    }
};

/**
 * exports.handler
 * @param {LambdaEvent} event
 * @param {LamdbaContext} context
 * @void
 *
 * Exposes a handler function for incoming AWS Lambda event
 * and calls context.done when done
 */

exports.handler = function(event, context) {
    startTime = Date.now();

    console.log('[wacalytics] An event was triggered at ' + new Date());

    router.handleEvent(event)
        .then(function(response) {
            var duration = Date.now() - startTime;

            console.log('[wacalytics] Event processed in ' + duration + 'ms');

            try {
                context.succeed(response);
            } catch(e) {
                context.fail(e);
            }

            context.done();
        })
        .catch(function(e) {
            console.error(e.stack);

            context.fail(e);

            context.done();
        });
};