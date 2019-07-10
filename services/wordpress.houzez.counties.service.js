"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');

const mysql = require('mysql');

module.exports = {
    name: "wordpress.houzez.counties",

	/**
	 * Service settings
	 */
    settings: {

    },

	/**
	 * Service dependencies
	 */
    dependencies: ["wordpress.houzez.states"],

	/**
	 * Actions
	 */
    actions: {
        fetch: {
            cache: true,
            params: {
                name: { type: 'string', optional: true },
                parent: { type: 'number', optional: true }
            },
            async handler(ctx) {
                if (ctx.params.name) {
                    return this.propertyCounties.find(item => item.name.toLowerCase().replace(/ /g, "") == ctx.params.name.toLowerCase().replace(/ /g, ""));
                } else {
                    await this.loadPropertyCounties(ctx.params.parent);
                    return this.propertyCounties;

                }
            }
        }
    },
	/**
	 * Events
	 */
    events: {
        "wordpress.houzez.counties.loaded": {
            handler() {
                this.logger.warn(`Loaded ${this.propertyCounties.length} counties...`);
            }
        }
    },

	/**
	 * Methods
	 */
    methods: {
        loadPropertyCounties(parentId) {
            let ctx = this;
            if (this.connection.state === "disconnected") {
                this.connection.connect();
            }
            this.connection.query(`SELECT t1.term_id, t1.name, t1.slug  FROM wp_terms AS t1 INNER JOIN wp_term_taxonomy AS t2 ON t1.term_id = t2.term_id WHERE t2.parent = ${parentId} and t2.taxonomy = 'property_state'`, function (error, results, fields) {
                if (error) throw error;
                ctx.propertyCounties = new Array();
                // ctx.logger.info(results);
                results.forEach(element => {
                    let county = { id: element.term_id, name: element.name, slug: element.slug };
                    //get rid of bad counties
                    if ((county.slug.toLowerCase() !== 'other') && (county.slug.toLowerCase() !== 'unknown')) {
                        ctx.propertyCounties.push(county);
                    }
                });
                ctx.broker.emit("wordpress.houzez.counties.loaded");
            });
        },
    },

	/**
	 * Service created lifecycle event handler
	 */
    created() {

    },

	/**
	 * Service started lifecycle event handler
	 */
    async started() {
        this.connection = mysql.createConnection({
            host: process.env.WordpressSqlHost,
            user: process.env.WordpressSqlUser,
            password: process.env.WordpressSqlPassword,
            database: process.env.WordpressSqlDatabase
        });
        this.logger.warn("Loading counties for state...");
        let parent = await this.broker.call("wordpress.houzez.states.fetch", { name: "TX" });
        if (parent) {
            this.logger.warn(`State (parent) ID: ${parent.id}`);
            this.loadPropertyCounties(parent.id);
        } else {
            this.logger.warn("Could not load counties due to no state id");
        }
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    stopped() {
        this.connection.end();
        this.connection = null;
    }
};