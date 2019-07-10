"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');

const mysql = require('mysql');

module.exports = {
    name: "wordpress.houzez.meta",

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
    },
	/**
	 * Events
	 */
    events: {
        "rets.media.all.media.received"(postId) {
            //we've gotten all the media and it's in the process of being uploaded
            //we can publish the post now!			
            return new Promise(async (resolve, reject) => {
                await this.publishPost(postId);
                resolve();
            }).then(() => {
                this.logger.info(`Post ${postId} published.`);
            });

        },
        "wordpress.post.image.created"(imageData) {
            let postId = imageData.post;
            let imageId = imageData.image;
            return new Promise(async (resolve, reject) => {
                await this.upsertMeta(postId, "fave_property_images", imageId);
                resolve();
            }).then(() => {
                this.logger.info(`Add photo ${imageId} to post ${postId}`);
            });
        },
        "wordpress.post.thumb.created"(imageData) {
            let postId = imageData.post;
            let imageId = imageData.image;
            return new Promise(async (resolve, reject) => {
                await this.upsertMeta(postId, "_thumbnail_id", imageId);
                resolve();
            }).then(() => {
                this.logger.info(`Add thumbnail ${imageId} to post ${postId}`);
            });
        },
        "wordpress.post.drafted"(postData) {

            let postId = postData.wpId;
            let post = postData.originalPost;
            return new Promise(async (resolve, reject) => {
                this.logger.warn(`Updated metadata for post ${postId}...`);
                await this.upsertMeta(postId, "fave_property_id", post.mls_id);
                await this.upsertMeta(postId, "fave_property_price", post.price);
                await this.upsertMeta(postId, "fave_property_size", post.size);
                await this.upsertMeta(postId, "fave_property_size_prefix", 'Sq Ft');
                await this.upsertMeta(postId, "fave_property_bedrooms", post.bedrooms);
                await this.upsertMeta(postId, "fave_property_bathrooms", post.bathrooms);
                await this.upsertMeta(postId, "fave_property_garage", post.garage_spaces);
                await this.upsertMeta(postId, "fave_property_year", post.year_built);
                await this.upsertMeta(postId, "fave_property_map_address", post.full_address);
                await this.upsertMeta(postId, "fave_property_address", post.street_address);
                await this.upsertMeta(postId, "fave_property_zip", post.postal_code);
                await this.upsertMeta(postId, "fave_property_location", `${post.geo_location.lat}, ${post.geo_location.lng},14`);
                await this.upsertMeta(postId, "houzez_geolocation_lat", post.geo_location.lat);
                await this.upsertMeta(postId, "houzez_geolocation_long", post.geo_location.lng);
                await this.upsertMeta(postId, "fave_property_map_street_view", "show");
                await this.upsertMeta(postId, "fave_property_map", 1);
                await this.upsertMeta(postId, "property_type", post.type);

                await this.upsertMeta(postId, "property_status", 6);
                await this.upsertTermRelationship(postId, 6);

                await this.upsertMeta(postId, "property_state", post.property_state);
                await this.upsertTermRelationship(postId, post.property_state);

                await this.upsertMeta(postId, "property_state", post.county);
                await this.upsertTermRelationship(postId, post.county);
                resolve();
            }).then(() => {
                if (postData) {
                    this.logger.info(`Updated metadata for post ${postId}`);
                    this.broker.emit("wordpress.meta.updated", postData);
                }
            })
        },
        "wordpress.post.meta.updated"(data) {
            // this.logger.info(`Updated meta key ${data.metaKey} with value ${data.metaValue} for  ${data.postId}...`);
        },
    },

	/**
	 * Methods
	 */
    methods: {
        async publishPost(postId) {
            return new Promise((resolve, reject) => {
                const ctx = this;
                this.pool.query(`UPDATE 16c_posts SET post_status = 'publish' WHERE ID = ${postId}`, async function (error, results, fields) {
                    if (error) {
                        ctx.logger.error(`Issue updating relationship for post ${postId} and value ${metaKey}`);
                        reject(error);
                    };
                    resolve();
                });
            });
            //10090056
        },
        async upsertTermRelationship(postId, metaKey) {
            return new Promise((resolve, reject) => {
                const ctx = this;
                this.pool.query(`INSERT INTO 16c_term_relationships (object_id, term_taxonomy_id) VALUES (${postId},${metaKey})`, async function (error, results, fields) {
                    if (error) {
                        ctx.logger.error(`Issue updating relationship for post ${postId} and value ${metaKey}`);
                        reject(error);
                    };
                    resolve();
                });
            });
            //10090056
        },
        async upsertMeta(postId, metaKey, metaValue) {

            return new Promise((resolve, reject) => {

                let ctx = this;

                this.pool.query(`SELECT post_id, meta_key, meta_value FROM 16c_postmeta WHERE post_id=${postId} and meta_key='${metaKey}' and meta_value='${metaValue}'`, function (error, results, fields) {
                    if (error) reject(error);
                    if (results[0]) {
                        ctx.logger.warn("Post meta found, skipping insert.");
                        resolve();
                    } else {
                        ctx.pool.query(`INSERT INTO 16c_postmeta (post_id, meta_key, meta_value) VALUES (${postId},'${metaKey}','${metaValue}')`, async function (error, results, fields) {
                            if (error) reject(error);
                            await ctx.broker.emit("wordpress.post.meta.updated", { postId: postId, metaKey: metaKey, metaValue: metaValue });
                            resolve();
                        })
                    }
                    // resolve();
                });
            })
        }
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
        this.pool = null;

    }
};