/*jslint node: true, vars: true, indent: 4 */
(function (module) {
    "use strict";

    var subscriberByURL = {};

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

    function broadcast(event, url) {
        var segments = url.split("/");

        segments.pop();

        var listURL = segments.join("/"),
            args = Array.prototype.slice.call(arguments, 3),
            subscribers = subscriberByURL[listURL] || [];

        args.unshift(url);
        args.unshift(event);

        return subscribers.forEach(function (subscriber) {
            subscriber.emit.apply(subscriber, args);
        });
    }

    function sync(client, db, logger, listURL, remoteVersionByID) {
        logger.info("sync", listURL, remoteVersionByID);

        var subscribers = subscriberByURL[listURL] || (subscriberByURL[listURL] = []);

        addIfAbsent(subscribers, client, 0);

        return db.versionByID(listURL, function (err, dbVersionByID) {
            if (err) {
                return logger.error("replicator sync db.versionByID", err);
            }

            var dbKeys = dbVersionByID ? Object.keys(dbVersionByID) : [];

            dbKeys.forEach(function (id) {
                var remoteVersion = remoteVersionByID[id],
                    dbVersion = dbVersionByID[id],
                    url = listURL + "/" + id;

                delete remoteVersionByID[id];

                if (remoteVersion === dbVersion) {
                    return;
                }

                db.read(url, function (err, entry) {
                    if (err) {
                        return logger.error("sync db.read", url, err);
                    }

                    client.emit("replicate", url, {
                        data:entry,
                        version:dbVersion
                    });
                });
            });

            var remoteKeys = Object.keys(remoteVersionByID);

            remoteKeys.forEach(function (id) {
                var url = listURL + "/" + id;

                client.emit("replicate", url, {});
            });
        });
    }

    function store(db, logger, url, timestamp, modifications) {
        logger.info("store", url, timestamp, modifications);

        if (!modifications) {
            return db.remove(url, function (err) {
                if (err) {
                    return logger.error("replicator store db.remove", url, err);
                }

                return broadcast("replicator", url);
            });
        }

        return db.save(url, timestamp, modifications, function (err, data, version) {
            if (err) {
                return cb(err);
            }

            return broadcast("replicator", url, data, version);
        });
    }

    module.exports = function (logger, db, cb) {
        return cb(undefined, {
            "disconnect":function () {
                var urls = Object.keys(subscriberByURL),
                    client = this;

                urls.forEach(function (url) {
                    var subscribers = subscriberByURL[url];

                    if (subscribers) {
                        removeIfPresent(subscribers, client, 0);
                    }
                });
            },
            "replicate":function (command, url) {
                switch (command) {
                    case "sync":
                        return sync(this, db, logger, url, arguments[2] || {});

                    case "store":
                        return store(db, logger, url, arguments[2], arguments[3]);
                }

                return logger.error("unknown replicate command", command, url);
            }
        });
    };
})(module);