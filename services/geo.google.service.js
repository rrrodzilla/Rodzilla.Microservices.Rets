"use strict";
const dotenv = require('dotenv');
const { MoleculerError } = require("moleculer").Errors;

module.exports = {
	name: "geo.google",

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

		/**
		 * Fetch RETS listings and begin emitting listing info for other services to process
		 *
		 * @returns
		 */
		geocode: {
			cache: true,
			params: {
				address: { type: "string" }
			},
			async handler(ctx) {
				let context = ctx;
				const googleMapsClient = require('@google/maps').createClient({
					key: process.env.GOOGLE_API_KEY,
					Promise: Promise
				});
				const geo = await googleMapsClient.geocode({ address: ctx.params.address })
					.asPromise()
					.then((response) => {
						let results = response.json.results[0];
						if(results === undefined){
							context.broker.logger.info(results);
							return null;
						}
						let address = results.address_components;
						let streetNumber = address.find(item => item.types[0] === "street_number");
						let streetName = address.find(item => item.types[0] === "route");

						if (streetName && streetNumber) {
							let location = results.geometry.location;
							let formatted_address = results.formatted_address;
							let streetAddress = [streetNumber.short_name.trim(), streetName.short_name.trim()].filter(Boolean).join(" ");
							let geoResult = { Location: location, Address: formatted_address, StreetAddress: streetAddress };

							return geoResult;
						} else {
							return null;
						}
					});
				return Promise.resolve(geo);
			}
		},
	},

	/**
	 * Events
	 */
	events: {
		"rets.property.valid.result": {
			async handler(property) {
				await this.actions.geocode({ address: property.FullAddress }).then(async geoData => {
					if (geoData === null) {
						await this.broker.emit("geo.service.invalid.geodata", property);
					} else {
						await this.broker.emit("geo.service.valid.geodata", Object.assign(property, geoData));
					}
				});
			}
		}
	},

	/**
	 * Methods
	 */
	methods: {

	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {
	},

	/**
	 * Service started lifecycle event handler
	 */
	started() {

	},

	/**
	 * Service stopped lifecycle event handler
	 */
	stopped() {

	}
};