var eventSchema = null,
    mongoose    = require('mongoose');

/**
 * eventSchema
 */

eventSchema = mongoose.Schema({
    _id: String,
    timeStamp: Number,
    userAgent: String,
    ipAddress: String,
    userId: String,
    userEmail: String,
    location: String,
    name: String,
    data: {}
}, {
    collection: 'events'
});

module.exports = eventSchema;