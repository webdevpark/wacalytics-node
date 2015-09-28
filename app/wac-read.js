'use strict';

var AWS             = require('aws-sdk'),
    marshaler       = require('dynamodb-marshaler'),
    TypedObject     = require('typed-object'),
    atob            = require('atob'),
    q               = require('q'),

    querySchema     = require('../schemas/query-schema'),
    ResponseSchema  = require('../schemas/response-schema'),

    wacRead         = null,
    dynamodb        = null,

    TABLE_NAME      = 'events';

wacRead = {

    /**
     * init
     * @param {Query} query
     * @return {Promise}
     *
     * Manages the full lifecycle of any incoming API GET request
     */

    init: function(base64) {
        var self            = this,
            defered         = q.defer(),
            params          = null,
            totalEvents     = -1,
            totalMatching   = -1,
            startTime       = Date.now(),
            query           = null,
            responseSchema  = new ResponseSchema(),
            response        = new TypedObject(responseSchema);

        // Init S3 APIs

        dynamodb = new AWS.DynamoDB({
            apiVersion: '2012-08-10'
        });

        try {
            // Decode and validate user provided query

            query = self.decodeQuery(base64);
            query = self.validateQuery(query);

            // Generate DynamoDB query params from query

            params = self.buildDynamoQuery(query);
        } catch(e) {
            // If errors, response with success false and errors

            response.errors.push(e);

            defered.resolve(response.toObject());

            return defered.promise;
        }

        return q.all([
            self.getMatchingKeys(params),
            self.getTableInfo()
        ])
            .spread(function(keys, tableInfo) {
                var duration = Date.now() - startTime,
                    paginatedKeys = [];

                totalEvents = tableInfo.ItemCount;
                totalMatching = keys.length;
                paginatedKeys = self.paginateKeys(keys, query.resultsPerPage, query.page);

                console.log('[wacalytics-read] DB query executed in ' + duration + 'ms');

                startTime = Date.now();

                return self.retrieveEvents(paginatedKeys);
            })
            .then(function(events) {
                var duration = Date.now() - startTime;

                response.success = true;

                console.log('[wacalytics-read] DB retrieval executed in ' + duration + 'ms');

                response.data.totalEvents           = totalEvents;
                response.data.totalMatchingEvents   = totalMatching;
                response.data.page                  = query.page;
                response.data.totalPages            = Math.ceil(totalMatching / query.resultsPerPage);
                response.data.events                = events;
                response.data.totalInPage           = events.length;

                console.log('[wacalytics-read] Reponse: ', response.toObject());

                return response.toObject();
            })
            .catch(function(e) {
                response.errors.push(e);

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
            TableName: TABLE_NAME, // Database table name
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
     * getTableInfo
     * @return {Promise} -> {Object}
     */

    getTableInfo: function() {
        var defered = q.defer();

        dynamodb.describeTable({
            TableName: TABLE_NAME
        }, function(err, data) {
            if (err) {
                defered.reject(err);
            }

            defered.resolve(data.Table);
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

        if (!keys.length) {
            defered.resolve([]);

            return defered.promise;
        }

        for (i = 0; key = keys[i]; i++) {
            marshaledKeys.push({
                event_id: {
                    S: keys[i]
                }
            });
        }

        params = {
            RequestItems: {}
        };

        params.RequestItems[TABLE_NAME] = {
            Keys: marshaledKeys
        };

        dynamodb.batchGetItem(params, function(err, data) {
            var items = [];

            if (err) {
                console.log('error');

                defered.reject(err);

                return;
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
    }
};

module.exports = wacRead;