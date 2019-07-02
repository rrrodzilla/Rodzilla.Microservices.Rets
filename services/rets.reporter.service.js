"use strict";

module.exports = {
	name: "rets.reporter",

	/**
	 * Service settings
	 */
	settings: {
		cache: false

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
		"rets.authenticated"() {
			// this.printSummary("User logged in to rets");
			this.clearStats();
		},
		"rets.property.validation.completed"() {
			// this.logger.info(`GEO VALIDATION ON ${this.total} PROPERTIES COMPLETED`);
			this.printSummary("POST-GEO VALIDATION SUMMARY");
			this.logger.info();
			this.logger.info("****************************************************************************");
			this.logger.info();
			this.clearStats();
		},
		"rets.property.valid.result"() {
			this.valid++;
		},
		"rets.property.search.complete"() {
			this.total = this.valid + this.invalid;
			this.logger.info();
			this.logger.info("****************************************************************************");
			this.printSummary("ACTIVE PROPERTY SEARCH RESULTS SUMMARY");
			// this.logger.info(`BEGINNING GEO VALIDATION ON ${this.valid} PROPERTIES`);
		},
		"rets.property.invalid.result"() {
			this.invalid++;
		}
		,
		"rets.property.geo.invalid"() {
			this.invalid++;
			this.valid--;
		}
	},

	/**
	 * Methods
	 */
	methods: {
		clearStats() {
			this.valid = 0;
			this.invalid = 0;
			this.total = 0;
		},
		printSummary(title) {
			this.logger.info();
			this.logger.info(`----------- ${title} -----------`);
			this.logger.info({ valid: this.valid, invalid: this.invalid, total: this.total });
		}

	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {
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

	}
};