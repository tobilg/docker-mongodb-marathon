"use strict";
var express = require('express');
var http = require('http');
var bodyParser = require('body-parser');
var winston = require('winston');

// Load configuration
var options = require('./lib/config');

// Configure logger
var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      level: options.logLevel.toLowerCase(),
      timestamp: function() {
        return Date.now();
      },
      formatter: function(options) {
        // Return string will be passed to logger.
        return options.timestamp() + " " + options.level.toUpperCase() + " " + (undefined !== options.message ? options.message : "") +
            (options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : "" );
      }
    })
  ]
});

// Load routes
var routes = require('./routes/all')(options, logger);

// Instanciate Express.js
var app = express();

// Apply Express.js settings
app.set('port', options.webPort.internal);
app.set('env', options.nodeEnvironment.toLowerCase());

// Create HTTP server
var server = http.createServer(app);

// Add Express.js middleware & routes
app.use(bodyParser.json());
app.use('/', routes);

// Catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// Listen on provided port, on all network interfaces.
server.listen(options.webPort.internal);