# MongoDB-Marathon
A Docker image to start a dynamic MongoDB 3.x.x replica set on top of Apache Mesos and Marathon.

## Introduction

This Docker image was created to make it as easy as possible to create a MongoDb ReplicaSet on top of an existing Apache Mesos cluster, with Marathon as scheduler. 
The [official MongoDB ReplicaSet tutorial](https://docs.mongodb.org/manual/tutorial/deploy-replica-set/) contains several steps to initialize the ReplicaSet and to add the members. 
It even gets more complicated if you want to add authentication and other things. This image intents to hide this complexity by using a small Node.js application which handles the configuration, togehter with the usage of Docker environment variables.

### External preparations

* **Marathon** must be started with the `--event_subscriber http_callback` flag to enable this Docker image to subscribe to the [Marathon Event Bus](https://mesosphere.github.io/marathon/docs/event-bus.html).
* The **Mesos Slaves** starting parameters should be adjusted to [gracefully stop tasks](https://github.com/meltwater/proxymatic#rolling-upgradesrestarts) by adding `--executor_shutdown_grace_period=60secs --docker_stop_timeout=50secs` with the according health checks in place (see link, and paragraph below).

### Fault tolerance

The recommended minimal ReplicaSet sizes can be found in the [MongoDB docs](https://docs.mongodb.org/manual/core/replica-set-architectures/#determine-the-number-of-members). It's recommended to run an odd number of nodes, and at least 3 nodes overall. 

### Persistence

By default, the Docker image will only persist its data in the container itself. For production usages, this is probably not the desired behavior. To overcome this, it's recommended to 
[mount a host directory as container volume](https://docs.docker.com/userguide/dockervolumes/#mount-a-host-directory-as-a-data-volume).

Using plain Docker, this could be done via adding an additional parameter like this: 
  
    -v /host/directory:/container/directory
    
The host directory `/host/directory` will now be available as `/container/directory` in the container. To do this via Marathon, one has to add the `volumes` property to the application JSON as described in the [Marathon docs](https://mesosphere.github.io/marathon/docs/native-docker.html):

```
{
  "container": {
    "type": "DOCKER",
    "docker": {
      "network": "BRIDGE",
        "image": "tobilg/mongodb-marathon",
        "portMappings": [
          { "containerPort": 3000 },
          { "containerPort": 27017 }
        ]
    },
    "volumes": [
      {
        "containerPath": "/container/directory",
        "hostPath": "/host/directory",
        "mode": "RW"
      }
    ]
  }
}
```

The default container paths are the following

* Data directory: `/data/db`
* Logs directory: `/data/logs`

The `run.sh` script will create subfolders for the `MARATHON_APP_ID` set by Marathon during runtime, meaning that each application will have separate data and log folders. This results in the capacity to run multiple MongoDB ReplicaSets on Marathon.

### Health checks

Add an Marathon app health check that is fast enough to complete without the stop timeout, e.g. 

```
  "healthChecks": [
    {
      "protocol": "HTTP",
      "path": "/health",
      "portIndex": 0,
      "gracePeriodSeconds": 15,
      "intervalSeconds": 10,
      "timeoutSeconds": 20,
      "maxConsecutiveFailures": 3
    }
  ]
```

For a complete example, see chapter "Running".

## API

To be able to support the automatic ReplicaSet initialization and more, an API has been 

### Config and Status

    GET /config                 - Shows the current ReplicaSet configuration as JSON
    GET /status                 - Shows the current ReplicaSet status as JSON
    GET /health                 - Used for Marathon health checks and graceful shutdown. Will return 503 if SIGTERM is received, so that Marathon can react. 
    
### Application locking

The Node.js application creates a ZooKeeper "lock" which signals that there already exists a MongoDB ReplicaSet application under the respective Marathon AppId. To reuse/reinitialize the application, the "lock" has to be removed manually. 

    GET /releaseLock           - Shows the current ReplicaSet configuration as JSON
    
### Event handling

    POST /event                - Endpoint for the Marathon REST API scaling events
    DELETE /eventSubscription  - Removes the event subscription to the Marathon REST API. Is automatically called during graceful shutdown. Will only actually work on the Master/Primary node.

## Overall options

Here's the list of configuration options:

 * `MARATHON_URL`: The URL of a Marathon instance.
 * `ZK_CONNECTION`: A list ZooKeeper services (`host:port`), separated by comma.  
 * `REPLICA_SET`: The name of the ReplicaSet
 * `STORAGE_ENGINE`: Is `wiredTiger` by default, can be `MMAPv1` as well.
 * `JOURNALING`: Is set to `yes` by default. Use `no` to disable.
 * `OPLOG_SIZE`: The size of the OpLog. 
 * `REPLICA_SET_TIMEOUT`: Time in milliseconds which is granted for the other MongoDB nodes to start up (10000ms by default), before the ReplicaSet init is triggered (new nodes are "cached" and used later).
 * `INIT_TIMEOUT`: Time in milliseconds which is granted for the local MongoDB startup (5000ms by default).
 * `LOG_LEVEL`: The [log level](https://www.npmjs.com/package/winston#logging-levels) for the Node.js application (`error` by default).
 
## Running

If your Marathon instance is running at `http://192.168.0.100:8080` and you have three ZooKeeper nodes (running at `192.168.0.100:2181`, `192.168.0.101:2181` and `192.168.0.102:2181`), you can use the following to start a three-node ReplicaSet:
 
```
curl -H "Content-Type: application/json" -XPOST 'http://192.168.0.100:8080/v2/apps' -d '{
    "id":"mongodb-replicaset",
    "env": {
        "MARATHON_URL": "http://192.168.0.100:8080",
        "REPLICA_SET": "my-rs",
        "LOG_LEVEL": "info",
        "ZK_CONNECTION": "192.168.0.100:2181,192.168.0.101:2181,192.168.0.102:2181"
    },
    "container": {
        "type": "DOCKER",
        "docker": {
            "network": "BRIDGE",
            "image": "tobilg/mongodb-marathon",
            "portMappings": [
                { "containerPort": 3000 },
                { "containerPort": 27017 }
            ]
        },
        "volumes": [
            {
                "hostPath": "/opt/mongodb-replicasets/data",
                "containerPath": "/data/db",
                "mode": "RW"
            },
            {
                "hostPath": "/opt/mongodb-replicasets/logs",
                "containerPath": "/data/logs",
                "mode": "RW"
            }
        ]
    },
    "cpus": 1,
    "mem": 2048,
    "instances": 3,
    "constraints": [["hostname", "UNIQUE"]],
    "healthChecks": [
        {
            "protocol": "HTTP",
            "path": "/health",
            "portIndex": 0,
            "gracePeriodSeconds": 15,
            "intervalSeconds": 10,
            "timeoutSeconds": 20,
            "maxConsecutiveFailures": 3
        }
    ]
}'
```

Sidenote: The `/opt/mongodb-replicasets/data` and `/opt/mongodb-replicasets/logs` need to exist on each Mesos Slave.

## Service Discovery

Service Discovery is possible via [Mesos DNS](https://github.com/mesosphere/mesos-dns).  

## Roadmap

 - [x] Automatic ReplicaSet initialization
 - [x] Scale up/down via Marathon
 - [x] Health checks
 - [x] API for current ReplicaSet configuration and status
 - [x] Usage of host volumes
 - [ ] Enable authentication