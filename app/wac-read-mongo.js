/* global process */
'use strict';

var TypedObject     = require('typed-object'),
    mongooseQ       = require('mongoose-q'),
    mongoose        = require('mongoose'),
    atob            = require('atob'),
    q               = require('q'),

    ResponseSchema  = require('../schemas/response-schema'),
    querySchema     = require('../schemas/query-schema'),
    eventSchema     = require('../schemas/event-schema-mongo'),

    EventModel      = null,
    wacRead         = null,
    initDb          = null;

initDb = function() {
    var connectionString =
            process.env.MONGODB_USERNAME +
            ':' +
            process.env.MONGODB_PASSWORD +
            '@' +
            process.env.MONGODB_HOST +
            ':' +
            process.env.MONGODB_PORT +
            '/' +
            process.env.MONGODB_NAME;

    // extend mongoose with Q methods

    mongooseQ(mongoose);

    // Init DB

    mongoose.connect(connectionString);

    // Create Models

    EventModel = mongoose.model('Event', eventSchema);
};

wacRead = {

    /**
     * init
     * @param {Query} query
     * @param {MongooseModel} EventModel
     * @return {Promise} -> {Response}
     *
     * Manages the full lifecycle of any incoming API GET request
     */

    init: function(base64) {
        var self            = this,
            defered         = q.defer(),
            totalEvents     = -1,
            totalMatching   = -1,
            startTime       = Date.now(),
            query           = null,
            mongoQuery      = null,
            responseSchema  = new ResponseSchema(),
            response        = new TypedObject(responseSchema);

        initDb();

        try {
            // Decode and validate user provided query

            query = self.decodeQuery(base64);
            query = self.validateQuery(query);

            // Generate DynamoDB query params from query

            mongoQuery = self.buildMongoQuery(query);
        } catch(e) {
            // If errors, response with success false and errors

            response.errors.push(e);

            defered.resolve(response.toObject());

            return defered.promise;
        }

        console.log(mongoQuery);

        return EventModel.findQ(mongoQuery, '--v', {
            skip: query.resultsPerPage * query.page - 1,
            limit: query.resultsPerPage
        })
            .then(function(events) {
                response.success        = true;
                response.data.events    = events;
                response.data.page      = query.page;

                console.log(response.toObject());

                return response.toObject();
            })
            .catch(function(e) {
                console.log(e);
            });
    },

    /**
     * decodeQuery
     * @param {String} base64
     * @return {Object}
     */

    decodeQuery: function(base64) {
        var json = '',
            query = null;

        // Attempt to decode query

        try {
            json = atob(base64);
            query = JSON.parse(json);
        } catch(e) {
            console.warn('[wacalytics-read] The provided query parameter could not be parsed:', base64);

            throw e;
        }

        return query;
    },

    /**
     * validateQuery
     * @param {Object} query
     * @return {Query}
     */

    validateQuery: function(query) {
        var newQuery = new TypedObject(querySchema);

        // Build typed query object

        try {
            newQuery.startTime      = query.startTime || 0;
            newQuery.endTime        = query.endTime || Date.now();
            newQuery.conditions     = query.conditions || [];
            newQuery.resultsPerPage = Math.min(100, query.resultsPerPage || 10);
            newQuery.page           = Math.max(1, query.page || 1);
        } catch(e) {
            console.warn('[wacalytics-read] WARNING: The provided query was invalid');

            throw e;
        }

        return newQuery.toObject();
    },

    /**
     * buildMongoQuery
     * @param {Object} query
     * @return {Object}
     */

    buildMongoQuery: function(query) {
        var mongoQuery    = {};

        mongoQuery.timeStamp = {
            $gt: query.startTime,
            $lt: query.endTime
        };

        query.conditions.forEach(function(condition) {
            var sanitizedKey = 'data.' + condition.property.replace(/ /g, '_');

            switch(condition.operator) {
                case '=':
                    mongoQuery[sanitizedKey] = condition.value;

                    break;
                case 'exists':
                    mongoQuery[sanitizedKey] = {
                        $exists: true
                    };

                    break;
                case 'not_exists':
                    mongoQuery[sanitizedKey] = {
                        $exists: false
                    };

                    break;
                case 'contains':
                    mongoQuery[sanitizedKey] = {
                        $regex: condition.value
                    };
            }
        });

        return mongoQuery;
    }
};

module.exports = wacRead;