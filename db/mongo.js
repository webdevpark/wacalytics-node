/* global process */
var mongoosePage        = require('mongoose-pagination'),
    mongooseQ           = require('mongoose-q'),
    mongoose            = require('mongoose'),
    q                   = require('q'),

    eventSchema         = require('../schemas/event-schema-mongo'),

    EventModel          = null,
    db                  = null,
    _buildMongoQuery    = null;

db = {
    isConnectionOpen: false,

    /**
     * init
     * @public
     * @return {Promise}
     */

    init: function() {
        var defered = q.defer(),
            dbType = '',
            connectionString = '';

        if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
            switch (process.env.AWS_LAMBDA_FUNCTION_NAME) {
                case 'wacalytics-node-live':
                    // Live
                    dbType = 'LIVE';

                    break;
                case 'wacalytics-node-production':
                    // Stage (TODO: rename to stage)
                    dbType = 'STAGE'

                    break;
            }
        } else {
            // Local Development

            dbType = 'DEV';
        }

        connectionString =
            process.env['MONGODB_' + dbType + '_USERNAME'] +
                ':' +
                process.env['MONGODB_' + dbType + '_PASSWORD'] +
                '@' +
                process.env['MONGODB_' + dbType + '_HOST'] +
                ':' +
                process.env['MONGODB_' + dbType + '_PORT'] +
                '/' +
                process.env['MONGODB_' + dbType + '_NAME'];

        console.log('[wacalytics-mongo] Connected to DB at:', connectionString);

        try {
            if (!db.connectionOpen) {
                mongooseQ(mongoose);

                mongoose.connect(connectionString, function(err) {
                    if (err) {
                        defered.reject(err);
                    } else {
                        db.connectionOpen = true;

                        EventModel = mongoose.model('Event', eventSchema);

                        console.log('[wacalytics-mongo] Connected to DB successfully');

                        defered.resolve();
                    }
                });
            }
        } catch (e) {
            console.error(e.stack);

            console.log('[wacalytics-mongo] Could not connect to DB');

            defered.reject(e);
        }

        return defered.promise;
    },

    /**
     * write
     * @public
     * @param {EventSchema[]} events
     * @return {Promise}
     */

    write: function(events) {
        return EventModel.createQ(events);
    },

    /**
     * read
     * @public
     * @param {Object} query
     * @param {Promise} -> {Object}
     */

    read: function(query) {
        var defered = q.defer(),
            mongoQuery = _buildMongoQuery(query);

        EventModel
            .find(mongoQuery)
            .paginate(query.page, query.resultsPerPage, function(err, events, totalMatchingEvents) {
                if (err) {
                    defered.reject(err);
                }

                defered.resolve({
                    events: events,
                    totalMatchingEvents: totalMatchingEvents,
                });
            });

        return defered.promise;
    },

    /**
     * getTotalEvents
     * @public
     * @return {Promise} -> {Number}
     */

    getTotalEvents: function() {
        var defered = q.defer();

        EventModel.collection.stats(function(err, stats) {
            if (err) {
                return defered.reject(err);
            }

            defered.resolve(stats.count);
        });

        return defered.promise;
    }
};

/**
 * buildMongoQuery
 * @private
 * @param {Object} query
 * @return {Object}
 */

_buildMongoQuery = function(query) {
    var mongoQuery = {};

    mongoQuery.timeStamp = {
        $gt: query.startTime || 0,
        $lt: query.endTime || Math.round(Date.now() / 1000)
    };

    query.conditions.forEach(function(condition) {
        var sanitizedKey = 'data.' + condition.property.replace(/ /g, '_');

        switch(condition.operator) {
            case '=':
                mongoQuery[sanitizedKey] = condition.value;

                break;
            case '!=':
                mongoQuery[sanitizedKey] = {
                    $ne: condition.value
                };

                break;
            case 'exists':
                mongoQuery[sanitizedKey] = {
                    $exists: true
                };

                break;
            case 'not exists':
                mongoQuery[sanitizedKey] = {
                    $exists: false
                };

                break;
            case 'contains':
                mongoQuery[sanitizedKey] = {
                    $regex: new RegExp(condition.value, 'i')
                };

                break;
            case 'starts with':
                mongoQuery[sanitizedKey] = {
                    $regex: new RegExp('^' + condition.value, 'i')
                };
        }
    });

    return mongoQuery;
};

module.exports = db;