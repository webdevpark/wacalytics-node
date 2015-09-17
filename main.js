var wacalytics  = require('./wacalytics'),
    DynamoDBModel = null;

exports.handler = function(event, context) {
    wacalytics.handleEvent(event)
        .then(function() {
            context.done();
        })
        .catch(function(e) {
            console.error(e.stack);
        });
};