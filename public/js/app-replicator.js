(function (app) {
    "use strict";

    app.replicator = app.replicator || {};

    function open(cb) {
        return app.store("r", cb);
    }

    function getURL(model) {
        var url = model.url;

        if (_.isFunction(url)) {
            url = url.call(model);
        }

        return url[0] === '/' ? url.substr(1) : url;
    }

    function removeIfPresent(keys, key, idx) {
        if (idx >= keys.length) {
            return undefined;
        }

        if (_.isEqual(keys[idx], key)) {
            return keys = keys.splice(idx, 1);
        }

        return removeIfPresent(keys, key, idx + 1);
    }

    function diffData(org, mod) {
        if (!org) {
            return mod;
        }

        var orgKeys = _.keys(org),
            modKeys = _.keys(mod),
            changed = false,
            result = {};

        _.each(orgKeys, function (key) {
            var orgVal = org[key],
                modVal = mod[key];

            removeIfPresent(modKeys, key, 0);

            if (!_.isEqual(orgVal, modVal)) {
                changed = true;
                result[key] = modVal;
            }
        });
        _.each(modKeys, function (key) {
            var modVal = mod[key];

            changed = true;
            result[key] = modVal;
        });

        return changed ? result : undefined;
    }

    function toData(model) {
        var data = model.toJSON();

        delete data.id;

        return data;
    }

    function storeVersion(store, listURL, id, version, cb) {
        return store.get(listURL, function (versionByID) {
            if (!versionByID) {
                versionByID = {};
            }

            var previousVersion = versionByID[id];

            if (version) {
                versionByID[id] = version;
            }
            else {
                delete versionByID[id];
            }

            return store.save(listURL, versionByID, function () {
                cb(previousVersion);
            });
        });
    }

    function save(store, model, options) {
        var url = getURL(model);

        return store.get(url, function (existing) {
            var data = toData(model),
                modifications = diffData(existing, data);

            if (!modifications) {
                return options.success(data);
            }

            app.middle.emit("replicate", "store", url, Date.now(), modifications);

            return store.save(url, data, function () {
                return options.success(data);
            });
        });
    }

    function update(model, options) {
        return open(function (store) {
            return save(store, model, options);
        });
    }

    function create(model, options) {
        return open(function (store) {
            var uuid = app.utils.uuid(),
                id = uuid.replace(/-/g, ""),
                listURL = getURL(model);

            return storeVersion(store, listURL, id, "new", function () {
                model.id = id;

                return save(store, model, options);
            });
        });
    }

    function readCollection(store, listURL, versionByID, options) {
        if (!versionByID) {
            return options.success([]);
        }

        var collection = [];

        _.each(versionByID, function(version, id) {
            var url = listURL + "/" + id;

            return store.get(url, function (data) {
                data.id = id;

                collection.push(data);
            });
        });

        return options.success(collection);
    }

    function read(model, options) {
        return open(function (store) {
            var url = getURL(model);

            return store.get(url, function (data) {
                if (model.models) {
                    return readCollection(store, url, data, options);
                }
                return options.success(data || {});
            });
        });
    }

    function remove(model, options) {
        return open(function (store) {
            var url = getURL(model),
                segments = url.split("/"),
                id = segments.pop(),
                listURL = segments.join("/");

            return storeVersion(store, listURL, id, undefined, function () {
                app.middle.emit("replicate", "store", url, Date.now(), undefined);

                return store.remove(url, function () {
                    return options.success(data);
                });
            });
        });
    }

    function sync(method, model, options) {
        switch (method) {
            case 'read':
                return read(model, options);
            case 'create':
                return create(model, options);
            case 'update':
                return update(model, options);
            case 'delete':
                return remove(model, options);
        }

        return app.error("unsupported backbone sync method", method);
    }

    function replicate(url) {
        return open(function (store) {
            return store.get(url, function (versionByID) {
                return app.middle.emit("replicate", "sync", url, versionByID);
            });
        });
    }

    var events = _.extend({}, Backbone.Events);

    function applyReplicate(listURL, id, data, version) {
        return open(function (store) {
            return storeVersion(store, listURL, id, version, function (previousVersion) {
                if (!version) {
                    store.remove(listURL + "/" + id);

                    return events.trigger("remove:" + listURL, id);
                }

                var url = listURL + "/" + id;

                store.save(url, data);
                events.trigger("update:" + url, data);

                if (!previousVersion) {
                    events.trigger("create:" + listURL, id, data);
                }

                return undefined;
            });
        });
    }

    app.replicator.animate = app.replicator.animate || function (model, context) {
        var url = getURL(model);

        events.on("update:" + url, function (data) {
            model.set(data);
        }, context || model);
        events.on("create:" + url, function (id, data) {
            data.id = id;

            model.add([ data ]);
        }, context || model);
        events.on("remove:" + url, function (id) {
            model.remove([
                { id:id }
            ]);
        }, context || model);
    };
    app.replicator.disanimate = app.replicator.disanimate || function (model, context) {
        var url = getURL(model);

        events.off("update:" + url, undefined, context || model);
        events.off("create:" + url, undefined, context || model);
        events.off("remove:" + url, undefined, context || model);
    };

    app.replicator.Model = app.replicator.Model || Backbone.Model.extend({
        sync:function (method, model, options) {
            return sync(method, model, options);
        }
    });
    app.replicator.Collection = app.replicator.Collection || Backbone.Collection.extend({
        sync:function (method, model, options) {
            return sync(method, model, options);
        }
    });

    app.starter.$(function (next) {
        app.middle.on("replicate", function (url, data, version) {
            var segments = url.split("/"),
                id = segments.pop(),
                listURL = segments.join("/");

            return applyReplicate(listURL, id, data, version);
        });

        var replicatedURLs = [];

        app.middle.on("connect", function () {
            _.each(replicatedURLs, function (url) {
                replicate(url);
            });
        });
        app.replicator.replicate = function (url) {
            replicatedURLs.push(url);

            if (app.middle.connected) {
                replicate(url);
            }
        };

        return next();
    });
})(window["jolira-app"]);
