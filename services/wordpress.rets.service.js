"use strict";

module.exports = {
    name: "wordpress.rets",

	/**
	 * Service settings
	 */
    settings: {

    },

	/**
	 * Service dependencies
	 */
    dependencies: ["wordpress.houzez"],

	/**
	 * Actions
	 */
    actions: {
        draftPostCount: {
            handler() {
                return this.draftCandidates.length;
            }
        },
        cleanProperty: {
            visibility: "private",
            params: { property: { type: "object" } },
            async handler(ctx) {
                let candidate = ctx.params.property;
                const wordpressProperty = await this.transformCandidate(candidate);
                if (wordpressProperty) {
                    return wordpressProperty;
                } else {
                    this.logger.warn(`Couldn't process property: ${candidate.FullAddress}`);
                }
            }
        },
        processBatch: {
            visibility: "private",
            params: {
                offset: { type: "number", required: true },
                batchsize: { type: "number", required: true }
            },
            async handler(ctx) {

                for (let index = ctx.params.offset; index < ctx.params.batchsize + ctx.params.offset; index++) {
                    const candidate = this.postCandidates[index];
                    if (candidate) {
                        await this.actions.cleanProperty({ property: candidate }).then((wordpressProperty) => {
                            this.draftCandidates.push(wordpressProperty);
                            this.broker.emit("wordpress.post.draft.ready", { post: wordpressProperty });
                        });
                    } else {
                        this.logger.warn(`No property for index ${index}`);
                    }
                }
                this.offset = ctx.params.offset + ctx.params.batchsize;
            }
        },
    },

	/**
	 * Events
	 */
    events: {
        "rets.property.geo.validated"(geoDecoratedProperty) {
            this.postCandidates.push(geoDecoratedProperty);
        },
        "rets.property.search.batch.complete": {
            async handler() {
                await this.clearStats().then(async () => {
                    this.candidateLength = this.postCandidates.length
                    this.logger.info(`Begin WP ETL process on ${this.candidateLength} candidates.`);
                    await this.beginProcessing();
                });
            }
        },
        "wordpress.rets.batch.processed": {
            async handler() {
                if (this.offset < this.candidateLength - 1) {
                    this.logger.info(`Processed ${this.draftCandidates.length} candidates so far...`);
                    await this.beginProcessing();
                } else {
                    this.logger.info(`Finished processing ${this.draftCandidates.length} candidates.`);
                    this.clearCandidates();
                }
            }
        }
    },

	/**
	 * Methods
	 */
    methods: {
        async clearCandidates() {
            this.logger.info("Clearing WP Candidates");
            this.postCandidates = new Array();
        },
        async clearStats() {
            this.offset = 0;
            this.batchSize = 20;
            this.candidateLength = 0;
            this.draftCandidates = new Array();
        },
        async beginProcessing() {
            this.batchSize = (this.batchSize <= (this.candidateLength - this.offset)) ? this.batchSize : (this.candidateLength - this.offset);
            this.logger.info(`Batch processing up to ${this.batchSize} of ${this.candidateLength - this.offset} remaining properties.`);
            await this.actions.processBatch({ offset: this.offset, batchsize: this.batchSize }).then(() => {
                // this.logger.info(`this.offset ${this.offset}.`);

                this.broker.emit("wordpress.rets.batch.processed");
                // this.logger.info(`Processed ${this.draftCandidates.length} properties from ${this.postCandidates.length} total.`);
            });
        },
        async transformCandidate(candidate) {
            let wpProp = {};
            wpProp.title = candidate.StreetAddress;
            wpProp.content = candidate.PublicRemarks;
            wpProp.fave_property_price = candidate.ListPrice;
            wpProp.property_price = candidate.ListPrice;
            wpProp.price = candidate.ListPrice;
            wpProp.size = candidate.SqFtTotal;
            wpProp.lot_size = candidate.LotSize;
            wpProp.bedrooms = candidate.BedsTotal;
            wpProp.bathrooms = candidate.BathsTotal;
            wpProp.garage_spaces = candidate.GarageSpaces;
            wpProp.year_built = candidate.YearBuilt;
            wpProp.full_address = candidate.FullAddress;
            wpProp.slug = candidate.MLSNumber;
            wpProp.mls_id = candidate.MLSNumber;
            wpProp.matrix_id = candidate.Matrix_Unique_ID;
            this.logger.warn(`Matrix_Id: ${wpProp.matrix_id}`);
            wpProp.type = candidate.Style;
            wpProp.photo_count = candidate.PhotoCount;
            wpProp.property_type = candidate.PropertyType;

            wpProp.postal_code = candidate.PostalCode;
            wpProp.full_address = candidate.FullAddress;
            wpProp.street_address = candidate.StreetAddress;
            wpProp.geo_location = candidate.Location;

            wpProp.county = candidate.CountyOrParish;
            let county = await this.broker.call("wordpress.houzez.counties.fetch", { name: candidate.CountyOrParish });
            if (county) {
                wpProp.county = county.id;
            } else {
                this.logger.warn(`County not found with name ${candidate.CountyOrParish}`);
            }

            let city = await this.broker.call("wordpress.houzez.cities.fetch", { name: candidate.City });
            if (city) {
                wpProp.city = city.id;
            } else {
                this.logger.warn(`City not found with name ${candidate.City}`);
            }


            let propertyState = await this.broker.call("wordpress.houzez.states.fetch", { name: candidate.StateOrProvince });
            if (propertyState) {
                wpProp.property_state = propertyState.id;
            } else {
                this.logger.warn(`PropertyState not found with name ${candidate.StateOrProvince}`);
            }

            let propertyType = await this.broker.call("wordpress.houzez.propertyTypes.fetch", { name: candidate.PropertyType });
            if (propertyType) {
                wpProp.type = propertyType.id
            } else {
                this.logger.warn(`PropertyType not found with name ${candidate.PropertyType}`);
            }

            // this.logger.info(wpProp.city);
            return wpProp;
        }


    },

	/**
	 * Service created lifecycle event handler
	 */
    created() {
        this.clearCandidates();
        this.clearStats();
    },

	/**
	 * Service started lifecycle event handler
	 */
    started() {
        this.clearCandidates()
        this.clearStats();
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    stopped() {
        this.clearCandidates()
        this.postCandidates = null;
        this.draftCandidates = null;
        this.offset = null;
        this.batchSize = null;
        this.candidateLength = null;
    }
};