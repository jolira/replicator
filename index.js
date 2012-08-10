/*jslint node: true, vars: true, indent: 4 */
(function (module) {
    "use strict";

    var path = require("path"),
        pubdir = path.join(__dirname, "public"),
        replicator = require("./lib/replicator");

    module.exports = function (defaults, logger, dispatcher, db, cb) {
        [
            "js/app-replicator.js"
        ].forEach(function (dir) {
                defaults.trailingScripts.push(dir);
            });
        [
            pubdir
        ].forEach(function (dir) {
                defaults["public"].unshift(dir);
            });

        return replicator(logger, db, function(err, eventHandlers) {
            if (err) {
                return cb(err);
            }

            dispatcher.on(eventHandlers);

            return cb(undefined, defaults);
        });
    };
})(module);