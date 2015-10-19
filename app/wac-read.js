/* global process */
'use strict';

var TypedObject     = require('typed-object'),
    atob            = require('atob'),
    q               = require('q'),

    ResponseSchema  = require('../schemas/response-schema'),
    querySchema     = require('../schemas/query-schema'),
    db              = require('../db/' + process.env.DB_TYPE),

    EventModel      = null,
    wacRead         = null,
    testQuery       = null;

wacRead = {
    connectionOpen: false,

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
            startTime       = Date.now(),
            query           = null,
            responseSchema  = new ResponseSchema(),
            response        = new TypedObject(responseSchema);

        try {
            // Decode and validate user provided query

            if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
                // Remove AWS Environment

                if (base64) {
                    query = self.decodeQuery(base64);
                    query = self.validateQuery(query);
                } else {
                    throw new Error('You must include a query');
                }
            } else {
                // Local dev

                testQuery = require('../test-query');

                query = self.validateQuery(testQuery);
            }
        } catch(e) {
            // If errors, response with success false and errors

            console.error(e);

            response.errors.push(e);

            defered.resolve(response.toObject());

            return defered.promise;
        }

        return db.init()
            .then(function() {
                var duration = Date.now() - startTime;

                startTime = Date.now();

                console.log('[wacalytics-read] DB connection opened in ' + duration + 'ms');

                return q.all([
                    db.read(query),
                    db.getTotalEvents()
                ]);
            })
            .spread(function(eventData, totalEvents) {
                var duration = Date.now() - startTime;

                startTime = Date.now();

                console.log('[wacalytics-read] DB query completed in ' + duration + 'ms');

                response.success                    = true;
                response.data.totalMatchingEvents   = eventData.totalMatchingEvents;
                response.data.totalEvents           = totalEvents;
                response.data.totalInPage           = eventData.events.length;
                response.data.events                = eventData.events;
                response.data.page                  = query.page;
                response.data.query                 = query;

                response.data.totalPages
                    = Math.ceil(eventData.totalMatchingEvents / query.resultsPerPage);

                console.log('[wacalytics-read] ' + eventData.totalMatchingEvents + ' event(s) found');
                console.log('[wacalytics-read] ' + totalEvents + ' event(s) in database');

                if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
                    // If running locally

                    console.log(response.toObject());
                }

                return response.toObject();
            })
            .catch(function(e) {
                console.error(e.stack);

                return response.toObject();
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
            newQuery.userId         = query.userId || '';
            newQuery.userEmail      = query.userEmail || '';
            newQuery.name           = query.name || '';
            newQuery.conditions     = query.conditions || [];
            newQuery.resultsPerPage = Math.min(100, query.resultsPerPage || 10);
            newQuery.page           = Math.max(1, query.page || 1);
        } catch(e) {
            console.warn('[wacalytics-read] WARNING: The provided query was invalid');

            throw e;
        }

        return newQuery.toObject();
    }
};

module.exports = wacRead;