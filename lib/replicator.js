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

    function broadcast(logger, event, url) {
        var segments = url.split("/");

        segments.pop();

        var listURL = segments.join("/"),
            args = Array.prototype.slice.call(arguments, 2),
            subscribers = subscriberByURL[listURL] || [];

        args.unshift(url);
        args.unshift(event);

        logger.info("replicate broadcast", args);

        return subscribers.forEach(function (subscriber) {
            subscriber.emit.apply(subscriber, args);
        });
    }

    function emit(logger, client) {
        var args = Array.prototype.slice.call(arguments, 2);

        logger.info("replicate emit", client.id, args);

        return client.emit.apply(client, args);
    }

    function sync(client, db, logger, listURL, remoteVersionByID) {
        logger.info("replicate sync", listURL, remoteVersionByID);

        var subscribers = subscriberByURL[listURL] || (subscriberByURL[listURL] = []);

        addIfAbsent(subscribers, client, 0);

        return db.versionByID(listURL, function (err, dbVersionByID) {
            if (err) {
                return logger.error("replicate sync db.versionByID", err);
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

                db.read(url, function (err, data) {
                    if (err) {
                        return logger.error("replicate sync db.read", url, err);
                    }

                    emit(logger, client, "replicate", url, data, dbVersion);
                });
            });

            var remoteKeys = Object.keys(remoteVersionByID);

            remoteKeys.forEach(function (id) {
                var url = listURL + "/" + id;

                emit(logger, client, "replicate", url, {});
            });
        });
    }

    function store(db, logger, url, timestamp, modifications) {
        logger.info("replicate store", url, timestamp, modifications);

        if (!modifications) {
            return db.remove(url, function (err) {
                if (err) {
                    return logger.error("replicate db.remove", url, err);
                }

                return broadcast(logger, "replicate", url);
            });
        }

        return db.save(url, timestamp, modifications, function (err, data, version) {
            if (err) {
                return logger.error("replicate db.save", url, err);
            }

            return broadcast(logger, "replicate", url, data, version);
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