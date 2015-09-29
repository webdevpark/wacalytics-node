/**
 * responseSchema
 */

var ResponseSchema = function() {
    this.success     = false;
    this.errors      = [];
    this.data        = {
        query: null,
        totalEvents: -1,
        totalMatchingEvents: -1,
        totalPages: -1,
        totalInPage: -1,
        page: -1,
        events: []
    };
};

module.exports = ResponseSchema;