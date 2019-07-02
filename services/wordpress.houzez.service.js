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
	name: "wordpress.houzez",

	/**
	 * Service settings
	 */
	settings: {

	},

	/**
	 * Service dependencies
	 */
	dependencies: ["wordpress.houzez.states", "wordpress.houzez.counties", "wordpress.houzez.cities", "wordpress.houzez.propertyTypes"],

	/**
	 * Actions
	 */
	actions: {
	},
	/**
	 * Events
	 */
	events: {
		"wordpress.post.draft.ready"(params) {
			this.wp.propertyPost().create(params.post).then((post) => {
				// this.logger.info(`Drafted Post: ${post.title} with id ${post.id}`);
				this.broker.emit("wordpress.post.drafted", { wpId: post.id, originalPost: params.post });
			}).catch(error => {
				this.logger.error(error);
			});
		},
		"rets.media.received"(postMedia) {
			//here we want to push this to wordpress and associate it with the post
			this.attachMediaToPost(postMedia);
		},
		"rets.media.thumb.received"(postMedia) {
			//here we want to push this to wordpress and associate it with the post
			this.attachThumbToPost(postMedia);
		},
	},

	/**
	 * Methods
	 */
	methods: {
		async attachMediaToPost(postMedia) {
			try {
				const postId = postMedia.post;
				const isThumb = postMedia.isThumb;
				const wp = this.wp;
				const ctx = this;
				let photoBuffer = [];
				postMedia.photo.dataStream.on('data', function (data) {
					photoBuffer.push(data);
				});
				postMedia.photo.dataStream.on('end', function (data) {
					var buffer = Buffer.concat(photoBuffer);
					try {
						if (buffer) {
							wp.media()
								// Specify a path to the file you want to upload, or a Buffer
								.file(buffer, postMedia.filename)
								.create({
									title: postMedia.photo.headerInfo.contentDescription,
									alt_text: postMedia.photo.headerInfo.contentDescription,
									caption: postMedia.photo.headerInfo.contentDescription,
									description: postMedia.photo.headerInfo.contentDescription
								})
								.then(function (response) {
									// Your media is now uploaded: let's associate it with a post
									var newImageId = response.id;
									ctx.broker.emit("wordpress.post.image.created", { post: postId, image: newImageId });
									if (isThumb) {
										ctx.broker.emit("wordpress.post.thumb.created", { post: postId, image: newImageId });
									}
								}).catch(error => {
									ctx.broker.logger.error(error);
								})
						}
						ctx.broker.logger.warn(`There was no buffer for ${postMedia.filename}`);

					} catch (error) {
						//currently swallowing errors
						// ctx.broker.logger.error("There was an creating photo post:");
						// ctx.broker.logger.warn(`Therer `);
					}
				});

			} catch (error) {
				this.logger.error(error);
			}
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
		this.wp.propertyPost = this.wp.registerRoute('wp/v2', '/properties/(?P<id>[\\d]+)');



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
	},

	/**
	 * Service stopped lifecycle event handler
	 */
	stopped() {
		this.connection = null;
	}
};