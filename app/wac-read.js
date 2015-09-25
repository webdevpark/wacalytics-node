'use strict';

var AWS         = require('aws-sdk'),
    marshaler   = require('dynamodb-marshaler'),
    TypedObject = require('typed-object'),
    q           = require('q'),

    querySchema = require('../schemas/query-schema'),

    wacRead     = null,
    dynamodb    = null;

wacRead = {

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
            TableName: 'events',
            IndexName: 'event_source-event_timeStamp-index', // index neccessary for secondary key queries
            KeyConditionExpression: // Top-level conditions
                '(event_timeStamp BETWEEN :v_startTime AND :v_endTime) AND ' +
                'event_source = :v_source',
            FilterExpression: filterExpression, // Nested conditions
            ExpressionAttributeValues: expressionAttributeValues // All attributes
        };

        return params;
    },

    /**
     * init
     * @param {Query} query
     * @return {Promise}
     */

    init: function(query) {
        var self = this,
            defered = q.defer(),
            params = null,
            newQuery = new TypedObject(querySchema);

        // Init S3 APIs

        dynamodb = new AWS.DynamoDB({
            apiVersion: '2012-08-10'
        });

        try {
            newQuery.startTime  = query.startTime;
            newQuery.endTime    = query.endTime;

            newQuery.conditions.concat(query.conditions);
        } catch(e) {
            console.warn('[wacalytics] WARNING: The provided query failed validation');
            console.error(e);

            defered.resolve();

            return defered.promise;
        }

        params = self.buildDynamoQuery(newQuery);

        console.log('[wacalytics] Querying DB...');

        dynamodb.query(params, function(err, data) {
            var items = [];

            if (err) {
                defered.reject(err);
            }

            if (!data) {
                console.log('[wacalytics] No items found');
            } else {
                items = data.Items.map(marshaler.unmarshalItem);

                console.log('[wacalytics] ' + data.Count + ' items found');

                // console.log(items[0]);
            }

            defered.resolve();
        });

        return defered.promise;
    }
};

module.exports = wacRead;