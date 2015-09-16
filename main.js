// For development/testing purposes
exports.handler = function(event, context) {
  console.log( "Running main.handler" );
  console.log( "==================================");
  console.log( "event", event );
  console.log( "==================================");
  console.log( "Stopping main.handler" );

  context.done( );
}