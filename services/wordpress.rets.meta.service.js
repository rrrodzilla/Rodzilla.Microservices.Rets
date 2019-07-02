"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');
var through2 = require('through2');
var Promise = require('bluebird');
const { Transform } = require('json2csv');

module.exports = {
    name: "wordpress.rets.meta",

	/**
	 * Service settings
	 */
    settings: {

    },

	/**
	 * Service dependencies
	 */
    dependencies: [],

	/**
	 * Actions
	 */
    actions: {
        primeMetaType: {
            params: {
                resource: { type: "string", optional: true },
                type: { type: "string", optional: true },

            },
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {


                const fields = ['LongValue'];
                const opts = { fields };
                const transformOpts = { highWaterMark: 16384, encoding: 'utf-8' };
                const json2csv = new Transform(opts, transformOpts);

                json2csv
                    .on('header', header => console.log(header))
                    .on('data', line => console.log(line))
                    .on('error', err => console.log(err));

                let request = require('request')
                    , JSONStream = require('JSONStream')
                    , es = require('event-stream');

                    let port = (process.env.API_PORT) ? process.env.API_PORT : 80;
                    let host = (process.env.API_HOST) ? process.env.API_HOST : "localhost";

                return await request({ url: `http://${host}:${port}/api/wordpress.rets.meta/lookupsByType?resource=${ctx.params.resource}&type=${ctx.params.type}` })
                    .pipe(json2csv).pipe(es.stringify());
            }

        },
        lookupsByType: {
            cache: true,
            params: {
                resource: { type: "string", optional: true },
                type: { type: "string", optional: true },

            },
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {
                await this.login(ctx);
                let toTitleCase = this.toTitleCase;
                let context = this;

                return new Promise(async function (resolve, reject) {
                    context.logger.info();
                    var streamResult = await context.retsClient.metadata.getLookupTypes(ctx.params.resource, ctx.params.type)
                        .catch(error => {
                            context.logger.warn(error.replyText);
                            reject(error.replyText);
                        });
                    let response = [];
                    if (streamResult) {
                        streamResult.results.forEach(lookup => {
                            // context.logger.warn(lookup.info.Lookup);
                            lookup.metadata.forEach(element => {
                                // context.logger.info(element);
                                response.push(element);

                            });

                        });
                    }
                    //                    streamResult.pipe(processorStream);

                    return resolve(response);
                }).catch(e => { return });
            },
        },
        lookupTypes: {
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {
                await this.login(ctx);
                let context = this;

                return new Promise(async function (resolve, reject) {
                    var streamResult = await context.retsClient.metadata.getAllLookupTypes("Property", "City", 33)
                    streamResult.results.forEach(lookup => {
                        context.logger.warn({ lookup: lookup.info.Lookup, resource: lookup.info.Resource });
                    });
                    //                    streamResult.pipe(processorStream);

                    resolve("RETS Search Completed");
                });
            },
        }
    },

	/**
	 * Events
	 */
    events: {

    },

    /**
     * Methods
     */
    methods: {
        outputFields(obj, opts) {
            if (!obj) {
                console.log("      " + JSON.stringify(obj))
            } else {
                if (!opts) opts = {};

                var excludeFields;
                var loopFields;
                if (opts.exclude) {
                    excludeFields = opts.exclude;
                    loopFields = Object.keys(obj);
                } else if (opts.fields) {
                    loopFields = opts.fields;
                    excludeFields = [];
                } else {
                    loopFields = Object.keys(obj);
                    excludeFields = [];
                }
                for (var i = 0; i < loopFields.length; i++) {
                    if (excludeFields.indexOf(loopFields[i]) != -1) {
                        continue;
                    }
                    if (typeof (obj[loopFields[i]]) == 'object') {
                        console.log("      " + loopFields[i] + ": " + JSON.stringify(obj[loopFields[i]], null, 2).replace(/\n/g, '\n      '));
                    } else {
                        console.log("      " + loopFields[i] + ": " + JSON.stringify(obj[loopFields[i]]));
                    }
                }
            }
            console.log("");
        },
        replaceAt(array, index, value) {
            const ret = array.slice(0);
            ret[index] = value;
            return ret;
        },
        toTitleCase(str) {
            return str.replace(/\w\S*/g, function (txt) {
                return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
            });
        },
        async login(ctx) {
            this.retsClient = await rets.getAutoLogoutClient(this.clientSettings, async function (client) {
                return Promise.resolve(client);
            }).catch(function (errorInfo) {
                var error = errorInfo.error || errorInfo;
                error = null;
            });
        },
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        this.clientSettings = {
            loginUrl: process.env.RETSLoginUrl,
            username: process.env.RETSLogin,
            password: process.env.RETSPassword,
            version: 'RETS/1.7.2',
            userAgent: 'RETS node-client/4.x',
            method: 'GET'  // this is the default, or for some servers you may want 'POST'
        };
        this.retsClient = {};
    },

    /**
     * Service started lifecycle event handler
     */
    started() {
    },

    /**
     * Service stopped lifecycle event handler
     */
    stopped() {

    }
};