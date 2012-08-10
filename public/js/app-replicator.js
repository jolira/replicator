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

    function read(model, options) {
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
                return read(model, options);
        }

        return app.error("unknown sync method", method);
        return open(function(localStore) {

        });
        //app.log(sync, self, method, model, options);
    }

    app.replicator = app.replicator || {};
    app.replicator.Model = app.replicator.Model || Backbone.Model.extend({
        sync:function (method, model, options) {
            return sync(method, model, options);
        }
    });

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

    function save(localStore, url, key) {
        var id = url + "/" + key;

        return localStore.get(id, function (entry) {
            var start = Date.now();

            return app.middle.emit("replicate-save", id, entry, function (version) {
                app.log("replicate-save", url, Date.now() - start, id, version);

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

                        case 'save':
                            return save(localStore, url, key);

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
    });
})(window["jolira-app"]);
/*
 // *******************************************************************************
 // using socket.io for Backbone.sync
 // *******************************************************************************

 function open(name, cb) {
 new Lawnchair({ name:name }, cb);
 }

 function changedAttributes(model) {
 var changed = model.changedAttributes()

 return changed && _.keys(changed);
 }

 function readAsync(collection, id, options) {
 return open(collection, function (store) {
 if (id) {
 return store.get(id, function (result) {
 return options && options.success && options.success(result && result.val);
 });
 }

 return store.all(function (result) {
 if (!options || !options.success) {
 return;
 }

 var found = [];

 _.each(result || [], function (result) {
 found.push(result.val);
 });

 return options.success(found);
 });
 });
 }

 function saveLocal(model, collection, id, options, changed, data) {
 changed = changed || changedAttributes(model);

 if (!changed) {
 return;
 }

 return open(collection, function (store) {
 data = data || model.toJSON();

 return store.save({
 key:id,
 val:data
 }, function (result) {
 app.log("saving locally", collection, result, changed);
 return options && options.success && options.success(result.val);
 });
 });
 }

 function saveRemote(method, model, collection, id, options, changed, data) {
 changed = changed || changedAttributes(model);

 if (!changed) {
 return;
 }

 data = data || model.toJSON();

 return app.middle.emit("middle-store", method, collection, id, data, changed, function (err, result) {
 if (err) {
 if (options && options.errror) {
 return options.errror(err);
 }

 return app.error("sync failed", collection, id, data, changed, err);
 }

 app.log("remote update", result);

 if (options && options.success) {
 return options.success(result);
 }
 });
 }

 function saveAsync(method, model, collection, id, options, changed, data) {
 changed = changed || changedAttributes(model);

 if (!changed) {
 return;
 }

 data = data || model.toJSON();

 saveRemote(method, model, collection, id, undefined, changed, data);
 saveLocal(model, collection, id, options, changed, data);
 }

 function createAsync(method, model, collection, id, options) {
 var data = model.toJSON() || {};

 data.id = app.utils.uuid().replace(/-/g, "");

 saveAsync(method, model, collection, data.id, options, _.keys(data), data);
 }

 function asyncSync(method, model, collection, id, options) {
 if ('read' === method) {
 return readAsync(collection, id, options);
 }

 if ("update" === method) {
 return saveAsync(method, model, collection, id, options);
 }

 if ("create" === method) {
 return createAsync(method, model, collection, id, options);
 }
 throw new Error("not yet supported");
 }

 function getURL(model) {
 return _.isFunction(model.url) ? model.url.call(model) : model.url;
 }

 app.middle.sync = function (method, model, options) {
 var url = getURL(model),
 segments = url.split('/'),
 type = segments.shift(),
 collection = segments.shift(),
 id = segments.join('/');

 if (type === 'async') {
 return asyncSync(method, model, collection, id, options);
 }

 throw new Error("unsupported url " + url);
 };
 */