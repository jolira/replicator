(function (app) {
    "use strict";

    function open(cb) {
        return app.store("r", cb);
    }

    function getURL(model) {
        var url = model.url;

        if (_.isFunction(url)) {
            url = url.call(model);
        }

        if (url[0] === '/') {
            return url.substr(1);
        }

        return url;
    }

    function update(localStore, url, key, version, entry) {
        return localStore.get(url, function (versionByID) {
            var id = url + "/" + key;

            if (!versionByID) {
                versionByID = {};
            }

            versionByID[key] = version;

            localStore.save(url, versionByID);
            localStore.save(id, entry);
        });
    }

    function remove(localStore, url, key) {
        return localStore.get(url, function (versionByID) {
            var id = url + "/" + key;

            if (!versionByID) {
                versionByID = {};
            }

            delete versionByID[key];

            localStore.save(url, versionByID);
            localStore.remove(id);
        });
    }

    function create(localStore, url, key) {
        var id = url + "/" + key;

        return localStore.get(id, function (entry) {
            var start = Date.now();

            return app.middle.emit("replicate-create", id, entry, function (version) {
                app.log("replicate-create", url, Date.now() - start, id, version);

                return localStore.get(url, function (versionByID) {
                    if (!versionByID) {
                        versionByID = {};
                    }

                    versionByID[key] = version;
                    localStore.save(url, versionByID);
                });
            });
        });
    }

    function removeKey(keys, key, idx) {
        if (idx >= keys.length) {
            return;
        }

        if (_.isEqual(keys[idx], key)) {
            return keys = keys.splice(idx, 1);
        }

        return removeKey(keys, key, idx+1);
    }

    function diff(org, mod) {
        var orgKeys = _.keys(org),
            modKeys = _.keys(mod),
            changed = false,
            result = {};

        _.each(orgKeys, function(key) {
            var orgVal = org[key],
                modVal = mod[key];

            removeKey(modKeys, key, 0);

            if (!_.isEqual(orgVal, modVal)) {
                changed = true;
                result[key] = modVal;
            }
        });
        _.each(modKeys, function(key) {
            var modVal = mod[key];

            changed = true;
            result[key] = modVal;
        });

        return result;
    }

    function toJSON(model) {
        var data = model.toJSON();

        delete data.id;

        return data;
    }

    function updateMdl(model, options) {
        var url = getURL(model);

        return open(function(store) {
            return store.get(url, function(entry) {
                var data = toJSON(model),
                    changes = diff(entry, data);

                if (!changes) {
                    return options.success({});
                }

                var start = Date.now();

                return app.middle.emit("replicate-update", url, start, changes, function (data, version) {
                    app.log("replicate-update", url, Date.now() - start, version);

                    var segments = url.split("/"),
                        id = segments.pop(),
                        listURL = segments.join("/");

                    return store.get(listURL, function (versionByID) {
                        if (!versionByID) {
                            versionByID = {};
                        }

                        versionByID[id] = version;
                        store.save(listURL, versionByID);

                        return store.save(url, data, function() {
                            return options.success(data);
                        });
                    });
                });
            });
        });
    }

    function readMdl(model, options) {
        var url = getURL(model);

        return open(function(store) {
            return store.get(url, function(entry) {
                return options.success(entry);
            });
        });
    }

    function sync(method, model, options) {
        switch(method) {
            case 'read':
                return readMdl(model, options);
            case 'update':
                return updateMdl(model, options);
        }

        return app.error("unknown sync method", method);
    }

    app.replicator = app.replicator || {};
    app.replicator.Model = app.replicator.Model || Backbone.Model.extend({
        sync:function (method, model, options) {
            return sync(method, model, options);
        }
    });

    function replicate(localStore, url, cb) {
        return localStore.get(url, function (versionByID) {
            var start = Date.now();

            return app.middle.emit("replicate", url, versionByID, function (updates) {
                app.log("replicate", url, Date.now() - start, _.keys(updates));

                _.each(updates, function (value, key) {
                    var cmd = value.cmd;

                    switch (cmd) {
                        case 'update':
                            return update(localStore, url, key, value.version, value.entry);

                        case 'create':
                            return create(localStore, url, key);

                        case 'remove':
                            return remove(localStore, url, key);
                    }

                    return app.error("unknown replicate instruction", cmd, url, key, value);
                });

                return cb && cb();
            });
        });
    }

    app.starter.$(function (next) {
        return open(function (localStore) {
            app.replicator.replicate = function (url, cb) {
                return replicate(localStore, url, cb);
            };

            return next();
        });

        app.middle.on("replicator-add", function() {
            console.log("replicator-add", Array.prototype.slice.call(arguments));
        });
        app.middle.on("replicator-update", function() {
            console.log("replicator-update", Array.prototype.slice.call(arguments));
        });
    });
})(window["jolira-app"]);
