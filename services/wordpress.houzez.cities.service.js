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
    name: "wordpress.houzez.cities",

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
        fetch: {
            cache: true,
            params: { name: { type: 'string', required: true } },
            async handler(ctx) {
                return this.propertyCities.find(item => item.name == ctx.params.name);
            }
        }
    },
	/**
	 * Events
	 */
    events: {
        "wordpress.houzez.cities.loaded": {
            handler() {
                this.logger.warn(`Loaded ${this.propertyCities.length} cities...`);
            }
        }

    },

	/**
	 * Methods
	 */
    methods: {
        loadPropertyCities() {
            this.connection.connect();
            let ctx = this;
            this.connection.query("SELECT t1.term_id, t1.name, t1.slug  FROM wp_terms AS t1 INNER JOIN wp_term_taxonomy AS t2 ON t1.term_id = t2.term_id WHERE t2.taxonomy = 'property_city'", async function (error, results, fields) {
                if (error) throw error;
                results.forEach(element => {
                    let city = { id: element.term_id, name: element.name, slug: element.slug };
                    ctx.propertyCities.push(city);
                });
                await ctx.broker.emit("wordpress.houzez.cities.loaded");
            });

            this.connection.end();

        }
    },

	/**
	 * Service created lifecycle event handler
	 */
    created() {
        this.wp = new WPAPI({
            endpoint: process.env.WordpressUrl, routes: apiRootJSON.routes,
            username: process.env.WordpressUsername,
            password: process.env.WordpressPassword
        });

        this.propertyCities = new Array();
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

        this.logger.warn("Loading cities...");
        this.loadPropertyCities();
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    stopped() {
        this.connection = null;
    }
};