"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');
var through2 = require('through2');
var Promise = require('bluebird');
const { Transform } = require('json2csv');
let request = require('request')
    , JSONStream = require('JSONStream')
    , es = require('event-stream');
const mysql = require('mysql');

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
        getMaxId: {
            async handler(ctx) {
                return await this.getMaxTermId();
            }
        },
        primeStates: {
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {
                try {
                    await ctx.call("wordpress.houzez.states.fetch").then(async (deleteTargets) => {
                        const texas = await ctx.call("wordpress.houzez.states.fetch", { name: "TX" });
                        if (deleteTargets.length && texas) {
                            console.log(texas);
                            const deleteCounties = this.broker.call("wordpress.houzez.counties.fetch", { parent: texas.id });
                            const deleteCities = this.broker.call("wordpress.houzez.cities.fetch");

                            await this.bulkDeleteTerms(deleteCounties, "COUNTY");
                            await this.bulkDeleteTermTaxonomy(deleteCounties, "COUNTY");

                            await this.bulkDeleteTerms(deleteCities, "CITY");
                            await this.bulkDeleteTermTaxonomy(deleteCities, "CITY");

                            await this.bulkDeleteTerms(deleteTargets, "STATE");
                            await this.bulkDeleteTermTaxonomy(deleteTargets, "STATE");
                        }

                    }).then(async () => {
                        await this.actions.lookupsByType({ resource: "Property", type: "StateOrProvince" }).then(async items => {
                            this.bulkInsertTerms(items, "STATE");
                            this.bulkInsertTermTaxonomy(items, 0, "property_state", "STATE");
                        }).then(async () => {
                            const texas = await this.broker.call("wordpress.houzez.states.fetch", { name: 'TX' });
                            if (texas) {

                                this.logger.info("Loading cities for Texas...");
                                await this.actions.primeCities({ parent: texas.id }).then(async () => {
                                    this.logger.info(`Loading counties for Texas id ${texas.id}...`);
                                    await this.actions.primeCounties({ parent: texas.id }).then(async () => {
                                        this.logger.info("Loading property types...");
                                        await this.actions.primePropertyTypes();
                                    });
                                });
                            }
                        });

                    })
                } catch (error) {
                    this.logger.warn(error);
                    this.logger.warn("No states to delete...");
                }
            }

        },
        primeCounties: {
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            params: {
                parent: { type: "number", required: true },
            },
            async handler(ctx) {
                try {
                    //let's get the existing cities
                    const deleteTargets = await this.broker.call("wordpress.houzez.counties.fetch", { parent: ctx.params.parent });
                    // this.logger.warn("deleteTargets");
                    // this.logger.warn(deleteTargets);
                    if (deleteTargets.length) {
                        this.bulkDeleteTerms(deleteTargets, "COUNTY");
                        this.bulkDeleteTermTaxonomy(deleteTargets, "COUNTY");
                        resolve();
                    }
                } catch (error) {
                    // this.logger.warn(error);
                    this.logger.warn("No counties to delete...");
                }
                const items = await this.actions.lookupsByType({ resource: "Property", type: "CountyOrParish" });
                this.bulkInsertTerms(items, "COUNTY");
                this.bulkInsertTermTaxonomy(items, ctx.params.parent, "property_state", "COUNTY");
            }

        },
        primeCities: {
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            params: {
                parent: { type: "number", required: true },
            },
            async handler(ctx) {
                try {
                    //let's get the existing cities
                    const deleteTargets = await this.broker.call("wordpress.houzez.cities.fetch");
                    // this.logger.warn(deleteTargets);
                    if (deleteTargets.length) {
                        this.bulkDeleteTerms(deleteTargets, "CITY");
                        this.bulkDeleteTermTaxonomy(deleteTargets, "CITY");
                        resolve();
                    }
                } catch (error) {
                    // this.logger.warn(error);
                    this.logger.warn("No cities to delete...");
                }
                const items = await this.actions.lookupsByType({ resource: "Property", type: "City" });
                this.bulkInsertTerms(items, "CITY");
                this.bulkInsertTermTaxonomy(items, ctx.params.parent, "property_city", "CITY");
            }
        },
        primePropertyTypes: {
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {
                try {
                    //let's get the existing cities
                    const deleteTargets = await this.broker.call("wordpress.houzez.propertyTypes.fetch");
                    // this.logger.warn(deleteTargets);
                    if (deleteTargets.length) {
                        this.bulkDeleteTerms(deleteTargets, "PROPERTY TYPE");
                        this.bulkDeleteTermTaxonomy(deleteTargets, "PROPERTY TYPE");
                        resolve();
                    }
                } catch (error) {
                    // this.logger.warn(error);
                    this.logger.warn("No cities to delete...");
                }
                const items = await this.actions.lookupsByType({ resource: "Property", type: "PropertyType" });
                this.bulkInsertTerms(items, "PROPERTY TYPE");
                this.bulkInsertTermTaxonomy(items, 0, "property_type", "PROPERTY TYPE");
            }
        },
        lookupsByType: {
            cache: false,
            params: {
                resource: { type: "string", optional: true },
                type: { type: "string", optional: true },
                out: { type: "boolean", optional: true },

            },
			/**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {
                await this.login(ctx);
                let context = this;
                let lastId = await this.getMaxTermId();
                return new Promise(async function (resolve, reject) {
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
                                if (ctx.params.out) {
                                    context.logger.info(element);
                                }
                                element.id = ++lastId;
                                response.push(element);

                            });

                        });
                    }
                    //                    streamResult.pipe(processorStream);

                    return resolve(response);
                }).catch(e => { return });
            },
        },
        fetchPropertyTypes: {
            cache: true,
            /**
			 * Fetch RETS cities and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {
                await this.login(ctx);
                let context = this;
                let types = new Array();
                return new Promise(async function (resolve, reject) {
                    var streamResult = await context.retsClient.metadata.getAllLookupTypes("Property")
                    streamResult.results.forEach(lookup => {
                        let type = { lookup: lookup.info.Lookup, resource: lookup.info.Resource };
                        context.logger.warn(type);
                        types.push(type);
                    });
                    //                    streamResult.pipe(processorStream);

                    resolve(types);
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
        async getMaxTermTaxonomyId() {
            return new Promise((resolve, reject) => {
                const ctx = this;
                this.pool.query(`SELECT MAX(term_taxonomy_id) AS lastid FROM wp_term_taxonomy`, async function (error, results, fields) {
                    if (error) {
                        ctx.logger.error(`Issue getting max term id.`);
                        reject(error);
                    };
                    resolve(results[0].lastid);
                });
            });
        },
        async getMaxTermId() {
            return new Promise((resolve, reject) => {
                const ctx = this;
                this.pool.query(`SELECT MAX(term_id) AS lastid FROM wp_terms`, async function (error, results, fields) {
                    if (error) {
                        ctx.logger.error(`Issue getting max term id.`);
                        reject(error);
                    };
                    resolve(results[0].lastid);
                });
            });
        },
        async bulkDeleteTerms(items, type) {
            // this.logger.info(items.join(','));
            try {
                this.pool.query(
                    `DELETE FROM wp_terms WHERE term_id IN (${items.map(item => item.id).join(',')})`,
                    (error, results) => {
                        if (error) {
                            this.logger.error(error);
                            return;
                        }
                        this.logger.warn(`${type}: Deleted ${results.affectedRows} rows from wp_terms`);
                    });

            } catch (error) {
                this.logger.error(`Failed delete terms for type ${type}`);
            }
        },
        async bulkDeleteTermTaxonomy(items, type) {
            try {
                this.pool.query(
                    `DELETE FROM wp_term_taxonomy WHERE term_id IN (${items.map(item => item.id).join(',')})`,
                    (error, results) => {
                        if (error) {
                            this.logger.error(error);
                            return;
                        }
                        this.logger.warn(`${type}: Deleted ${results.affectedRows} rows from wp_term_taxonomy`);
                    });

            } catch (error) {
                this.logger.error(`Failed delete terms for type ${type}`);
            }
        },
        async bulkInsertTerms(items, type) {
            this.pool.query(
                'INSERT INTO wp_terms (term_id, name, slug) VALUES ?',
                [items.map(item => [item.id, item.LongValue, item.ShortValue])],
                (error, results) => {
                    if (error) {
                        this.logger.error(error);
                        return;
                    }
                    this.logger.warn(`${type}: Loaded ${results.affectedRows} rows into wp_terms`);
                });
        },
        async bulkInsertTermTaxonomy(items, parentId, taxonomy, type) {
            let termId = await this.getMaxTermTaxonomyId();
            this.pool.query(
                'INSERT INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy,description, parent) VALUES ?',
                [items.map(item => [++termId, item.id, taxonomy, "", parentId])],
                (error, results) => {
                    if (error) {
                        this.logger.error(error);
                        return;
                    }
                    this.logger.warn(`${type}: Loaded ${results.affectedRows} rows into wp_term_taxonomy`);
                });

        },
        returnMeta() {
            return es.through(
                function write(data) {
                    // console.log('\n' + data);
                    this.emit('data', data);
                    return data;
                }
            );
        },
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
        this.pool = mysql.createPool({
            connectionLimit: 10,
            host: process.env.WordpressSqlHost,
            user: process.env.WordpressSqlUser,
            password: process.env.WordpressSqlPassword,
            database: process.env.WordpressSqlDatabase
        });

    },

    /**
     * Service stopped lifecycle event handler
     */
    stopped() {

    }
};