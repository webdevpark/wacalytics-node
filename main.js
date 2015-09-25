var wacCreate    = require('./app/wac-create'),
    wacRead      = require('./app/wac-read'),
    wacUpdate    = require('./app/wac-update'),
    wacDelete    = require('./app/wac-delete'),

    q            = require('q'),

    router       = null,
    exampleQuery = null,
    startTime    = -1;

// An example query for testing wacRead:

exampleQuery = {
    startTime: 0,
    endTime: 9999999999,
    conditions: [
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
    ]
};

router = {
    /**
     * eventBus
     * @param {Record} record
     * @return {Promise}
     *
     * The eventBus checks for the record's "eventName"
     * property and delagates it to the appropriate handler method
     */

    eventBus: function(record) {
        switch (record.eventName) {
            case 'ObjectCreated:Put':
                console.log('[wacalytics] Incoming "ObjectCreated:Put" event');

                return wacCreate.init(record);
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

    if (true) {
        // Read

        wacRead.init(exampleQuery)
            .then(function() {
                var duration = Date.now() - startTime;

                console.log('[wacalytics] Event processed in ' + duration + 'ms');

                context.done();
            })
            .catch(function(e) {
                console.error(e.stack);
            });
    } else {
        // Create

        router.handleEvent(event)
            .then(function() {
                var duration = Date.now() - startTime;

                console.log('[wacalytics] Event processed in ' + duration + 'ms');

                context.done();
            })
            .catch(function(e) {
                console.error(e.stack);
            });
    }
};