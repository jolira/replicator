/*jslint node: true, vars: true, indent: 4 */
(function (module) {
    "use strict";

    var Batch = require('batch'),
        subscriberByURL = {};

    function addIfAbsent(array, elem, idx) {
        if (idx >= array.length) {
            return array.push(elem);
        }

        if (array[idx] === elem) {
            return;
        }

        return addIfAbsent(array, elem, idx + 1);
    }

    function removeIfPresent(array, elem, idx) {
        if (idx >= array.length) {
            return array.push(elem);
        }

        if (array[idx] === elem) {
            return array.splice(idx, 1);
        }

        return removeIfPresent(array, elem, idx + 1);
    }

    function disconnect(client) {
        var urls = Object.keys(subscriberByURL);

        urls.forEach(function (url) {
            var subscribers = subscriberByURL[url];

            if (subscribers) {
                removeIfPresent(subscribers, client, 0);
            }
        });
    }

    function subscribe(client, url) {
        var subscribers = subscriberByURL[url] || (subscriberByURL[url] = []);

        addIfAbsent(subscribers, client, 0);
    }

    function emit(client, url, event) {
        var segments = url.split("/");

        segments.pop();

        var parent = segments.join("/"),
            args = Array.prototype.slice.call(arguments, 3),
            subscribers = subscriberByURL[parent] || [];

        args.unshift(url);
        args.unshift(event);

        subscribers.forEach(function (subscriber) {
            if (client !== subscriber) {
                subscriber.emit.apply(subscriber, args);
            }
        });
    }

    function replicate(client, db, logger, url, remoteVersionByID, cb) {
        logger.info("replicate", url, remoteVersionByID);

        subscribe(client, url)

        return db.versionByID(url, function (err, dbVersionByID) {
            if (err) {
                return cb(err);
            }

            var batch = new Batch(),
                dbKeys = dbVersionByID ? Object.keys(dbVersionByID) : [],
                mismatch = {};

            dbKeys.forEach(function (key) {
                var remoteVersion = remoteVersionByID[key],
                    dbVersion = dbVersionByID[key];

                delete remoteVersionByID[key];

                if (remoteVersion === dbVersion) {
                    return;
                }

                mismatch[key] = {
                    version:dbVersion,
                    cmd:"update"
                };

                batch.push(function (done) {
                    var filename = url + "/" + key;

                    db.read(filename, function (err, entry) {
                        mismatch[key].entry = entry;
                        done(err);
                    });
                });
            });

            var remoteKeys = Object.keys(remoteVersionByID);

            remoteKeys.forEach(function (key) {
                var remoteVersion = remoteVersionByID[key];

                mismatch[key] = {
                    cmd:remoteVersion === "new" ? "create" : "remove"
                };
            });

            return batch.end(function (err) {
                return cb(err, mismatch);
            });
        });
    }

    function create(client, db, logger, url, data, cb) {
        logger.info("create", url, data);

        return db.create(url, data, function (err, data, version) {
            if (err) {
                return cb(err);
            }

            emit(client, url, "replicator-add", data, version);

            return cb(undefined, data, version);
        });
    }

    function update(client, db, logger, url, timestamp, modifications, cb) {
        logger.info("update", url, modifications);

        return db.update(url, timestamp, modifications, function (err, data, version) {
            if (err) {
                return cb(err);
            }

            emit(client, url, "replicator-update", data, version);

            return cb(undefined, data, version);
        });
    }

    function remove(client, db, logger, url, cb) {
        logger.info("remove", url, data);

        return db.create(url, function (err) {
            if (err) {
                return cb(err);
            }

            return cb();
        });
    }

    module.exports = function (logger, db, cb) {
        return cb(undefined, {
            "disconnect":function () {
                return disconnect(this);
            },
            "replicate":function (url, versionByID, cb) {
                return replicate(this, db, logger, url, versionByID || {}, function (err, updates) {
                    if (err) {
                        logger.error("replicate failed", err);
                    }

                    return cb(updates);
                });
            },
            "replicate-create":function (url, data, cb) {
                return create(this, db, logger, url, data, function (err, data, version) {
                    if (err) {
                        logger.error("replicate-create failed", err);
                    }

                    return cb(data, version);
                });
            },
            "replicate-update":function (url, timestamp, modifications, cb) {
                return update(this, db, logger, url, timestamp, modifications, function (err, data, version) {
                    if (err) {
                        logger.error("replicate-update failed", err);
                    }

                    return cb(data, version);
                });
            },
            "replicate-remove":function (url, cb) {
                return remove(this, db, logger, url, function (err) {
                    if (err) {
                        logger.error("replicate-update failed", err);
                    }

                    return cb();
                });
            }
        });
    };
})(module);