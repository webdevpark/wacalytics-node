/* global process */
var q   = require('q'),
    db  = null;

db = {
    /**
     * init
     * @public
     * @return {Promise}
     *
     * Connects to the database and resolves a promise when done
     */

    init: function() {
        var defered = q.defer();

        return defered.promise;
    },

    /**
     * write
     * @public
     * @param {EventSchema[]} events
     * @return {Promise}
     *
     * Writes an array of events to the database
     */

    write: function(events) {
        var defered = q.defer();

        return defered.promise;
    },

    /**
     * read
     * @public
     * @param {QuerySchema} query
     * @param {Promise} -> {Object}
     *
     * Queries the database with a user-defined query and resolves
     * a promise when complete. The promise is resolved with an object
     * containing an array of matching events within the paginated
     * limit, and the number of total matching events before pagination
     * is applied.
     */

    read: function(query) {
        var defered = q.defer();

        return defered.promise;
    },

    /**
     * getTotalEvents
     * @public
     * @return {Promise} -> {Number}
     *
     * Retrieves the total number of events currently in the database
     */

    getTotalEvents: function() {
        var defered = q.defer();

        return defered.promise;
    }
};

module.exports = db;