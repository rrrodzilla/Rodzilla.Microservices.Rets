"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');

const mysql = require('mysql');

module.exports = {
    name: "wordpress.houzez.propertyTypes",

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
            cache:true,
            params: { name: { type: 'string', optional: true } },
            async handler(ctx) {
                let typeName = (ctx.params.name) ? ctx.params.name : null;
                if (typeName) {
                    let searchType = typeName.toLowerCase().replace(/ /g, "");                    
                    let type = this.propertyTypes.find(item => item.name.toLowerCase().replace(/ /g, "") === searchType);
                    if(!type) {
                        ctx.broker.logger.warn(`Could not find property type ${searchType} within:`);
                        this.propertyTypes.forEach(element => {
                            ctx.broker.logger.warn(element.name.toLowerCase().replace(/ /g, ""));                            
                        });
                    }
                    return type;
                } else {
                    await this.loadpropertyTypes();
                    return this.propertyTypes;
                }
            }
        }
    },
	/**
	 * Events
	 */
    events: {
        "wordpress.houzez.propertyTypes.loaded": {
            handler() {
                this.logger.warn(`Loaded ${this.propertyTypes.length} property types...`);
            }
        }
    },

	/**
	 * Methods
	 */
    methods: {
        loadpropertyTypes() {

            if (this.connection.state === "disconnected") {
                this.connection.connect();
            }

            let ctx = this;

            this.connection.query("SELECT t1.term_id, t1.name, t1.slug  FROM wp_terms AS t1 INNER JOIN wp_term_taxonomy AS t2 ON t1.term_id = t2.term_id WHERE t2.taxonomy = 'property_type'", function (error, results, fields) {
                if (error) throw error;
                ctx.propertyTypes = new Array();
                results.forEach(element => {
                    let item = { id: element.term_id, name: element.name, slug: element.slug };
                    ctx.propertyTypes.push(item);
                });
                ctx.broker.emit("wordpress.houzez.propertyTypes.loaded");
            });

        }
    },

	/**
	 * Service created lifecycle event handler
	 */
    created() {

        this.propertyTypes = new Array();
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
        this.logger.warn("Loading property types...");
        this.loadpropertyTypes();
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    stopped() {
        this.connection.end();
        this.connection = null;
    }
};