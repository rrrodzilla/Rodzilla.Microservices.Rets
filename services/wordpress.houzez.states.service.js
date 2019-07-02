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
    name: "wordpress.houzez.states",

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
                // this.logger.info(ctx.params.name);
                let name = (ctx.params.name.toLowerCase().trim() === "tx") ? "Texas" : ctx.params.name;
                return this.propertyStates.find(item => item.name == name);
            }
        }
    },
	/**
	 * Events
	 */
    events: {
        "wordpress.houzez.states.loaded": {
            handler() {
                this.logger.warn(`Loaded ${this.propertyStates.length} states...`);
            }
        }
    },

	/**
	 * Methods
	 */
    methods: {
        loadPropertyStates() {
            this.connection.connect();
            const states = this.propertyStates;
            let ctx = this;
            this.connection.query("SELECT t1.term_id, t1.name, t1.slug  FROM wp_terms AS t1 INNER JOIN wp_term_taxonomy AS t2 ON t1.term_id = t2.term_id WHERE t2.parent = 0 and t2.taxonomy = 'property_state'", async function (error, results, fields) {
                if (error) {
                    ctx.broker.logger.error(error.Error);
                } else {
                    results.forEach(element => {
                        let propertyState = { id: element.term_id, name: element.name, slug: element.slug };
                        states.push(propertyState);
                    });
                    await ctx.broker.emit("wordpress.houzez.states.loaded");
                }
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

        this.propertyStates = new Array();
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
        this.logger.warn("Loading states...");
        this.loadPropertyStates();
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    stopped() {
        this.connection = null;
    }
};