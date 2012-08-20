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

    function addIfAbsent(array, elem, idx) {
        if (idx >= array.length) {
            return array.push(elem);
        }

        if (array[idx] === elem) {
            return false;
        }

        return addIfAbsent(array, elem, idx + 1);
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

        var mods = model.modifications;

        if (!mods) {
            return options.success(data);
        }

        model.modifications = undefined;

        return store.get(url, function (data) {
            _.each(mods, function(val, attr) {
                data[attr] = val;
            });

            return store.save(url, data, function () {
                app.middle.emit("replicate", "store", url, Date.now(), mods);
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
            model.replicating = true;

            try {
                model.set(data);
            }
            finally {
                delete model.replicating;
            }
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
        },
        trigger:function(event) {
            var match = event.match(/^change:(.+)$/);

            if (match) {
                var attribute = match[1],
                    modifications = this.modifications || (this.modifications = {}),
                    value = arguments[2],
                    url = getURL(this);

                app.log("replicated model changed", url, attribute, value);

                if (!this.replicating) {
                    modifications[attribute] = value;
                }
            }

            return Backbone.Model.prototype.trigger.apply(this, arguments);
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
            var success = addIfAbsent(replicatedURLs, url, 0);

            if (success && app.middle.connected) {
                replicate(url);
            }
        };

        return next();
    });
})(window["jolira-app"]);
