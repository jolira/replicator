/*jslint node: true, vars: true, indent: 4 */
(function (module) {
    "use strict";

    var path = require("path"),
        replicator = require(".."),
        baseline = require("site-manager-baseline"),
        templates = path.join(__dirname, "templates"),
        pubdir = path.join(__dirname, "public");

    function addDefaults(defaults, isDebugging, cb) {
        defaults.title = "Tailoring App";
        defaults.hostname = "tailoring.jolira.com";
        defaults.stylesheets = ["less/tailor.less"];
        [
            "js/libs/crypto-js/sha256-3.0.2.js",
            "js/twitter.js",
            "js/tailoring.js",
            "js/login.js", // order is important here!!!
            "js/home.js", // home has the default route and must be loaded right after login
            "js/settings.js",
            "js/order.js",
            "js/order-nav.js",
            "js/order-user.js",
            "js/order-garment.js",
            "js/order-garments.js",
            "js/order-alteration.js",
            "js/order-alterations.js",
            "js/order-perfect-fit.js"
        ].forEach(function (dir) {
                defaults.trailingScripts.push(dir);
            });
        [
            path.join(templates, "login.html"),
            path.join(templates, "settings.html"),
            path.join(templates, "order.html"),
            path.join(templates, "order-garments.html"),
            path.join(templates, "order-edit-user.html"),
            path.join(templates, "order-view-user.html"),
            path.join(templates, "order-view-garment.html"),
            path.join(templates, "order-edit-garment.html"),
            path.join(templates, "order-view-alteration.html"),
            path.join(templates, "order-edit-alteration.html"),
            path.join(templates, "order-perfect-fit.html")
        ].forEach(function (dir) {
                defaults.templateFiles.push(dir);
            });
        [
            {
                "name":"description",
                "content":"Perfect Fit Program"
            }
        ].forEach(function (meta) {
                defaults.metas.push(meta);
            });
        defaults["public"].unshift(pubdir);
        defaults.googleAnalyticsWebPropertyID = "UA-3602945-1";

        if (isDebugging) {
            var qunit = require("./test/qunit");

            return qunit(defaults, cb);
        }

        return cb(undefined, defaults);
    }

    module.exports = function (defaults, cb,  lopts, gopts, app) {
        baseline(defaults, app, lopts, gopts, function(err, defaults, dispatcher) {
            if (err) {
                return cb(err);
            }

            return s3Store(app.logger, {
                "aws-access-key-id": lopts["aws-access-key-id"] || gopts["aws-access-key-id"],
                "aws-secret-access-key": lopts["aws-secret-access-key"] || gopts["aws-secret-access-key"],
                "aws-store-bucket": lopts["aws-tailoring-bucket"] || gopts["aws-tailoring-bucket"],
                "aws-account-id": lopts["aws-account-id"] || gopts["aws-account-id"],
                "aws-region": lopts["aws-region"] || gopts["aws-region"]
            }, function(err, db) {
                if (err) {
                    return cb(err);
                }

                return replicator(defaults, app.logger, dispatcher, db, function(err, defaults) {
                    if (err) {
                        return cb(err);
                    }

                    return logviewer.embedded(dispatcher, lopts, gopts, defaults, function(err, defaults) {
                        if (err) {
                            return cb(err);
                        }

                        return addDefaults(defaults, app.logger.isDebugging, function(err, defaults) {
                            if (err) {
                                return cb(err);
                            }

                            return cb(undefined, defaults);
                        });
                    });
                });
            });
        });
    };
})(module);