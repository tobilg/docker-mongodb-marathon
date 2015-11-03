"use strict";
var pmongo = require('promised-mongo');
var Q = require('q');

var MongoDB = function(host, port, replicaSet, logger) {

    var self = this;
    self.host = host || "127.0.0.1";
    self.port = port || 27017;
    self.replicaSet = replicaSet || "rs0";
    self.logger = logger;
    self.db = pmongo("mongodb://" + self.host + ":" + self.port + "/admin", []);

};

MongoDB.prototype.closeDb = function() {
    this.db.close();
};

MongoDB.prototype.isMaster = function() {
    var deferred = Q.defer(),
        self = this;

    self.db.runCommand({isMaster: 1})
        .then(function(result) {
            self.logger.info("isMaster: result: " + JSON.stringify(result));
            var response = {};
            if (!result.ismaster && !result.secondary && result.isreplicaset && result.info ==="Does not have a valid replica set config") {
                response.status = "uninitialized";
                response.isMaster = result.ismaster;
            } else {
                response.status = "initialized";
                response.isMaster = result.ismaster;
            }
            self.logger.info("isMaster: result" + JSON.stringify(response));
            deferred.resolve(response);
        })
        .catch(function(error) {
            self.logger.error("isMaster: result" + JSON.stringify(error));
            deferred.reject(error);
        });

    return deferred.promise;
};

MongoDB.prototype.initializeReplicaSet = function() {
    var self = this;

    var config = {
        "_id": self.replicaSet,
        "members": [
            {"_id": 0, "host": self.host + ":" + self.port}
        ],
        settings: {
            "heartbeatTimeoutSecs": 5
        }
    };

    self.logger.info("initializeReplicaSet: config: " + JSON.stringify(config));

    return self.db.runCommand({"replSetInitiate": config});
};

MongoDB.prototype.getReplicaSetConfig = function() {
    var self = this;

    self.logger.info("getReplicaSetConfig: start");

    return self.db.runCommand({replSetGetConfig: 1});
};

MongoDB.prototype.getReplicaSetStatus = function() {
    var self = this;

    self.logger.info("getReplicaSetStatus: start");

    return self.db.runCommand({replSetGetStatus: 1});
};

MongoDB.prototype.reconfigureReplicaSet = function(config) {
    var self = this;

    self.logger.info("reconfigureReplicaSet: newConfig: " + JSON.stringify(config));

    return self.db.runCommand({replSetReconfig: config});
};

MongoDB.prototype.addNodesToConfig = function(nodes, oldConfig) {
    var deferred = Q.defer(),
        self = this,
        config = oldConfig.config;

    var memberIds = [],
        currentMembers = [],
        newConfig = {};

    self.logger.info("addNodeToConfig: oldConfig:" + JSON.stringify(config));
    self.logger.info("addNodeToConfig: nodes:" + JSON.stringify(nodes));

    // Get member ids and current members
    if (config.members && Array.isArray(config.members)) {
        config.members.forEach(function(member) {
            memberIds.push(member._id);
            currentMembers.push(member);
        });
    }

    // Sort ascending
    memberIds.sort(function(a, b){return a-b});

    // Set last member id
    var lastMemberId = memberIds[memberIds.length-1];

    // Add node(s) to member array, if not present
    nodes.forEach(function(node){
        var connectionString = node.host + ":" + node.port,
            addable = true;

        // Check if already present
        config.members.forEach(function(member) {
            if (member.host === connectionString) {
                addable = false;
            }
        });

        // If not found, add
        if (addable) {
            lastMemberId++;
            currentMembers.push({"_id": lastMemberId, "host": node.host + ":" + node.port});
        }

    });

    // Set new config
    newConfig._id = config._id;
    newConfig.version = config.version+1;
    newConfig.members = currentMembers;
    newConfig.settings = config.settings;

    self.logger.info("addNodeToConfig: newConfig:" + JSON.stringify(newConfig));

    deferred.resolve(newConfig);
    return deferred.promise;
};

MongoDB.prototype.removeNodesFromConfig = function(nodes, oldConfig) {

    var deferred = Q.defer(),
        self = this,
        config = oldConfig.config;

    var currentMembers = [],
        newConfig = {};

    self.logger.info("removeNodesFromConfig: oldConfig:" + JSON.stringify(oldConfig));
    self.logger.info("removeNodesFromConfig: nodes:" + JSON.stringify(nodes));

    // Get member ids and current members
    if (config.members && Array.isArray(config.members)) {
        config.members.forEach(function(member) {
            // For all node(s)
            nodes.forEach(function(node){
                // Filter out if host and port matches
                if (member.host !== node.host + ":" + node.port) {
                    currentMembers.push(member);
                }
            });
        });
    }

    // Set new config
    newConfig._id = config._id;
    newConfig.version = config.version+1;
    newConfig.members = currentMembers;
    newConfig.settings = config.settings;

    self.logger.info("removeNodeFromConfig: newConfig:" + JSON.stringify(newConfig));

    deferred.resolve(newConfig);
    return deferred.promise;
};

MongoDB.prototype.addMongoDbMember = function(host, port) {

    var self = this;

    self.logger.info("addMongoDbMember: start: " + host + ":" + port);

    return self.getReplicaSetConfig()
        .then(self.addNodesToConfig.bind(self, [{host: host, port: port}]))
        .then(self.reconfigureReplicaSet.bind(self));

};

MongoDB.prototype.removeMongoDbMember = function(host, port) {

    var self = this;

    self.logger.info("removeMongoDbMember: start: " + host + ":" + port);

    return self.getReplicaSetConfig()
        .then(self.removeNodesFromConfig.bind(self, [{host: host, port: port}]))
        .then(self.reconfigureReplicaSet.bind(self));

};

module.exports = MongoDB;