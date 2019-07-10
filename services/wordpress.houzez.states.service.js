"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');

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
            params: { name: { type: 'string', optional: true } },
            async handler(ctx) {
                // this.logger.info(ctx.params.name);
                let name = ctx.params.name;
                if (name) {
                    return this.propertyStates.find(item => item.name == name);
                } else {
                    await this.loadPropertyStates();
                    return this.propertyStates;

                }
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
        async loadPropertyStates() {
            if (this.connection.state === "disconnected") {
                this.connection.connect();
            }
            let ctx = this;
            this.connection.query("SELECT t1.term_id, t1.name, t1.slug  FROM wp_terms AS t1 INNER JOIN wp_term_taxonomy AS t2 ON t1.term_id = t2.term_id WHERE t2.parent = 0 and t2.taxonomy = 'property_state'", function (error, results, fields) {
                if (error) throw error;
                ctx.propertyStates = new Array();
                results.forEach(element => {
                    let propertyState = { id: element.term_id, name: element.name, slug: element.slug };
                    ctx.propertyStates.push(propertyState);
                });
                ctx.broker.emit("wordpress.houzez.states.loaded");
            });


        }
    },

	/**
	 * Service created lifecycle event handler
	 */
    created() {

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
        this.connection.end();
        this.connection = null;
    }
};