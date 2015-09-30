/* global process */
var q   = require('q'),
    sql = require('mssql'),
    db  = null,
    _insertEvent = null,
    _insertEventId = null,
    _insertEventProperties = null;

db = {
    /**
     * init
     * @public
     * @return {Promise}
     *
     * Connects to the database and resolves a promise when done
     */

    init: function() {
        var defered = q.defer(),
            config = {
                user: process.env.SQL_USER,
                password: process.env.SQL_PASSWORD,
                server: process.env.SQL_SERVER,  
                database: process.env.SQL_DATABASE,
                options:{
                    port: '1433'
                }
            };
    
        sql.connect(config, function(err) {
            if (err) {
                defered.reject(err);	
            } else {
                defered.resolve();
            }
        });

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
        var tasks = [];
            
        events.forEach(function(event) {
            tasks.push(_insertEvent(event));
        });

        // tasks.push(_insertEvent(events[0]));
        
        return q.all(tasks);
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

_insertEvent = function(event) {
    return _insertEventId(event)
            .then(function(eventId) {
                return _insertEventProperties(event.data, eventId);  
            });
};

_insertEventId = function(event) {
    var defered = q.defer(),
        request = new sql.Request(),
        queryString = '',
        date = '',
        ipAddress = '',
        awsEventId = '',
        userId = '',
        interactionType = '';
    
    date = '\'' + event.date + ' ' + event.time + '\'';
    ipAddress = '\'' + event.ipAddress + '\'';
    awsEventId = '\'' + event._id + '\'';
    userId = '\'' + event.data.User_ID + '\'';
    interactionType = '\'' + event.data.Interaction_Type + '\'';
    
    queryString = 'INSERT INTO Events (EventDate, IpAddress, AwsEventId, UserId, InteractionType) VALUES (' 
                    + date + ',' 
                    + ipAddress + ',' 
                    + awsEventId + ',' 
                    + userId + ',' 
                    + interactionType + 
                    '); SELECT CAST(SCOPE_IDENTITY() as int) as Id';
    
    request.query(queryString, function(err, recordset) {
        if (err) {
            defered.reject(err);
        } else {
            defered.resolve(recordset[0].Id);
        }
    });
    
    return defered.promise;
};

_insertEventProperties = function(data, eventId) {
    var keys = Object.getOwnPropertyNames(data),
        defered = q.defer(),
        table = new sql.Table('EventProperties'),
        request = new sql.Request();
         
    table.columns.add('EventId', sql.Int, {nullable: false});
    table.columns.add('PropertyName', sql.NVarChar(50), {nullable: false});
    table.columns.add('PropertyValue', sql.NVarChar(sql.MAX), {nullable: true});
    
    keys.forEach(function(key) {
        table.rows.add(eventId, key, data[key]);    
    });
   
    request.bulk(table, function(err, rowCount) {
        if (err) {
            defered.reject(err);
        } else {
            defered.resolve();
        }
    });
    
    return defered.promise;
};

module.exports = db;