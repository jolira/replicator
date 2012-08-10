/*jslint node: true, vars: true, indent: 4 */
(function (module) {
    "use strict";

    var Batch = require('batch');

    function replicate(client, db, logger, url, remoteVersionByID, cb) {
        logger.info("replicate", url, remoteVersionByID);

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

                if (remoteVersion > dbVersion) {
                    return logger.error("server out-of-sync", url, key, remoteVersion, dbVersion);
                }

                mismatch[key] = {
                    version: dbVersion,
                    cmd: "update"
                };

                batch.push(function(done) {
                    db.read(url + "/" + key, function(err, entry) {
                        mismatch[key].entry = entry.vals;
                        done(err);
                    });
                });
            });

            var remoteKeys = Object.keys(remoteVersionByID);

            remoteKeys.forEach(function(key) {
                var remoteVersion = remoteVersionByID[key];

                mismatch[key] = remoteVersion === {
                    cmd: "new" ? "save" : "remove"
                };
            });

            return batch.end(function(err) {
                return cb(err, mismatch);
            });
        });
    }

    module.exports = function(logger, db, cb) {
        return cb(undefined, {
            replicate: function(url, versionByID, cb) {
                return replicate(this, db, logger, url, versionByID || {}, function(err, updates) {
                    if (err) {
                        logger.error("replicate failed", err);
                    }

                    return cb(updates);
                });
            }
        });
    };
})(module);