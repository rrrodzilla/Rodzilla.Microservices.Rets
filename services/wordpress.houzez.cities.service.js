"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');

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
    dependencies: ["wordpress.houzez.states"],

	/**
	 * Actions
	 */
    actions: {
        fetch: {
            cache: false,
            params: { name: { type: 'string', optional: true } },
            async handler(ctx) {
                if (ctx.params.name) {
                    return this.propertyCities.find(item => item.name == ctx.params.name);
                } else {
                    await this.loadPropertyCities();
                    return this.propertyCities;

                }
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
        async loadPropertyCities() {

            if (this.connection.state === "disconnected") {
                this.connection.connect();
            }
            let ctx = this;
            this.connection.query("SELECT t1.term_id, t1.name, t1.slug  FROM wp_terms AS t1 INNER JOIN wp_term_taxonomy AS t2 ON t1.term_id = t2.term_id WHERE t2.taxonomy = 'property_city'", function (error, results, fields) {
                if (error) throw error;
                ctx.propertyCities = new Array();
                results.forEach(element => {
                    let city = { id: element.term_id, name: element.name, slug: element.slug };
                    ctx.propertyCities.push(city);
                });
                ctx.broker.emit("wordpress.houzez.cities.loaded");
            });


        }
    },

	/**
	 * Service created lifecycle event handler
	 */
    created() {

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
        this.connection.end();
        this.connection = null;
    }
};