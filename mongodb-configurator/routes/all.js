"use strict";
var express = require('express');

var Q = require('q');
var MarathonLib = require('../lib/marathon');
var MongoDBLib = require('../lib/mongodb');

module.exports = function(options, logger, zkClient){

  logger.info(JSON.stringify(options));

  var marathon = new MarathonLib(options.marathonUrl, logger);
  var mongoDb = new MongoDBLib(options.host, options.mongoDbPort.public, options.replicaSet, logger);
  var router = express.Router();
  var zkNode = options.zkBaseNode + options.marathonAppId.replace(/(?!^)\//g, '-');
  var zkNodeFinished = zkNode + "/setupFinished";
  var eventCache = [],
      isReady = false,
      isHealthy = true;

  // Steps
  // 1.) Create ZK lock
  // 2.) Setup the event hook for Marathon scaling events (up/down), cache events until 4.)
  // 3.) Init ReplicaSet on Primary
  // 4.) After timeout, get app tasks from Marathon combined with the cached scaling events
  //     1.) Combine and group
  //     2.) Create config
  // 5.) Reconfigure ReplicaSet (execution of other reconfigures if events occur need to be blocked until they are finished!)

  function checkInitialRun() {
    var deferred = Q.defer();

    zkClient.exists(zkNode, function (error, stat) {
      if (error) {
        deferred.reject(error.stack);
      }

      if (stat) {
        logger.info("checkInitialRun: Node " + zkNode + " exists.");

        deferred.resolve(false);
        //TODO: Check if isMaster === false and version === 1, then delete

      } else {
        zkClient.create(zkNode, function (error, path) {
          if (error) {
            deferred.reject(error.stack);
          } else {
            logger.info("checkInitialRun: Node " + zkNode + " is created.");
            deferred.resolve(true);
          }
        });
      }
    });

    return deferred.promise;

  }

  function waitForStartupAndConfigure(initResult) {
    var deferred = Q.defer();

    logger.info("waitForStartupAndConfigure: initResult: " + JSON.stringify(initResult));

    setTimeout(function() {

      marathon.getAppTasks(options.marathonAppId)
          .then(marathon.getConnectionsFromTasks.bind(marathon))
          .then(function(tasks) {
            logger.info("waitForStartupAndConfigure: got tasks: " + JSON.stringify(tasks));

            // Now, unify via object properties
            var nodes = [],
                nodesObj = {};

            // Add existing tasks from Marathon
            tasks.forEach(function(task){
              nodesObj[task.connectionString] = {host: task.host, port: task.port};
            });

            // Mixin the tasks from the events already gathered
            eventCache.forEach(function(event){
              // Remove node if found and set to be removed
              if (event.action === "remove" && nodesObj[event.connectionString]) {
                delete nodesObj[event.connectionString];
              } else {
                // In case the connectioNString already exists, it will be just overwritten (to filter out duplicates)
                nodesObj[event.connectionString] = {host: event.host, port: event.port};
              }
            });

            // Rebuild unified nodes array
            for (var key in nodesObj) {
              nodes.push(nodesObj[key]);
            }

            logger.info("waitForStartupAndConfigure: unified nodes: " + JSON.stringify(nodes));

            return mongoDb.getReplicaSetConfig()
                .then(mongoDb.addNodesToConfig.bind(mongoDb, nodes))
                .then(mongoDb.reconfigureReplicaSet.bind(mongoDb));

          })
          .then(function(result) {
            logger.info("waitForStartupAndConfigure: reconfigureReplicaSet result: " + JSON.stringify(result));
            deferred.resolve(result);
          })
          .catch(function(error) {
            logger.error("waitForStartupAndConfigure: Error: " + JSON.stringify(error));
            deferred.reject(error);
          });

    }, options.replicaSetTimeout);

    return deferred.promise;
  }

  function createAppNode(nodeName) {
    var deferred = Q.defer();

    zkClient.create(nodeName, function (error, path) {
      if (error) {
        deferred.reject(error.stack);
      } else {
        logger.info("createAppNode: Node " + zkNode + " is created.");
        deferred.resolve(true);
      }
    });

    return deferred.promise;
  }

  function deleteAppNode() {
    var deferred = Q.defer();

      // Check if base node exists
    zkClient.exists(zkNode, function (error, stat) {
      if (error) {
        deferred.reject(error.stack);
      }

      // Exists
      if (stat) {

          // If base node exists, check if finished node exists (recursive deletion)
          zkClient.exists(zkNodeFinished, function (error, stat) {
              if (error) {
                  deferred.reject(error.stack);
              }

              // If finished node exists, remove
              if (stat) {

                  // Remove zkNodeFinished node
                  zkClient.remove(zkNodeFinished, function (error) {
                      if (error) {
                          deferred.reject(error.stack);
                      } else {
                          // Remove zkNode
                          zkClient.remove(zkNode, function (error) {
                              if (error) {
                                  deferred.reject(error.stack);
                              } else {
                                  deferred.resolve(true);
                              }
                          });
                      }
                  });

              } else {
                  // Remove zkNode
                  zkClient.remove(zkNode, function (error) {
                      if (error) {
                          deferred.reject(error.stack);
                      } else {
                          deferred.resolve(true);
                      }
                  });
              }

          });

      } else {
        deferred.resolve(false);
      }

    });

    return deferred.promise;
  }

  zkClient.once('connected', function () {
    logger.info('Connected to ZooKeeper.');
    checkInitialRun()
      .then(function(isInitialRun) {
        if (isInitialRun) {
          marathon.setupEventCallback(options.host, options.webPort.public)
            .then(function() {

                // Give MongoDB time to start before we issue the replicaSet init command
                setTimeout(function(){

                  mongoDb.initializeReplicaSet()
                      .then(waitForStartupAndConfigure)
                      .then(function(result) {
                          // Now we are ready to handle the events from Marathon
                          isReady = true;

                          zkClient.create(zkNodeFinished, function (error, path) {
                              if (error) {
                                  logger.info("setupFinished: Received error: " + JSON.stringify(error));
                              } else {
                                  logger.info("setupFinished: Node " + zkNode + "/setupFinished was created.");
                              }
                          });

                      }).catch(function(error) {
                        logger.error("Error: " + JSON.stringify(error));
                      });

                }, options.initTimeout);

              })
            .catch(function(error) {
              logger.error("Error: " + JSON.stringify(error));
            });
        } else {
            // Check if setupFinished node exists in ZooKeeper
            zkClient.exists(zkNodeFinished, function (event) {
                logger.info("Got watcher event " + event.name + " for " + zkNodeFinished);

                // If the setupFinished node is created, also set the event callback for the then secondary nodes.
                // This is done so that when the primary/master node goes down, the secondary can step in and listen
                // for the event callback scaling events.
                // The secondaries will ignore all events if mongoDb.isMaster() is false.
                if (event.name && event.name === "NODE_CREATED") {
                    marathon.setupEventCallback(options.host, options.webPort.public)
                        .then(function() {
                            // Signal readiness to consume the Marathon events
                            isReady = true;
                            logger.info("Event listener was created for host " + options.host + " on port " + options.webPort.public);
                        }).catch(function(error) {
                            logger.error("Error: " + JSON.stringify(error));
                        });
                }

            }, function (error, stat) {
                if (error) {
                    logger.error(error.stack);
                    return;
                }

                if (stat) {
                    logger.info("Node " + zkNodeFinished + " exists.");
                } else {
                    logger.info("Node " + zkNodeFinished + " does not exist.");
                }
            });
        }
      })
      .catch(function(error) {
          logger.error("Error" + JSON.stringify(error));
      });
  });

  // START HERE:
  // Connect to ZooKeeper
  zkClient.connect();

  // Trap for SIGTERM -> Health check will return 503
  process.on('SIGTERM', function () {
    // We're no longer healthy...
    isHealthy = false;

    // Check if current node is a master node
    mongoDb.isMaster()
        .then(function(isMasterObj) {
          logger.info("SIGTERM: isMaster: " + JSON.stringify(isMasterObj));
          if (isMasterObj.isMaster) {

            // If we're on the Master/Primary node, remove subscription
            marathon.removeEventCallback(options.host, options.webPort.public)
                .then(function(response) {
                  logger.info("SIGTERM: removeEventCallback: response: " + JSON.stringify(response));
                });

          }
        }).catch(function(error) {
          logger.error("SIGTERM: Error: " + JSON.stringify(error));
        });

  });

  /* GET default page. */
  router.get('/', function(req, res, next) {
    res.send("Mesos MongoDB configurator is online!");
  });

  /* POST events endpoint. */
  router.post('/events', function(req, res, next) {

    // Check for appropriate events (same Marathon appId and eventType is of 'status_update_event'
    if (req.body.eventType === "status_update_event" && req.body.appId === options.marathonAppId) {

      logger.info("handleEventSubscription: Got event: " + JSON.stringify(req.body));

      // Check if current node is a master node
      mongoDb.isMaster()
        .then(function(isMasterObj) {
          logger.info("handleEventSubscription: isMaster: " + JSON.stringify(isMasterObj));
          if (isMasterObj.isMaster) {

            var event = {
              timestamp: req.body.timestamp,
              host: req.body.host,
              port: req.body.ports[1],
              connectionString: req.body.host + ":" + req.body.ports[1]
            };

            switch (req.body.taskStatus) {
              case "TASK_RUNNING":
                event.action = "add";
                break;
              case  "TASK_FINISHED":
                event.action = "remove";
                break;
              case "TASK_FAILED":
                event.action = "remove";
                break;
              case "TASK_KILLED":
                event.action = "remove";
                break;
              case "TASK_LOST":
                event.action = "remove";
                break;
              default:
                event = {};
                break;
            }

            // If we aren't ready, cache the event
            if (!isReady) {
              eventCache.push(event);
              logger.info("Event was cached!");
            } else {
              if (event.action && event.action === "add") {
                mongoDb.addMongoDbMember(event.host, event.port)
                  .then(function(result) {
                      logger.info("addMongoDbMember: Result: " + JSON.stringify(result));
                  })
                  .catch(function(error) {
                      logger.error("addMongoDbMember: Error: " + JSON.stringify(error));
                  });
              }
              if (event.action && event.action === "remove") {
                mongoDb.removeMongoDbMember(event.host, event.port)
                  .then(function(result) {
                    logger.info("removeMongoDbMember: Result: " + JSON.stringify(result));
                  })
                  .catch(function(error) {
                    logger.error("removeMongoDbMember: Error: " + JSON.stringify(error));
                  });
              }
            }

          }
        })
        .catch(function(error) {
          logger.error("Error" + JSON.stringify(error));
        });

    } else {
      //logger.info("Ignored event: " + JSON.stringify(req.body));
    }
    // Send response code 200
    res.status(200).end();
  });

  /* GET config page. */
  router.get('/config', function(req, res, next) {
    mongoDb.getReplicaSetConfig()
      .then(function(config) {
        res.send(config)
      }).catch(function(error) {
        res.status(500).send({"message": "An error occured", error: error});
      });
  });

  /* GET status page. */
  router.get('/status', function(req, res, next) {
    mongoDb.getReplicaSetStatus()
        .then(function(status) {
          res.send(status)
        }).catch(function(error) {
          res.status(500).send({"message": "An error occured", error: error});
        });
  });

  /* GET health check page. */
  router.get('/health', function(req, res, next) {
    if (isHealthy) {
      res.status(200).send("OK");
    } else {
      // If the SIGTERM was received, a 503 should be returned
      // See: https://github.com/mesosphere/marathon/issues/712
      res.status(503).end();
    }
  });

  /* Delete ZK node for this app (for testing only) */
  router.get('/releaseLock', function(req, res, next) {
    deleteAppNode()
      .then(function(isDeleted) {
        if (isDeleted) {
          res.send({"message": "ZooKeeper node " + zkNode + " was deleted!"})
        } else {
          res.send({"message": "ZooKeeper node " + zkNode + " didn't exist!"})
        }
      }).catch(function(error) {
        res.status(500).send({"message": "An error occured", error: error});
      });
  });

  /* Delete Marathon REST API event subscription for this node */
  router.delete('/eventSubscription', function(req, res, next) {

    // Check if current node is a master node
    mongoDb.isMaster()
        .then(function(isMasterObj) {
          logger.info("deleteEventSubscription: isMaster: " + JSON.stringify(isMasterObj));
          if (isMasterObj.isMaster) {

            // If we're on the Master/Primary node, remove subscription
            marathon.removeEventCallback(options.host, options.webPort.public)
                .then(function(response) {
                  logger.info("deleteEventSubscription: removeEventCallback: response: " + JSON.stringify(response));
                  if (response && response.eventType && response.eventType === "unsubscribe_event") {
                    res.send({"message": "The subscription of the Marathon REST API for " + options.host + ":" + options.webPort.public + " was removed"})
                  } else {
                    res.send({"message": "Couldn't remove subscription of the Marathon REST API, but no error given!"})
                  }
                });

          }
        }).catch(function(error) {
          logger.error("deleteEventSubscription: Error: " + JSON.stringify(error));
          res.status(500).send({"message": "An error occured", error: error});
        });
  });

  return router;

}
