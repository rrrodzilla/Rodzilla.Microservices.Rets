"use strict";
var rets = require('rets-client');
const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const { MoleculerError } = require("moleculer").Errors;
const moment = require('moment');
var through2 = require('through2');
var Promise = require('bluebird');
const mysql = require('mysql');

module.exports = {
    name: "wordpress.rets.properties",

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
     * Note: To do a year long bulk insert (roughly 3-4k properties and associated images and meta data) you must increase the max_allowed_packet size to 1073741824
	 */
    actions: {
        fetch: {
            params: {
                limit: { type: "number", integer: true, positive: true, optional: true },
                lc: { type: "string", optional: true },
                ia: { type: "boolean", optional: true },
                silent: { type: "boolean", optional: true },
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
                let postId = await this.getMaxPostId();
                let postMetaId = await this.getMaxPostMetaId();
                let toTitleCase = this.toTitleCase;
                let context = ctx;
                let validCounter = 0;
                let totalCounter = 0;
                this.limit = (ctx.params.limit) ? ctx.params.limit : 50;
                this.silent = ctx.params.silent;

                this.minutesAgo = (ctx.params.ma) ? ctx.params.ma : 15;
                let minutesAgo = moment().subtract(this.minutesAgo, "minutes");
                this.lastChangeTimeStamp = (!ctx.params.lc) ? minutesAgo.toISOString() : moment(ctx.params.lc).toISOString();

                context.broker.logger.info(`Searching for active properties from ${moment(this.lastChangeTimeStamp).fromNow()} in batches of ${this.limit}`);

                const googleGeoValidationStream = through2.obj(async (property, encoding, callback) => {
                    const googleMapsClient = require('@google/maps').createClient({
                        key: process.env.GOOGLE_API_KEY,
                        Promise: Promise
                    });

                    //geo validation stream
                    const geo = await googleMapsClient.geocode({ address: property.FullAddress })
                        .asPromise()
                        .then((response) => {
                            let results = response.json.results[0];
                            if (results === undefined) {
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
                        }).catch(error => {
                            context.broker.logger.error(error);
                        });
                    Promise.resolve(geo);
                    if (geo) {
                        property.fave_property_location = `${geo.Location.lat}, ${geo.Location.lng},14`
                        property.houzez_geolocation_lat = geo.Location.lat;
                        property.houzez_geolocation_long = geo.Location.lng;
                        property.streetAddress = geo.StreetAddress;
                        callback(null, property);
                    } else {
                        //emit an invalid geo event
                        if (!this.silent) { process.stdout.write('\x1b[33m.\x1b[0m'); }
                        callback(null, null);
                        // context.broker.logger.warn("BAD GEO: " + property.FullAddress);
                    }
                });


                const determineIdsStream = through2.obj(async (property, encoding, callback) => {
                    property.postId = ++postId;
                    // this.logger.info("Starting Post Id: " + property.postId);
                    property.postMetaStateId = ++postMetaId;
                    property.postMetaCountyId = ++postMetaId;
                    property.postMetaPropertyTypeId = ++postMetaId;
                    property.postMetaIdFavePropertyMap = ++postMetaId;
                    property.postMetaIdFavePropertyMapStreetView = ++postMetaId;
                    property.postMetaIdFavePropertyId = ++postMetaId;
                    property.postGeoLocationLongId = ++postMetaId;
                    property.postGeoLocationLatId = ++postMetaId;
                    property.postMetaFavePropertyLocationId = ++postMetaId;
                    property.postMetaFavePropertyZipId = ++postMetaId;
                    property.postMetaFavePropertyAddressId = ++postMetaId;
                    property.postMetaFavePropertyMapAddressId = ++postMetaId;
                    property.postMetaFavePropertyYearId = ++postMetaId;
                    property.postMetaFavePropertyGarageId = ++postMetaId;
                    property.postMetaFavePropertyBathroomsId = ++postMetaId;
                    property.postMetaFavePropertyBedroomsId = ++postMetaId;
                    property.postMetaFavePropertySizePrefixId = ++postMetaId;
                    property.postMetaFavePropertySizeId = ++postMetaId;
                    property.postMetaFavePropertyPriceId = ++postMetaId;
                    callback(null, property);
                });


                // initial fetch stream
                const initialFetchStream = through2.obj(async (event, encoding, callback) => {

                    if (event.type === "error") {
                        console.log('Error streaming RETS results: ' + event.payload);
                        streamResult.retsStream.unpipe(initialFetchStream);
                        initialFetchStream.end();
                        // we need to reject the auto-logout promise
                        reject(event.payload);
                        callback();
                    }

                    if (event.type === "data") {
                        let property = event.payload;
                        totalCounter++;
                        property.FullAddress = [property.StreetNumber.trim(), property.StreetDirPrefix.trim().toUpperCase(), toTitleCase(property.StreetName.trim()), toTitleCase(property.StreetSuffix.trim()), toTitleCase(property.City.trim()), property.StateOrProvince.trim().toUpperCase(), property.PostalCode.trim()].filter(Boolean).join(" ");
                        const schema = Joi.object().keys({
                            StreetNumber: Joi.number().min(1).required(),
                            Matrix_Unique_ID: Joi.string().alphanum().required()
                        });

                        //initial round of validation
                        const result = Joi.validate({ StreetNumber: property.StreetNumber, Matrix_Unique_ID: property.Matrix_Unique_ID }, schema);

                        if (result.error === null) {
                            // context.broker.logger.info(property.FullAddress);
                            // context.emit("rets.property.valid.result", property);
                            property.fave_property_map_street_view = "show";
                            property.fave_property_map = 1;
                            property.fave_property_id = property.MLSNumber;
                            property.fave_property_price = property.ListPrice;
                            callback(null, property);
                            return;
                        } else {
                            if (!this.silent) { process.stdout.write('\x1b[31m.\x1b[0m'); }
                        }

                    }
                    callback();
                });

                // buncha meta
                const determineStateStream = through2.obj(async (property, encoding, callback) => {
                    const state = await this.broker.call("wordpress.houzez.states.fetch", { name: property.StateOrProvince });
                    if (typeof state !== 'undefined' && state) {
                        postMetaSql += `(${property.postMetaStateId}, ${property.postId}, 'property_state', ${state.id}),`;
                        termRelationshipsSql += `(${property.postId}, ${state.id}),`;
                        property.metaStateId = state.id;
                        callback(null, property);
                    } else {
                        //get rid of this property
                        if (!this.silent) { process.stdout.write('\x1b[31m.\x1b[0m'); }
                        callback(null, null);
                    }
                });
                const determineCountyStream = through2.obj(async (property, encoding, callback) => {
                    const county = await this.broker.call("wordpress.houzez.counties.fetch", { name: property.CountyOrParish });
                    if (typeof county !== 'undefined' && county) {
                        postMetaSql += `(${property.postMetaCountyId}, ${property.postId}, 'property_state', ${county.id}),`;
                        termRelationshipsSql += `(${property.postId}, ${county.id}),`;
                        callback(null, property);
                    } else {
                        //get rid of this property
                        if (!this.silent) { process.stdout.write('\x1b[31m.\x1b[0m'); }
                        callback(null, null);
                    }
                });
                const determinePropertyTypeStream = through2.obj(async (property, encoding, callback) => {
                    const propertyType = await this.broker.call("wordpress.houzez.propertyTypes.fetch", { name: property.PropertyType });
                    if (typeof propertyType !== 'undefined' && propertyType) {
                        postMetaSql += `(${property.postMetaPropertyTypeId}, ${property.postId}, 'property_type', ${propertyType.id}),`;
                        callback(null, property);
                    } else {
                        //get rid of this property
                        if (!this.silent) { process.stdout.write('\x1b[31m.\x1b[0m'); }
                        callback(null, null);
                    }
                });
                const favePropertyMapStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaIdFavePropertyMap}, ${property.postId}, 'fave_property_map', 1),`;
                    callback(null, property);
                });
                const favePropertyMapStreetViewStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaIdFavePropertyMapStreetView}, ${property.postId}, 'fave_property_map_street_view', 'show'),`;
                    callback(null, property);
                });
                const favePropertyIdStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaIdFavePropertyId}, ${property.postId}, 'fave_property_id', ${property.MLSNumber}),`;
                    callback(null, property);
                });
                const GeoLocationLongStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postGeoLocationLongId}, ${property.postId}, 'houzez_geolocation_long', ${property.houzez_geolocation_long}),`;
                    callback(null, property);
                });
                const GeoLocationLatStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postGeoLocationLatId}, ${property.postId}, 'houzez_geolocation_lat', ${property.houzez_geolocation_lat}),`;
                    callback(null, property);
                });
                const FavePropertyLocationStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyLocationId}, ${property.postId}, 'fave_property_location', '${property.houzez_geolocation_lat}, ${property.houzez_geolocation_long}'),`;
                    callback(null, property);
                });
                const FavePropertyZipStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyZipId}, ${property.postId}, 'fave_property_zip', '${property.PostalCode}'),`;
                    callback(null, property);
                });
                const FavePropertyAddressStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyAddressId}, ${property.postId}, 'fave_property_address', ${mysql.escape(property.streetAddress)}),`;
                    callback(null, property);
                });
                const FavePropertyMapAddressStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyMapAddressId}, ${property.postId}, 'fave_property_map_address', ${mysql.escape(property.FullAddress)}),`;
                    callback(null, property);
                });
                const FavePropertyYearStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyYearId}, ${property.postId}, 'fave_property_year', '${property.YearBuilt}'),`;
                    callback(null, property);
                });
                const FavePropertyGarageStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyGarageId}, ${property.postId}, 'fave_property_garage', '${property.GarageSpaces}'),`;
                    callback(null, property);
                });
                const FavePropertyBathroomsStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyBathroomsId}, ${property.postId}, 'fave_property_bathrooms', '${property.BathsTotal}'),`;
                    callback(null, property);
                });
                const FavePropertyBedroomsStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyBedroomsId}, ${property.postId}, 'fave_property_bedrooms', '${property.BedsTotal}'),`;
                    callback(null, property);
                });
                const FavePropertySizePrefixStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertySizePrefixId}, ${property.postId}, 'fave_property_size_prefix', 'Sq Ft'),`;
                    callback(null, property);
                });
                const FavePropertySizeStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertySizeId}, ${property.postId}, 'fave_property_size', '${property.SqFtTotal}'),`;
                    callback(null, property);
                });
                const FavePropertyPriceStream = through2.obj(async (property, encoding, callback) => {
                    postMetaSql += `(${property.postMetaFavePropertyPriceId}, ${property.postId}, 'fave_property_price', '${property.ListPrice}'),`;
                    callback(null, property);
                });
                const GeneratePropertyPostStream = through2.obj(async (property, encoding, callback) => {
                    postSql += `(${property.postId}, 1,'${date}', '${utcDate}', ${mysql.escape(property.PublicRemarks)}, ${mysql.escape(property.streetAddress)}, '', 'draft', 'closed','closed', '${property.MLSNumber}','', '', '${date}', '${utcDate}', '', 0, 'https://www.ccpowerhouseproperties.com/?post_type=property&p=${postId}', 'property', ''),`;
                    callback(null, property);
                });
                const GeneratePropertyImagePostsStream = through2.obj(async (property, encoding, callback) => {
                    for (let index = 0; index < property.PhotoCount; index++) {
                        // here we want to generate posts for each image with an assumed name and location
                        // the images will be uploaded seperately to blob storage
                        postId++;
                        postSql += `(${postId}, 1,'${date}', '${utcDate}', ${mysql.escape(property.PublicRemarks)}, ${mysql.escape(property.streetAddress)}, '', 'inherit', 'closed','closed', '${property.MLSNumber}','', '', '${date}', '${utcDate}', '', 0, 'https://gchs.org/wp-content/uploads/Image-Coming-Soon-Placeholder.png', 'attachment', 'image/jpeg'),`;
                        // is this the first image?  If so, it's our thumbnail
                        if (index === 0) {
                            ++postMetaId;
                            postMetaSql += `(${postMetaId}, ${property.postId}, '_thumbnail_id', '${postId}'),`;
                        }

                        ++postMetaId;
                        postMetaSql += `(${postMetaId}, ${property.postId}, 'fave_property_images', '${postId}'),`;
                        //now associate the image to the property post
                    }
                    callback(null, property);
                });


                let postSql = "INSERT INTO wp_posts (ID, post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_name,to_ping, pinged, post_modified, post_modified_gmt, post_content_filtered, post_parent, guid, post_type, post_mime_type) VALUES ";
                let postMetaSql = "INSERT INTO wp_postmeta (meta_id, post_id, meta_key, meta_value) VALUES ";
                let termRelationshipsSql = "INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES ";
                const date = moment().format("YYYY-MM-DD hh:mm:ss");
                const utcDate = moment().utc().format("YYYY-MM-DD hh:mm:ss");

                return new Promise((resolve, reject) => {
                    const searchResults = this.retsClient.search.stream.query("Property", "Listing", `(LastChangeTimestamp=${this.lastChangeTimeStamp}+),(PropertyType=RES,MUL,LOT,FRM,COM),(Status=A)`, { offset: ctx.service.offset, limit: ctx.service.limit, select: "PhotoCount,Matrix_Unique_ID,PropertyType,ListPrice,SqFtTotal,LotSize,BedsTotal,BathsTotal,GarageSpaces,YearBuilt,MLSNumber,City,CountyOrParish,StreetNumber,StreetDirPrefix,StreetName,StreetSuffix,PostalCode,StateOrProvince,Style,PublicRemarks" });

                    searchResults.retsStream
                        .pipe(initialFetchStream)                               // initial stream with address validation            
                        .pipe(googleGeoValidationStream)                        // geo validation
                        .pipe(determineIdsStream)
                        .pipe(determineStateStream)
                        .pipe(determineCountyStream)
                        .pipe(determinePropertyTypeStream)                      // TODO: this needs to be primed for one type (For Sale) and relationship updated
                        .pipe(GeneratePropertyPostStream)
                        .pipe(GeneratePropertyImagePostsStream)
                        .pipe(favePropertyMapStream)
                        .pipe(favePropertyMapStreetViewStream)
                        .pipe(favePropertyIdStream)
                        .pipe(GeoLocationLongStream)
                        .pipe(GeoLocationLatStream)
                        .pipe(FavePropertyLocationStream)
                        .pipe(FavePropertyZipStream)
                        .pipe(FavePropertyAddressStream)
                        .pipe(FavePropertyMapAddressStream)
                        .pipe(FavePropertyYearStream)
                        .pipe(FavePropertyGarageStream)
                        .pipe(FavePropertyBathroomsStream)
                        .pipe(FavePropertyBedroomsStream)
                        .pipe(FavePropertySizePrefixStream)
                        .pipe(FavePropertySizeStream)
                        .pipe(FavePropertyPriceStream)
                        .on('data', (property) => {
                            validCounter++;
                            if (!this.silent) { process.stdout.write('\x1b[32m.\x1b[0m'); }
                            // // if(property.FullAddress.includes("s End St Rockport TX 78382")){
                            //     console.log(property.MapCoordinates);
                            // // }
                        })
                        .on('finish', async () => {
                            if (!this.silent) { process.stdout.write("Done!"); }
                            console.log();
                            context.broker.logger.info(`Recieved ${validCounter} valid properties from ${totalCounter} received.`)

                            await this.bulkUpsert(context, postSql, postMetaSql, termRelationshipsSql);

                        });

                    resolve('');

                });
            },
        }
    },

	/**
	 * Events
	 */
    events: {
    },

	/**
	 * Methods
	 */
    methods: {
        async bulkUpsert(ctx, rawPostSql, rawPostMetaSql, rawTermRelationshipSql) {
            let context = ctx;
            this.logger.info(`Bulk uploading properties, images, meta and relationship data...`);
            let postSql = rawPostSql.slice(0, -1);
            let postMetaSql = rawPostMetaSql.slice(0, -1);
            let termSql = rawTermRelationshipSql.slice(0, -1);

            return new Promise((resolve, reject) => {
                this.pool.getConnection((err, connection) => {
                    let temp_connection = connection;
                    temp_connection.beginTransaction((err) => {
                        if (err) reject(err);


                        temp_connection.query(postSql, async function (error, results, fields) {
                            if (error) {
                                context.broker.logger.error(`Error bulk uploading properties and images: ${error}`);
                                temp_connection.rollback(() => {
                                    temp_connection.release();
                                    context.broker.logger.warn(`Upserts rolled back`);
                                    resolve(error);
                                })
                            } else {
                                context.broker.logger.info(`Attempting to upsert ${results.affectedRows} properties and images`);
                                context.broker.logger.info("Done!");

                                temp_connection.query(postMetaSql, async function (error, results, fields) {
                                    if (error) {
                                        context.broker.logger.error(`Error bulk uploading property meta data: ${error}`);
                                        temp_connection.rollback(() => {
                                            temp_connection.release();
                                            context.broker.logger.warn(`Upserts rolled back`);
                                            resolve(error);
                                        })
                                    } else {
                                        context.broker.logger.info(`Attempting to upsert ${results.affectedRows} property meta data items`);
                                        context.broker.logger.info("Done!");

                                        temp_connection.query(termSql, async function (error, results, fields) {
                                            if (error) {
                                                context.broker.logger.error(`Error bulk uploading term relationship data: ${error}`);
                                                temp_connection.rollback(() => {
                                                    temp_connection.release();
                                                    context.broker.logger.warn(`Upserts rolled back`);
                                                    resolve(error);
                                                })
                                            } else {
                                                context.broker.logger.info(`Attempting to upsert ${results.affectedRows} term relationships data items`);
                                                context.broker.logger.info("Done!");

                                                temp_connection.commit((err) => {
                                                    if (err) {
                                                        temp_connection.rollback(() => {
                                                            temp_connection.release();
                                                            context.broker.logger.info(`Upserts rolled back`);
                                                            resolve(error);
                                                        });
                                                    } else {
                                                        context.broker.logger.info(`Upserts committed`);
                                                        temp_connection.release();
                                                        resolve();
                                                    }
                                                });
                                            }
                                        });
                                    }
                                });

                            }


                        });

                    });

                });

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
        async getMaxPostId() {
            return new Promise((resolve, reject) => {
                const ctx = this;
                this.pool.query(`SELECT MAX(ID) AS lastid FROM wp_posts`, async function (error, results, fields) {
                    if (error) {
                        ctx.logger.error(`Issue getting max post id.`);
                        reject(error);
                    };
                    resolve(results[0].lastid);
                });
            });
        },
        async getMaxPostMetaId() {
            return new Promise((resolve, reject) => {
                const ctx = this;
                this.pool.query(`SELECT MAX(meta_id) AS lastid FROM wp_postmeta`, async function (error, results, fields) {
                    if (error) {
                        ctx.logger.error(`Issue getting max post meta id.`);
                        reject(error);
                    };
                    resolve(results[0].lastid);
                });
            });
        },

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
        this.offset = null;

    }
};