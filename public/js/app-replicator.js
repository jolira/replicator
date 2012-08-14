(function (app) {
    "use strict";

    app.replicator = app.replicator || {};

    function open(cb) {
        return app.store("r", cb);
    }

    var events = _.extend({}, Backbone.Events),
        replicatedURLs = [];

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

    app.replicator.animate = app.replicator.animate || function(model) {
        var url = getURL(model);

        events.on("update:" + url, function(data) {
            model.set(data);
        });
    }

    function createLocal(store, url, key, version, data) {
        return store.get(url, function (versionByID) {
            var id = url + "/" + key;

            if (!versionByID) {
                versionByID = {};
            }

            versionByID[key] = version;

            store.save(url, versionByID);
            store.save(id, data);

            events.trigger("create:" + url, key, data);
        });
    }

    function updateLocal(store, url, key, version, data) {
        return store.get(url, function (versionByID) {
            var id = url + "/" + key;

            if (!versionByID) {
                versionByID = {};
            }

            versionByID[key] = version;

            store.save(url, versionByID);
            store.save(id, data);

            events.trigger("update:" + id, data);
        });
    }

    function removeLocal(localStore, url, key) {
        return localStore.get(url, function (versionByID) {
            var id = url + "/" + key;

            if (!versionByID) {
                versionByID = {};
            }

            delete versionByID[key];

            localStore.save(url, versionByID);
            localStore.remove(id);

            events.trigger("remove:" + url, key);
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

    app.replicator.Model = app.replicator.Model || Backbone.Model.extend({
        sync:function (method, model, options) {
            return sync(method, model, options);
        }
    });

    function syncLocal(updates, store, url) {
        _.each(updates, function (value, key) {
            switch (value.cmd) {
                case 'create':
                    return createLocal(store, url, key, value.version, value.entry);

                case 'update':
                    return updateLocal(store, url, key, value.version, value.entry);

                case 'remove':
                    return removeLocal(store, url, key);
            }

            return app.error("unknown replicate instruction", value.cmd, url, key, value);
        });
    }

    function replicate(url) {
        return open(function(store) {
            return store.get(url, function (versionByID) {
                var start = Date.now();

                return app.middle.emit("replicate", url, versionByID, function (updates) {
                    app.log("replicate", url, Date.now() - start, _.keys(updates));

                    syncLocal(updates, store, url);
                });
            });
        });
    }

    app.starter.$(function (next) {
        app.middle.on("replicator-create", function(url, data, version) {
            return open(function(store) {
                var segments = url.split("/"),
                    id = segments.pop(),
                    listURL = segments.join("/");

                return createLocal(store, listURL, id, version, data);
            });
        });
        app.middle.on("replicator-update", function(url, data, version) {
            return open(function(store) {
                var segments = url.split("/"),
                    id = segments.pop(),
                    listURL = segments.join("/");

                return updateLocal(store, listURL, id, version, data);
            });
        });
        app.middle.on("replicator-remove", function(url) {
            return open(function(store) {
                var segments = url.split("/"),
                    id = segments.pop(),
                    listURL = segments.join("/");

                return removeLocal(store, listURL, id);
            });
        });
        app.middle.on("connect", function() {
            _.each(replicatedURLs, function(url) {
                replicate(url);
            });
        });
        app.replicator.replicate = function(url) {
            replicatedURLs.push(url);

            if (app.middle.connected) {
                replicate(url);
            }
        };
        return next();
    });
})(window["jolira-app"]);
