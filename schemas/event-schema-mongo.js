var eventSchema = null,
    mongoose    = require('mongoose');

/**
 * eventSchema
 */

eventSchema = mongoose.Schema({
    _id: String,
    timeStamp: Number,
    date: String,
    time: String,
    userAgent: String,
    ipAddress: String,
    location: String,
    data: {}
}, {
    collection: 'events'
});

module.exports = eventSchema;