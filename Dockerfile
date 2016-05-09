FROM ubuntu:14.04.4
MAINTAINER tobilg <tobilg@gmail.com>

ENV DEBIAN_FRONTEND noninteractive
ENV TERM xterm

# Install MongoDB
RUN apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv EA312927 && \
    echo "deb http://repo.mongodb.org/apt/ubuntu "$(lsb_release -sc)"/mongodb-org/3.2 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-3.2.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends --force-yes \
    dnsutils wget build-essential python libkrb5-dev mongodb-org mongodb-org-server mongodb-org-shell mongodb-org-mongos mongodb-org-tools && \
    echo "mongodb-org hold" | dpkg --set-selections && echo "mongodb-org-server hold" | dpkg --set-selections && \
    echo "mongodb-org-shell hold" | dpkg --set-selections && \
    echo "mongodb-org-mongos hold" | dpkg --set-selections && \
    echo "mongodb-org-tools hold" | dpkg --set-selections

# Install Node.js 4.x
ENV NODE_VERSION v4.4.4
RUN wget --no-check-certificate https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.gz && \
    tar -C /usr/local --strip-components 1 -xzf node-$NODE_VERSION-linux-x64.tar.gz && \
    rm node-$NODE_VERSION-linux-x64.tar.gz

# Standard setting (can be overwritten by -e while running)
ENV STORAGE_ENGINE wiredTiger
ENV JOURNALING yes
ENV NODE_ENV production

# Add dynamic configurator script
ADD mongodb-configurator /usr/local/mongodb-configurator

# Add run script for MongoDB
ADD run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh

WORKDIR /usr/local/mongodb-configurator

# Setup of the configurator
RUN chmod +x configurator.js && \
    npm install forever -g && \
    npm install

WORKDIR /

EXPOSE 3000
EXPOSE 27017

CMD ["/usr/local/bin/run.sh"]