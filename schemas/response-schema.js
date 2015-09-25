/**
 * responseSchema
 */

var responseSchema = {
    success: false,
    errors: [],
    data: {
        totalEvents: -1,
        totalPages: -1,
        totalInPage: -1,
        page: -1,
        events: []
    }
};

module.exports = responseSchema;