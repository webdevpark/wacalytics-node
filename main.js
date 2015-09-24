var wacalytics  = require('./wacalytics'),
    DynamoDBModel = null,
    startTime = -1;

exports.handler = function(event, context) {
    startTime = Date.now();

    wacalytics.handleEvent(event)
        .then(function() {
            var duration = Date.now() - startTime;

            console.log('[wacalytics] Event processed in ' + duration + 'ms');

            context.done();
        })
        .catch(function(e) {
            console.error(e.stack);
        });
};