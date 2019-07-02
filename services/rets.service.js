"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');
var through2 = require('through2');
var Promise = require('bluebird');

module.exports = {
	name: "rets",

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
		fetchListings: {
			params: {
				limit: { type: "number", integer: true, positive: true, optional: true },
				lc: { type: "string", optional: true },
				ia: { type: "boolean", optional: true },
				ma: { type: "number", integer: true, positive: true, optional: true },
				se: { type: "boolean", optional: true }
			},
			/**
			 * Fetch RETS listings and begin emitting listing info for other services to process
			 *
			 * @returns
			 */
			async handler(ctx) {

				await this.login(ctx);

				let toTitleCase = this.toTitleCase;
				let context = ctx;
				this.limit = (ctx.params.limit) ? ctx.params.limit : 50;

				this.minutesAgo = (ctx.params.ma) ? ctx.params.ma : 15;
				let minutesAgo = moment().subtract(this.minutesAgo, "minutes");
				this.lastChangeTimeStamp = (!ctx.params.lc) ? minutesAgo.toISOString() : moment(ctx.params.lc).toISOString();

				// context.broker.logger.info(`Current Time: ${moment().toISOString()}`);
				context.broker.logger.info(`Searching from ${moment(this.lastChangeTimeStamp).fromNow()} in batches of ${this.limit}`);

				this.retsClient.search.stream.query("Property", "Listing", `(LastChangeTimestamp=${this.lastChangeTimeStamp}+),(PropertyType=RES,MUL,LOT,FRM,COM),(Status=A)`, { offset: ctx.service.offset, limit: ctx.service.limit, select: "PhotoCount,Matrix_Unique_ID,PropertyType,ListPrice,SqFtTotal,LotSize,BedsTotal,BathsTotal,GarageSpaces,YearBuilt,MLSNumber,City,CountyOrParish,StreetNumber,StreetDirPrefix,StreetName,StreetSuffix,PostalCode,StateOrProvince,Style,PublicRemarks" })
					.then(async function (searchData) {
						for (var dataItem = 0; dataItem < searchData.results.length; dataItem++) {

							let property = searchData.results[dataItem];
							property.FullAddress = [property.StreetNumber.trim(), property.StreetDirPrefix.trim().toUpperCase(), toTitleCase(property.StreetName.trim()), toTitleCase(property.StreetSuffix.trim()), toTitleCase(property.City.trim()), property.StateOrProvince.trim().toUpperCase(), property.PostalCode.trim()].filter(Boolean).join(" ");

							const schema = Joi.object().keys({
								StreetNumber: Joi.number().min(1).required(),
								Matrix_Unique_ID: Joi.string().alphanum().required()
							});

							//initial round of validation
							// context.service.logger.info(property.Matrix_Unique_ID);
							const result = Joi.validate({ StreetNumber: property.StreetNumber, Matrix_Unique_ID: property.Matrix_Unique_ID }, schema);

							if (result.error === null) {

								ctx.service.propertyResults.push(property);
								context.emit("rets.property.valid.result", property);
							} else {
								context.emit("rets.property.invalid.result", property);
							}

							property = null;

						}

						// this.logger.info(`this.draftCandidates.length ${this.draftCandidates.length}`);
						ctx.emit("rets.property.search.complete");

						ctx.service.more = searchData.maxRowsExceeded && searchData.rowsReceived >= ctx.service.offset;
						// ctx.broker.logger.info(searchData);
						if (ctx.service.more) {
							ctx.service.resultsCount = searchData.count;
						}
					}).catch(function (errorInfo) {
						var error = errorInfo.error || errorInfo;
						if (error.name === 'RetsReplyError') {
							ctx.broker.logger.info(error.replyText);
						} else {
							ctx.broker.logger.error(error);
						}
					});
				return Promise.resolve("RETS Search Completed");
			},
		}
	},

	/**
	 * Events
	 */
	events: {
		"rets.property.geo.validated"(geoDecoratedProperty) {
			// this.logger.info("geo.validated");
			this.nonGeoValidatedProperties--;
			//so here we want to find the index of the item with the same matrix id and replace it
			let target_index = this.propertyResults.findIndex(item => item.Matrix_Unique_ID === geoDecoratedProperty.Matrix_Unique_ID);

			this.propertyResults = this.replaceAt(this.propertyResults, target_index, geoDecoratedProperty);

			this.checkIfDoneValidating();
			target_index = null;
		},
		"rets.property.validation.completed"() {

			if (this.more) {

				this.logger.info(`Found ${this.offset} properties so far...`);

				this.offset = (this.offset > this.limit) ? this.limit : this.offset + this.limit;
				this.broker.call("rets.fetchListings", { limit: this.limit, lc: this.lastChangeTimeStamp, ma: this.minutesAgo });
			} else {
				this.clearStats();
			}
		},
		"rets.property.geo.invalid"(invalidProperty) {
			this.nonGeoValidatedProperties--;
			//so here we want to find the index of the item with the same matrix id and remove it
			let target_index = this.propertyResults.findIndex(item => item.Matrix_Unique_ID === invalidProperty.Matrix_Unique_ID);
			if (target_index > -1) {
				this.propertyResults.splice(target_index, 1);
			}
			this.checkIfDoneValidating();
			target_index = null;
		},
		"rets.property.valid.result"(property) {
			this.nonGeoValidatedProperties++;
		},
		"geo.service.valid.geodata"(geoDecoratedProperty) {
			this.broker.emit("rets.property.geo.validated", geoDecoratedProperty);
		},
		"geo.service.invalid.geodata"(invalidProperty) {
			this.broker.emit("rets.property.geo.invalid", invalidProperty);
		}

	},

	/**
	 * Methods
	 */
	methods: {
		checkIfDoneValidating() {

			if (this.nonGeoValidatedProperties === 0) {
				this.broker.emit("rets.property.validation.completed");
				if (!this.more) {
					this.broker.emit("rets.property.search.batch.complete");
				}
			}
		},
		replaceAt(array, index, value) {
			const ret = array.slice(0);
			ret[index] = value;
			return ret;
		},
		toTitleCase(str) {
			return str.replace(/\w\S*/g, function (txt) {
				return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
			});
		},
		async login(ctx) {
			let outputFields = this.outputFields;
			this.retsClient = await rets.getAutoLogoutClient(this.clientSettings, async function (client) {
				ctx.emit("rets.authenticated");

				outputFields = null;
				return Promise.resolve(client);
			}).catch(function (errorInfo) {
				var error = errorInfo.error || errorInfo;
				// console.log("   ERROR: issue encountered:");
				outputFields(error);
				// console.log('   ' + (error.stack || error).replace(/\n/g, '\n   '));
				error = null;
			});
		},

		clearStats() {
			this.nonGeoValidatedProperties = 0;
			this.propertyResults = new Array();
			this.offset = 50;
			this.limit = 0;
			this.resultsCount = 0;
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
		this.clearStats();
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
		this.nonGeoValidatedProperties = null;
		this.propertyResults = null;
		this.offset = null;

	}
};