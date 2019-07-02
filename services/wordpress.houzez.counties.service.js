"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');
var WPAPI = require('wpapi');
var apiRootJSON = require('./wordpress.discovery.json');

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
            params: { name: { type: 'string', required: true } },
            cache:true,
            async handler(ctx) {
                let name = ctx.params.name.toLowerCase().replace(/ /g, "");


                if (!this.propertyCounties.length) await this.loadPropertyCounties();

                return this.propertyCounties.find(item => item.name.toLowerCase().replace(/ /g, "") == name);
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
        loadPropertyCounties() {

            let ctx = this;

            this.broker.call("wordpress.houzez.states.fetch", { name: 'Texas' }).then(async (state) => {
                if (state) {
                    this.connection.connect();
                    this.connection.query(`SELECT t1.term_id, t1.name, t1.slug  FROM wp_terms AS t1 INNER JOIN wp_term_taxonomy AS t2 ON t1.term_id = t2.term_id WHERE t2.parent = ${state.id} and t2.taxonomy = 'property_state'`, async function (error, results, fields) {
                        if (error) throw error;
                        results.forEach(element => {
                            let county = { id: element.term_id, name: element.name, slug: element.slug };
                            //get rid of bad counties
                            if ((county.slug !== 'other') && (county.slug !== 'unknown')) {
                                ctx.propertyCounties.push(county);
                            }
                        });
                        await ctx.broker.emit("wordpress.houzez.counties.loaded");
                    });
                    this.connection.end();
                }
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
        this.wp = new WPAPI({
            endpoint: process.env.WordpressUrl, routes: apiRootJSON.routes,
            username: process.env.WordpressUsername,
            password: process.env.WordpressPassword
        });
        this.connection = mysql.createConnection({
            host: process.env.WordpressSqlHost,
            user: process.env.WordpressSqlUser,
            password: process.env.WordpressSqlPassword,
            database: process.env.WordpressSqlDatabase
        });
        this.propertyCounties = new Array();
        this.logger.warn("Loading counties for state...");
        this.loadPropertyCounties();
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    stopped() {
        this.connection = null;
    }
};