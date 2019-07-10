"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');

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
		"rets.media.received"(postMedia) {
			//here we want to push this to wordpress and associate it with the post
			//TODO: update to attach to property via bulk upload
			// this.attachMediaToPost(postMedia);
		},
		"rets.media.thumb.received"(postMedia) {
			//here we want to push this to wordpress and associate it with the post
			//TODO: update to attach to property via bulk upload
			// this.attachThumbToPost(postMedia);
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
				const ctx = this;
				let photoBuffer = [];
				postMedia.photo.dataStream.on('data', function (data) {
					photoBuffer.push(data);
				});
				postMedia.photo.dataStream.on('end', function (data) {
					var buffer = Buffer.concat(photoBuffer);
					try {
						if (buffer) {
							// wp.media()
							// 	// Specify a path to the file you want to upload, or a Buffer
							// 	.file(buffer, postMedia.filename)
							// 	.create({
							// 		title: postMedia.photo.headerInfo.contentDescription,
							// 		alt_text: postMedia.photo.headerInfo.contentDescription,
							// 		caption: postMedia.photo.headerInfo.contentDescription,
							// 		description: postMedia.photo.headerInfo.contentDescription
							// 	})
							// 	.then(function (response) {
							// 		// Your media is now uploaded: let's associate it with a post
							// 		var newImageId = response.id;
							// 		ctx.broker.emit("wordpress.post.image.created", { post: postId, image: newImageId });
							// 		if (isThumb) {
							// 			ctx.broker.emit("wordpress.post.thumb.created", { post: postId, image: newImageId });
							// 		}
							// 	}).catch(error => {
							// 		ctx.broker.logger.error(error);
							// 	})
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