"use strict";
var rp = require('request-promise');
var Q = require('q');

var Marathon = function(url, logger) {

    var self = this;
    self.url = url || "http://localhost:8080";
    self.logger = logger;

};

Marathon.prototype.getAppTasks = function(appId) {
    var deferred = Q.defer();
    var self = this;

    var reqOptions = {
        uri: self.url + "/v2/apps" + appId + "/tasks",
        method: "GET",
        headers: {
            "Content-Type" : "application/json"
        },
        json: true
    };

    self.logger.info("getAppTasks: " + JSON.stringify(reqOptions));

    rp(reqOptions)
        .then(function(response) {
            self.logger.info("getAppTasks: res: " + JSON.stringify(response));
            deferred.resolve(response);
        })
        .catch(function (error) {
            self.logger.error("getAppTasks: error: " + JSON.stringify(error));
            deferred.reject(error);
        });

    return deferred.promise;
};

Marathon.prototype.getConnectionsFromTasks = function(tasks) {
    var deferred = Q.defer(),
        self = this;
    var connections = [];
    self.logger.info("getConnectionsFromTasks: got: " + JSON.stringify(tasks));
    tasks.tasks.forEach(function(task) {
        connections.push({host: task.host, port: task.ports[1], timestamp: task.startedAt, connectionString: task.host+":"+task.ports[1]});
    });
    self.logger.info("getConnectionsFromTasks: connections: " + JSON.stringify(connections));
    deferred.resolve(connections);
    return deferred.promise;
};

Marathon.prototype.setupEventCallback = function(host, port) {

    var deferred = Q.defer(),
        self = this;

    var reqOptions = {
        uri: self.url + "/v2/eventSubscriptions?callbackUrl=http://" + host + ":" + port + "/events",
        method: "POST",
        headers: {
            "Content-Type" : "application/json"
        },
        json: true
    };

    self.logger.info("setupEventCallback: " + JSON.stringify(reqOptions));


    rp(reqOptions)
        .then(function(response) {
            self.logger.info("setupEventCallback: res: " + JSON.stringify(response));
            deferred.resolve(response);
        })
        .catch(function (error) {
            self.logger.error("setupEventCallback: error: " + JSON.stringify(error));
            deferred.reject(error);
        });

    return deferred.promise;
};

Marathon.prototype.removeEventCallback = function(host, port) {

    var deferred = Q.defer(),
        self = this;

    var reqOptions = {
        uri: self.url + "/v2/eventSubscriptions?callbackUrl=http://" + host + ":" + port + "/events",
        method: "POST",
        headers: {
            "Content-Type" : "application/json"
        },
        json: true
    };

    self.logger.info("setupEventCallback: " + JSON.stringify(reqOptions));


    rp(reqOptions)
        .then(function(response) {
            self.logger.info("setupEventCallback: res: " + JSON.stringify(response));
            deferred.resolve(response);
        })
        .catch(function (error) {
            self.logger.error("setupEventCallback: error: " + JSON.stringify(error));
            deferred.reject(error);
        });

    return deferred.promise;
};

module.exports = Marathon;