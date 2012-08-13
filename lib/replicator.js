/*jslint node: true, vars: true, indent: 4 */
(function (module) {
    "use strict";

    var Batch = require('batch'),
        subscriberByURL = {};

    function disconnect(client) {
        var urls = Object.keys(subscriberByURL);

        urls.forEach(function (url) {
            var subscribers = subscriberByURL[url];

            delete subscribers[client];
        });
    }

    function subscribe(client, url) {
        var subscribers = subscriberByURL[url];

        if (!subscribers) {
            subscribers = subscriberByURL[url] = {};
        }

        subscribers[client] = true;
    }

    function emit(client, url) {
        var args = Array.prototype.slice.call(arguments, 2),
            subscribers = subscriberByURL[url],
            subs = Object.keys(subscribers || {});

        subs.forEach(function (subscriber) {
            if (client !== subscriber) {
                subscriber.emit.appy(subscriber, args);
            }
        });
    }

    function replicate(client, db, logger, url, remoteVersionByID, cb) {
        logger.info("replicate", url, remoteVersionByID);

        subscribe(client, url)

        return db.versionByID(url, function(err, dbVersionByID) {
            if (err) {
                return cb(err);
            }

            var batch = new Batch(),
                dbKeys = dbVersionByID ? Object.keys(dbVersionByID) : [],
                mismatch = {};

            dbKeys.forEach(function(key) {
                var remoteVersion = remoteVersionByID[key],
                    dbVersion = dbVersionByID[key];

                delete remoteVersionByID[key];

                if (remoteVersion === dbVersion) {
                    return;
                }

                mismatch[key] = {
                    version: dbVersion,
                    cmd: "update"
                };

                batch.push(function(done) {
                    var filename = url + "/" + key;

                    db.read(filename, function(err, entry) {
                        mismatch[key].entry = entry;
                        done(err);
                    });
                });
            });

            var remoteKeys = Object.keys(remoteVersionByID);

            remoteKeys.forEach(function(key) {
                var remoteVersion = remoteVersionByID[key];

                mismatch[key] = {
                    cmd: remoteVersion === "new" ? "save" : "remove"
                };
            });

            return batch.end(function(err) {
                return cb(err, mismatch);
            });
        });
    }

    function create(client, db, logger, url, data, cb) {
        logger.info("create", url, data);

        return db.create(url, data, function(err, data, version) {
            if (err) {
                return cb(err);
            }

            var segments = url.split("/"),
                id = segments.pop(),
                parent = segments.join("/");

            emit(client, parent, "replicator-add", id, data, version);

            return cb(undefined, data, version);
        });
    }

    function update(client, db, logger, url, timestamp, modifications, cb) {
        logger.info("create", url, data);

        return db.create(url, timestamp, modifications, function(err, data, version) {
            if (err) {
                return cb(err);
            }

            return cb(undefined, data, version);
        });
    }

    function remove(client, db, logger, url, cb) {
        logger.info("create", url, data);

        return db.create(url, function(err) {
            if (err) {
                return cb(err);
            }

            return cb();
        });
    }

    module.exports = function(logger, db, cb) {
        return cb(undefined, {
            "disconnect": function() {
                return disconnect(this);
            },
            "replicate": function(url, versionByID, cb) {
                return replicate(this, db, logger, url, versionByID || {}, function(err, updates) {
                    if (err) {
                        logger.error("replicate failed", err);
                    }

                    return cb(updates);
                });
            },
            "replicate-create": function(url, data, cb) {
                return create(this, db, logger, url, data, function(err, data, version) {
                    if (err) {
                        logger.error("replicate-create failed", err);
                    }

                    return cb(data, version);
                });
            },
            "replicate-update": function(url, timestamp, modifications, cb) {
                return update(this, db, logger, url, timestamp, modifications, function(err, data, version) {
                    if (err) {
                        logger.error("replicate-update failed", err);
                    }

                    return cb(data, version);
                });
            },
            "replicate-remove": function(url, cb) {
                return remove(this, db, logger, url, function(err) {
                    if (err) {
                        logger.error("replicate-update failed", err);
                    }

                    return cb();
                });
            }
        });
    };
})(module);