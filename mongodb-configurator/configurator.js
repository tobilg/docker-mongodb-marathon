"use strict";
var express = require('express');
var http = require('http');
var bodyParser = require('body-parser');
var winston = require('winston');
var zookeeper = require('node-zookeeper-client');

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

// Create ZooKeeper client
var zkClient = zookeeper.createClient(options.zkBaseConnection, {
  sessionTimeout: 5000,
  spinDelay : 1000,
  retries : 0
});

// Ensure that the configured ZK path/node exists
zkClient.exists(options.zkBaseNode, function (error, stat) {
  if (error) {
    logger.error(error);
  }
  if (stat) {
    logger.info("ensureZKPath: Node " + options.zkBaseNode + " exists.");
  } else {
    zkClient.create(options.zkBaseNode, function (error, path) {
      if (error) {
        logger.error(error);
      } else {
        logger.info("ensureZKPath: Node " + options.zkBaseNode + " is created.");
      }
    });
  }
});

// Load routes
var routes = require('./routes/all')(options, logger, zkClient);

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
app.use(function(c, res, next) {
  logger.error("Path "+ c.url +  " not found!");
  res.status = 404;
  next();
});

// Listen on provided port, on all network interfaces.
server.listen(options.webPort.internal);