#!/bin/bash
set -m

# Find gateway ip address
ip=$(ip route get 8.8.8.8 | awk '{print $NF; exit}')

# Configure storage engine
cmd="mongod --storageEngine $STORAGE_ENGINE"

# Configure bind ip address
cmd="$cmd --bind_ip $ip"

# Configure journaling
if [ "$JOURNALING" == "no" ]; then
    cmd="$cmd --nojournal"
fi

# Configure OpLog
if [ "$OPLOG_SIZE" != "" ]; then
    cmd="$cmd --oplogSize $OPLOG_SIZE"
fi

# Currently not used
#if [ "$AUTH" == "yes" ]; then
    #cmd="$cmd --auth"
#fi

# Currently not used
#if [ "$KEY_FILE" != "" ]; then
    #echo "${KEY_FILE}"
    #echo "${KEY_FILE}" > /tmp/mongodb_keyfile
	#chmod 600 /tmp/mongodb-keyfile
    #cmd="$cmd --keyFile /tmp/mongodb_keyfile"
#fi

# Configure ReplicaSet
if [ "$REPLICA_SET" != "" ]; then
    cmd="$cmd --replSet $REPLICA_SET"
fi

# Set data directory
export DATA_PATH=/data/db$MARATHON_APP_ID
mkdir -p $DATA_PATH
cmd="$cmd --dbpath $DATA_PATH"

# Set log directory
export LOG_PATH=/data/logs$MARATHON_APP_ID
mkdir -p $LOG_PATH
cmd="$cmd --logpath $LOG_PATH/mongodb.log"

# Run the Node.js event handler
forever start -o $LOG_PATH/mongodb-configurator.stdout.log -e $LOG_PATH/mongodb-configurator.error.log /usr/local/mongodb-configurator/configurator.js

# Run MongoDB with the above-created parameters
$cmd &

fg
