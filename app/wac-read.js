'use strict';

var AWS             = require('aws-sdk'),
    marshaler       = require('dynamodb-marshaler'),
    TypedObject     = require('typed-object'),
    q               = require('q'),

    querySchema     = require('../schemas/query-schema'),
    responseSchema  = require('../schemas/response-schema'),

    wacRead         = null,
    dynamodb        = null;

wacRead = {

    /**
     * retrieveEvents
     * @param {String[]} keys
     * @return {Promise}
     */

    retrieveEvents: function(keys) {
        var defered = q.defer(),
            marshaledKeys = [],
            params = null,
            key = '',
            i = -1;

        for (i = 0; key = keys[i]; i++) {
            marshaledKeys.push({
                event_id: {
                    S: keys[i]
                }
            });
        }

        params = {
            RequestItems: {
                'events': {
                    Keys: marshaledKeys
                }
            }
        };

        dynamodb.batchGetItem(params, function(err, data) {
            var items = [];

            if (err) {
                defered.reject(err);
            }

            if (!data) {
                console.log('[wacalytics-read] No items retreived');
            } else {
                items = data.Responses.events.map(marshaler.unmarshalItem);

                console.log('[wacalytics-read] ' + items.length + ' items retreived');
            }

            defered.resolve(items);
        });

        return defered.promise;
    },

    /**
     * paginateKeys
     * @param {Number} limit
     * @param {Number} offset
     * @return {String[]}
     */

    paginateKeys: function(keys, limit, offset) {
        var paginatedKeys = [],
            startIndex = limit * (offset - 1),
            endIndex = startIndex + limit;

        paginatedKeys = keys.slice(startIndex, endIndex);

        return paginatedKeys;
    },

    /**
     * getMatchingKeys
     * @param {Object} params
     * @return {Promise} -> {String[]}
     */

    getMatchingKeys: function(params) {
        var defered = q.defer();

        console.log('[wacalytics-read] Querying DB...');

        dynamodb.query(params, function(err, data) {
            var keys = [];

            if (err) {
                defered.reject(err);
            }

            if (!data) {
                console.log('[wacalytics-read] No items found');
            } else {
                keys = data.Items.map(function(item) {
                    return marshaler.unmarshalItem(item).event_id;
                });

                console.log('[wacalytics-read] ' + data.Count + ' matching items found');
            }

            defered.resolve(keys);
        });

        return defered.promise;
    },

    /**
     * buildDynamoQuery
     * @param {Query} query
     * @return {Object}
     */

    buildDynamoQuery: function(query) {
        var filterConditionStrings      = [],
            filterExpression            = '',
            expressionAttributeValues   = null,
            params                      = null,
            condition                   = null,
            valueObj                    = null,
            typeIdentifier              = '',
            sanitizedKey                = '',
            sanitizedVar                = '',
            i                           = -1;

        // Populate the default, top-level expression attributes

        expressionAttributeValues = {
            ':v_source': {
                S: 'Website'
            },
            ':v_startTime': {
                N: query.startTime.toString()
            },
            ':v_endTime': {
                N: query.endTime.toString()
            }
        };

        // Parse the query conditions into an expression with attributes

        for (i = 0; condition = query.conditions[i]; i++) {
            sanitizedVar = ':v_' + condition.property.replace(/ /g, '_'),
            sanitizedKey = 'event_data.' + condition.property.replace(/ /g, '_'),
            valueObj = {};

            switch (typeof condition.value) {
                case 'string':
                    typeIdentifier = 'S';

                    break;
                case 'number':
                    typeIdentifier = 'N';

                    break;
                case 'boolean':
                    typeIdentifier = 'B';

                    break;
            }

            if (condition.value) {
                valueObj[typeIdentifier] = condition.value.toString();
            }

            switch (condition.operator.toLowerCase()) {
                case 'exists':
                    // e.g. "attribute_exists (data.Errors)"

                    filterConditionStrings.push(
                        'attribute_exists (' + sanitizedKey + ')'
                    );

                    break;
                case 'not_exists':
                    // e.g. "attribute_not_exists (data.Errors)"

                    filterConditionStrings.push(
                        'attribute_not_exists (' + sanitizedKey + ')'
                    );

                    break;
                case 'contains':
                    expressionAttributeValues[sanitizedVar + '_substring'] = valueObj;

                    // e.g. "contains (data.User_Email, :v_data.User_Email-substring)"

                    filterConditionStrings.push(
                        'contains (' + sanitizedKey + ', ' + sanitizedVar + '_substring)'
                    );

                    break;
                default:
                    // All other operators: '=', '<>', '<', '>', '<=', '>='

                    expressionAttributeValues[sanitizedVar] = valueObj;

                    // e.g. "data.User_Email = :v_data.User_Email"

                    filterConditionStrings.push(
                        sanitizedKey + ' ' + condition.operator + ' ' + sanitizedVar
                    );
            }
        }

        // Join all the condition strings into a single string with "AND" seperators

        // e.g. "data.User_Email = v:_data.User_Email AND data.Interaction_Type = v:_data.Interaction_Type"

        filterExpression = filterConditionStrings.join(' AND ');

        // Create the params object with the constructed values

        params = {
            TableName: 'events', // Database table name
            IndexName: 'event_source-event_timeStamp-index', // index neccessary for secondary key queries
            KeyConditionExpression: // Top-level conditions
                '(event_timeStamp BETWEEN :v_startTime AND :v_endTime) AND ' +
                'event_source = :v_source',
            ExpressionAttributeValues: expressionAttributeValues, // All attributes
            ProjectionExpression: 'event_id'
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression; // Conditions on nested properties
        }

        return params;
    },

    /**
     * init
     * @param {Query} query
     * @return {Promise}
     */

    init: function(json) {
        var self            = this,
            params          = null,
            totalMatching   = -1,
            startTime       = Date.now(),
            query           = null,
            newQuery        = new TypedObject(querySchema),
            response        = null;

        try {
            query = JSON.parse(json);
        } catch(e) {
            console.error('[wacalytics-read] The provided query paramter could not be parsed');

            query = {};
        }

        response = new TypedObject(responseSchema);

        // Init S3 APIs

        dynamodb = new AWS.DynamoDB({
            apiVersion: '2012-08-10'
        });

        try {
            newQuery.startTime      = query.startTime || 0;
            newQuery.endTime        = query.endTime || Date.now();
            newQuery.conditions     = query.conditions || [];
            newQuery.resultsPerPage = Math.min(100, query.resultsPerPage || 10);
            newQuery.page           = Math.max(1, query.page || 1);
        } catch(e) {
            console.warn('[wacalytics-read] WARNING: The provided query was invalid');

            response.errors.push(e);

            throw e;
        }

        // Convert TypedObject to a normal object
        // before builder query

        params = self.buildDynamoQuery(newQuery.toObject());

        return self.getMatchingKeys(params)
            .then(function(keys) {
                var duration = Date.now() - startTime,
                    paginatedKeys = [];

                totalMatching = keys.length;
                paginatedKeys = self.paginateKeys(keys, newQuery.resultsPerPage, newQuery.page);

                console.log('[wacalytics-read] DB query executed in ' + duration + 'ms');

                startTime = Date.now();

                return self.retrieveEvents(paginatedKeys);
            })
            .then(function(events) {
                var duration = Date.now() - startTime;

                response.success = true;

                console.log('[wacalytics-read] DB retrieval executed in ' + duration + 'ms');

                response.data.totalEvents   = totalMatching;
                response.data.page          = newQuery.page;
                response.data.totalPages    = Math.ceil(totalMatching / newQuery.resultsPerPage);
                response.data.events        = events;
                response.data.totalInPage   = events.length;

                return response.toObject();
            })
            .catch(function(e) {
                response.errors.push(e);

                console.error(e.stack);
            });
    }
};

module.exports = wacRead;