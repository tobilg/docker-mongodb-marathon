"use strict";
module.exports = {
    "marathonAppId": process.env.MARATHON_APP_ID || "/mongodb",  // Set by Marathon
    "marathonUrl": process.env.MARATHON_URL || "localhost:8080",
    "zkBaseConnection": process.env.ZK_CONNECTION || "localhost:2181",
    "host": process.env.HOST || "192.168.200.32", // Set by Marathon -> 127.0.0.1
    "webPort": {
        "public": parseInt(process.env.PORT0) || 3000, // Set by Marathon
        "internal": 3000
    },
    "mongoDbPort": {
        "public": parseInt(process.env.PORT1) || 27017, // Set by Marathon
        "internal": 27017
    },
    "replicaSet": process.env.REPLICA_SET || "rs0",
    "nodeEnvironment": process.env.NODE_ENV || "development",
    "replicaSetTimeout": process.env.REPLICA_SET_TIMEOUT || 10000,
    "initTimeout": process.env.INIT_TIMEOUT || 5000,
    "logLevel": process.env.LOG_LEVEL || "error"
};