"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');
const { PassThrough } = require('stream')

module.exports = {
    name: "rets.media",

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
        fetchPhotos: {
            params: {
                id: { type: "any", required: true },
                postId: { type: "any", optional: true }
            },
			/**
			 * Fetch RETS listings and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
            async handler(ctx) {

                return new Promise(async (resolve, reject) => {
                    //10090056
                    await this.login(ctx);

                    let id = ctx.params.id;
                    let postId = ctx.params.postId;

                    this.logger.info(`Looking for photos for post ${postId} matrix id ${id}`);
                    this.retsClient.objects.stream.getAllObjects("Property", "LargePhoto", id.toString(), { alwaysGroupObjects: true, ObjectData: 'contentType' })
                        .then(async function (photoStream) {
                            return new Promise(function (resolve, reject) {
                                let i = 0;
                                let fileName = "";
                                photoStream.objectStream.on('data', async function (event) {
                                    try {
                                        let contentType = event.headerInfo.contentType;
                                        if (event.type == 'headerInfo') {
                                            // ctx.broker.logger.info(fileName);
                                            // ctx.broker.logger.info(event);
                                        }
                                        if (event.type == 'error') {
                                            console.log("      Error: " + event.error);
                                        } else if (event.type == 'dataStream') {
                                            let fileName = `photo-${id}-${i + 1}.${contentType.match(/\w+\/(\w+)/i)[1]}`;
                                            if (postId) {
                                                await ctx.broker.emit("rets.media.received", { post: postId, photo: event, filename: fileName, isThumb: (i === 1) });
                                            }
                                            i++;
                                            resolve();
                                        }
                                        resolve();
                                    } catch (err) {
                                        reject(err);
                                    }
                                });
                                photoStream.objectStream.on('error', function (errorInfo) {
                                    reject(errorInfo);
                                });
                                photoStream.objectStream.on('end', function () {
                                    ctx.broker.logger.info(`Finished receiving photos for matrix id ${id}`);
                                    ctx.broker.emit("rets.media.all.media.received", postId);
                                    resolve();
                                });
                                resolve();
                            });
                        }).catch(error => {
                            reject(error);
                        });
                    resolve();
                });
            }
        }
    },

	/**
	 * Events
	 */
    events: {
        "wordpress.meta.updated"(postInfo) {
            this.logger.warn(`Drafted post ${postInfo.wpId} ready for media...`);
            this.actions.fetchPhotos({ id: postInfo.originalPost.matrix_id, postId: postInfo.wpId });
        }
    },

	/**
	 * Methods
	 */
    methods: {
        async login(ctx) {
            let outputFields = this.outputFields;
            this.retsClient = await rets.getAutoLogoutClient(this.clientSettings, async function (client) {
                ctx.emit("rets.authenticated");

                outputFields = null;
                return Promise.resolve(client);
            }).catch(function (errorInfo) {
                var error = errorInfo.error || errorInfo;
                // console.log("   ERROR: issue encountered:");
                // outputFields(error);
                // console.log('   ' + (error.stack || error).replace(/\n/g, '\n   '));
                error = null;
            });
        },

        clearStats() {
        }

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
        this.clearStats();
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    stopped() {
        this.clearStats();

    }
};