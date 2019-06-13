/**
 * @author:    Partner
 * @license:   UNLICENSED
 *
 * @copyright: Copyright (c) 2016 by Index Exchange. All rights reserved.
 *
 * The information contained within this document is confidential, copyrighted
 * and or a trade secret. No part of this document may be reproduced or
 * distributed in any form or by any means, in whole or in part, without the
 * prior written permission of Index Exchange.
 */

'use strict';

////////////////////////////////////////////////////////////////////////////////
// Dependencies ////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

var Browser = require('browser.js');
var Classify = require('classify.js');
var Constants = require('constants.js');
var Network = require('network.js');
var Partner = require('partner.js');
var Size = require('size.js');
var SpaceCamp = require('space-camp.js');
var System = require('system.js');
var Utilities = require('utilities.js');
var Whoopsie = require('whoopsie.js');

var EventsService;
var RenderService;
var ComplianceService;

//? if (DEBUG) {
var ConfigValidators = require('config-validators.js');
var Inspector = require('schema-inspector.js');
var PartnerSpecificValidator = require('rubicon-htb-validator.js');
var Scribe = require('scribe.js');
//? }

////////////////////////////////////////////////////////////////////////////////
// Main ////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

/**
 * Partner module template
 *
 * @class
 */

function RubiconModule(configs) {
    /* Rubicon endpoint only works with AJAX */
    if (!Network.isXhrSupported()) {
        //? if (DEBUG) {
        Scribe.warn('Partner RubiconHtb requires AJAX support. Aborting instantiation.');
        //? }

        return null;
    }

    /* =====================================
     * Data
     * ---------------------------------- */

    /* Private
     * ---------------------------------- */

    /**
     * Reference to the partner base class.
     *
     * @private {object}
     */
    var __baseClass;

    /**
     * Profile for this partner.
     *
     * @private {object}
     */
    var __profile;

    /**
     * Base URL for the bidding end-point.
     *
     * @private {object}
     */
    var __baseUrl;

    /**
     * Mapping of sizes to rubicon size IDs
     *
     * @private {object}
     */
    var __sizeToSizeIdMapping;

    var __pageFirstPartyData;

    /* =====================================
     * Functions
     * ---------------------------------- */

    /* Utilities
     * ---------------------------------- */

    /**
     * Translates an array of size arrays to an array of Rubicon size IDs
     * @param  {array} sizes [description]
     * @return {array}       [description]
     */
    function __mapSizesToRubiconSizeIds(sizes) {
        var rubiSizeIds = [];

        for (var i = 0; i < sizes.length; i++) {
            var sizeKey = Size.arrayToString(sizes[i]);
            if (__sizeToSizeIdMapping.hasOwnProperty(sizeKey)) {
                rubiSizeIds.push(__sizeToSizeIdMapping[sizeKey]);
            } else {
                //? if(DEBUG) {
                Scribe.warn('No rubicon size id for size ' + sizeKey);
                //? }
            }
        }

        return rubiSizeIds;
    }

    /**
     * Gets the actual size represented by a rubicon size id
     *
     * @param  {string} rubiconSize [description]
     * @return {[type]}             [description]
     */
    function __mapRubiconSizeIdToSize(rubiconSize) {
        for (var sizeKey in __sizeToSizeIdMapping) {
            if (!__sizeToSizeIdMapping.hasOwnProperty(sizeKey)) {
                continue;
            }

            if (__sizeToSizeIdMapping[sizeKey] === Number(rubiconSize)) {
                return Size.stringToArray(sizeKey)[0];
            }
        }
        //? if(DEBUG) {
        Scribe.warn('Unknown rubicon size id ' + rubiconSize);
        //? }

        return [];
    }

    function __evalVariable(variableString) {
        try {
            /* eslint-disable no-eval */
            return eval.call(null, variableString);
            /* eslint-enable no-eval */
        } catch (ex) {
            //? if (DEBUG) {
            Scribe.error('Error evaluating variable ' + variableString + ': ' + ex);
            //? }
        }

        return null;
    }

    function __evalFunction(functionString, args) {
        try {
            /* eslint-disable no-eval */
            return eval.call(null, functionString + '(' + args.join() + ')');
            /* eslint-enable no-eval */
        } catch (ex) {
            //? if (DEBUG) {
            Scribe.error('Error evaluating function ' + functionString + ': ' + ex);
            //? }
        }

        return null;
    }

    function __transformFpdSubobject(subobject) {
        var returnSubobject = {};

        if (subobject.vars) {
            var vars = subobject.vars;

            for (var varsKey in vars) {
                if (!vars.hasOwnProperty(varsKey)) {
                    continue;
                }

                returnSubobject[varsKey] = returnSubobject[varsKey] || [];

                for (var i = 0; i < vars[varsKey].length; i++) {
                    var evaledVariable = __evalVariable(vars[varsKey][i]);

                    if (evaledVariable !== null && typeof evaledVariable !== 'undefined') {
                        returnSubobject[varsKey].push(evaledVariable);
                    }
                }
            }
        }

        if (subobject.strs) {
            var strs = subobject.strs;

            for (var strsKey in strs) {
                if (!strs.hasOwnProperty(strsKey)) {
                    continue;
                }

                returnSubobject[strsKey] = returnSubobject[strsKey] || [];

                for (var j = 0; j < strs[strsKey].length; j++) {
                    returnSubobject[strsKey].push(strs[strsKey][j]);
                }
            }
        }

        if (subobject.fns) {
            var fns = subobject.fns;

            for (var fnsKey in fns) {
                if (!fns.hasOwnProperty(fnsKey)) {
                    continue;
                }

                returnSubobject[fnsKey] = returnSubobject[fnsKey] || [];

                var evaledValue = __evalFunction(fns[fnsKey].fn, fns[fnsKey].args);

                if (evaledValue !== null && typeof evaledValue !== 'undefined') {
                    if (Utilities.isArray(evaledValue)) {
                        for (var k = 0; k < evaledValue.length; k++) {
                            returnSubobject[fnsKey].push(evaledValue[k]);
                        }
                    } else {
                        returnSubobject[fnsKey].push(evaledValue);
                    }
                }
            }
        }

        return returnSubobject;
    }

    function __transformFirstPartyData(fpdObject) {
        var firstPartyData = {};

        if (fpdObject.inventory) {
            firstPartyData.inventory = __transformFpdSubobject(fpdObject.inventory);
        }

        if (fpdObject.visitor) {
            firstPartyData.visitor = __transformFpdSubobject(fpdObject.visitor);
        }

        if (fpdObject.position) {
            firstPartyData.position = fpdObject.position;
        }

        if (fpdObject.keywords) {
            if (Utilities.isString(fpdObject.keywords)) {
                firstPartyData.keywords = [fpdObject.keywords];
            } else {
                firstPartyData.keywords = fpdObject.keywords;
            }
        }

        return firstPartyData;
    }

    function _getDigiTrustQueryParams() {
        function getDigiTrustId() {
            var digiTrustUser;
            var _window;

            if (!Browser.isTopFrame()) {
                try {
                    _window = window.top;
                } catch (e) {
                    _window = Browser.topWindow;
                }
            } else {
                _window = window;
            }

            try {
                digiTrustUser = _window.DigiTrust.getUser({ member: 'T9QSFKPDN9' });
            } catch (e) {}

            return (digiTrustUser && digiTrustUser.success && digiTrustUser.identity) || null;
        }
        var digiTrustId = configs.digitrustId || getDigiTrustId();

        // Verify there is an ID and this user has not opted out
        if (!digiTrustId || (digiTrustId.privacy && digiTrustId.privacy.optout)) {
            return {};
        }
        var _dt = {
            id: digiTrustId.id,
            keyv: digiTrustId.keyv,
            pref: 0
        };

        return _dt;
    }

    /**
     * @summary combines param values from an array of slots into a single semicolon delineated value
     * or just one value if they are all the same.
     * @param {Object[]} aSlotUrlParams - example [{p1: 'foo', p2: 'test'}, {p2: 'test'}, {p1: 'bar', p2: 'test'}]
     * @return {Object} - example {p1: 'foo;;bar', p2: 'test'}
     */
    function combineSlotUrlParams(aSlotUrlParams) {
    
    // if only have params for one slot, return those params
    if (aSlotUrlParams.length === 1) {
      return aSlotUrlParams[0];
    }

    // reduce param values from all slot objects into an array of values in a single object
    const oCombinedSlotUrlParams = aSlotUrlParams.reduce(function(oCombinedParams, oSlotUrlParams, iIndex) {
      Object.keys(oSlotUrlParams).forEach(function(param) {
        if (!oCombinedParams.hasOwnProperty(param)) {
          oCombinedParams[param] = new Array(aSlotUrlParams.length); // initialize array;
        }
        // insert into the proper element of the array
        oCombinedParams[param].splice(iIndex, 1, oSlotUrlParams[param]);
      });

      return oCombinedParams;
    }, {});

    // convert arrays into semicolon delimited strings
    const re = new RegExp('^([^;]*)(;\\1)+$'); // regex to test for duplication

    Object.keys(oCombinedSlotUrlParams).forEach(function(param) {
      const sValues = oCombinedSlotUrlParams[param].join(';');
      // consolidate param values into one value if they are all the same
      const match = sValues.match(re);
      oCombinedSlotUrlParams[param] = match ? match[1] : sValues;
    });

    return oCombinedSlotUrlParams;
    }

    /**
     * Generates the request URL to the endpoint for the xSlots in the given
     * returnParcels.
     *
     * @param  {object[]} returnParcels [description]
     * @return {string}            [description]
     */

    function __generateRequestObj(returnParcels) {

        //? if (DEBUG){
        var results = Inspector.validate({
            type: 'array',
            minLength: 1,
            items: {
                type: 'object',
                properties: {
                    htSlot: {
                        type: 'object'
                    },
                    xSlotRef: {
                        type: 'object'
                    },
                    xSlotName: {
                        type: 'string',
                        minLength: 1
                    },
                    firstPartyData: {
                        optional: true,
                        properties: {
                            rubicon: {
                                optional: true,
                                type: 'object',
                                strict: true,
                                properties: {
                                    keywords: {
                                        optional: true,
                                        type: 'array',
                                        items: {
                                            type: 'string'
                                        }
                                    },
                                    inventory: {
                                        optional: true,
                                        properties: {
                                            '*': {
                                                type: 'array',
                                                items: {
                                                    type: 'string'
                                                }
                                            }
                                        }
                                    },
                                    visitor: {
                                        optional: true,
                                        properties: {
                                            '*': {
                                                type: 'array',
                                                items: {
                                                    type: 'string'
                                                }
                                            }
                                        }
                                    },
                                    position: {
                                        optional: true,
                                        type: 'string'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }, returnParcels);
        if (!results.valid) {
            throw Whoopsie('INVALID_ARGUMENT', results.format());
        }
        //? }

        var callbackId = System.generateUniqueId();

        const combinedSlotParams = combineSlotUrlParams(returnParcels.map(parcel => {
            return createSlotParams(parcel);
        }));

        function createSlotParams(parcel) {

            var slotFirstPartyData = {};
            var pageFirstPartyData = {};

            if (parcel.firstPartyData && parcel.firstPartyData.rubicon) {
                slotFirstPartyData = parcel.firstPartyData.rubicon;
            } else if (parcel.xSlotRef.slotFpd) {
                slotFirstPartyData = __transformFirstPartyData(parcel.xSlotRef.slotFpd);
            }

            if (__pageFirstPartyData) {
                pageFirstPartyData = __pageFirstPartyData;
            } else if (configs.partnerFpd) {
                pageFirstPartyData = __transformFirstPartyData(configs.partnerFpd);
            }

            var rubiSizeIds = __mapSizesToRubiconSizeIds(parcel.xSlotRef.sizes);
            var referrer = Browser.getPageUrl();

            var gdprConsent = ComplianceService.gdpr && ComplianceService.gdpr.getConsent();
            var privacyEnabled = ComplianceService.isPrivacyEnabled();
            /* eslint-disable camelcase */
            var queryObj = {
                account_id: configs.accountId,
                size_id: rubiSizeIds[0],
                p_pos: slotFirstPartyData.position ? slotFirstPartyData.position : 'btf',
                rp_floor: 0.01,
                rf: referrer ? referrer : '',
                p_screen_res: Browser.getScreenWidth() + 'x' + Browser.getScreenHeight(),
                site_id: parcel.xSlotRef.siteId,
                zone_id: parcel.xSlotRef.zoneId,
                kw: 'rp.fastlane',
                tk_flint: 'index',
                rand: Math.random(),
                dt: _getDigiTrustQueryParams()
            };
            /* eslint-enable camelcase */
            if (gdprConsent && privacyEnabled && typeof gdprConsent === 'object') {
                if (typeof gdprConsent.applies === 'boolean') {
                    queryObj.gdpr = Number(gdprConsent.applies);
                }
                /* eslint-disable camelcase */
                queryObj.gdpr_consent = gdprConsent.consentString;
                /* eslint-enable camelcase */
            }

            for (var pageInv in pageFirstPartyData.inventory) {
                if (!pageFirstPartyData.inventory.hasOwnProperty(pageInv)) {
                    continue;
                }
                queryObj['tg_i.' + pageInv] = pageFirstPartyData.inventory[pageInv].toString();
            }

            for (var slotInv in slotFirstPartyData.inventory) {
                if (!slotFirstPartyData.inventory.hasOwnProperty(slotInv)) {
                    continue;
                }

                if (queryObj.hasOwnProperty('tg_i.' + slotInv)) {
                    queryObj['tg_i.' + slotInv] += ',' + slotFirstPartyData.inventory[slotInv].toString();
                } else {
                    queryObj['tg_i.' + slotInv] = slotFirstPartyData.inventory[slotInv].toString();
                }
            }

            for (var pageVis in pageFirstPartyData.visitor) {
                if (!pageFirstPartyData.visitor.hasOwnProperty(pageVis)) {
                    continue;
                }
                queryObj['tg_v.' + pageVis] = pageFirstPartyData.visitor[pageVis].toString();
            }

            for (var slotVis in slotFirstPartyData.visitor) {
                if (!slotFirstPartyData.visitor.hasOwnProperty(slotVis)) {
                    continue;
                }

                if (queryObj.hasOwnProperty('tg_v.' + slotVis)) {
                    queryObj['tg_v.' + slotVis] += ',' + slotFirstPartyData.visitor[slotVis].toString();
                } else {
                    queryObj['tg_v.' + slotVis] = slotFirstPartyData.visitor[slotVis].toString();
                }
            }
            var keywords = [];

            if (pageFirstPartyData.keywords) {
                keywords = keywords.concat(pageFirstPartyData.keywords);
            }

            if (slotFirstPartyData.keywords) {
                keywords = keywords.concat(slotFirstPartyData.keywords);
            }

            if (keywords.length > 0) {
                queryObj.kw += ',' + keywords.toString();
            }

            if (rubiSizeIds.length > 1) {
                /* eslint-disable camelcase */
                queryObj.alt_size_ids = rubiSizeIds.slice(1)
                    .join(',') || undefined;
                /* eslint-enable camelcase */
            }

            return queryObj;
        }

        combinedSlotParams.slots = returnParcels.length;

        return {
            url: __baseUrl,
            data: combinedSlotParams,
            callbackId: callbackId
        };
    }

    /* Helpers
     * ---------------------------------- */

    /* Parses adResponse and ads any demand into outParcels */
    function __parseResponse(sessionId, adResponse, returnParcels) {
        //? if (DEBUG){
        var results = Inspector.validate({
            type: 'array',
            exactLength: 1,
            items: {
                type: 'object',
                properties: {
                    htSlot: {
                        type: 'object'
                    },
                    xSlotRef: {
                        type: 'object'
                    },
                    xSlotName: {
                        type: 'string',
                        minLength: 1
                    }
                }
            }
        }, returnParcels);
        if (!results.valid) {
            throw Whoopsie('INVALID_ARGUMENT', results.format());
        }
        //? }

        /* Prepare the info to send to header stats */
        var headerStatsInfo = {
            sessionId: sessionId,
            statsId: __profile.statsId
        };

        var bidReceived = false;

        var bids = adResponse.ads || [];

        /* If no bids returned, mark the original parcel as pass */
        if (!bids.length) {
            returnParcels[0].pass = true;
        }

        if (adResponse && adResponse.ads && adResponse.ads.length > 0) {
            for (var i = 0; i < adResponse.ads; i++) {
                bids = bids.concat(adResponse.ads[i]);
            }
        }

        for (var j = 0; j < returnParcels.length; j++) {
            var curReturnParcel = returnParcels[j];
            var curBid;

            for (var i = 0; i < bids.length; i++) {

                if (i === j) {
                    curBid = bids[i];
                } else {
                    continue;
                }

                /* A rubicon slot may have more than one size, so we might need to return more than
                   one parcel */
                if (i === 0) {
                    curReturnParcel = returnParcels[0];

                    /* Fill out the other required headerstats info from the parcel */
                    headerStatsInfo.htSlotId = curReturnParcel.htSlot.getId();
                    headerStatsInfo.requestId = curReturnParcel.requestId;
                    headerStatsInfo.xSlotNames = [curReturnParcel.xSlotName];
                } else {
                    curReturnParcel = {
                        partnerId: returnParcels[i].partnerId,
                        htSlot: returnParcels[i].htSlot,
                        ref: returnParcels[i].ref,
                        xSlotRef: returnParcels[i].xSlotRef,
                        xSlotName: returnParcels[i].xSlotName,
                        requestId: returnParcels[i].requestId
                    };

                    returnParcels.push(curReturnParcel);
                }

                var bidPrice = curBid.cpm || 0;

                if (curBid.status !== 'ok' || !Utilities.isNumber(bidPrice) || bidPrice <= 0) {
                    //? if (DEBUG) {
                    Scribe.info(__profile.partnerId
                        + ' returned no demand for { zoneId: '
                        + curReturnParcel.xSlotRef.zoneId
                        + ' }.');
                    //? }

                    curReturnParcel.pass = true;

                    continue;
                }

                bidReceived = true;

                var bidDealId = curBid.deal || '';
                var bidSize = __mapRubiconSizeIdToSize(curBid.size_id);
                var bidCreative = '<html><head><scr'
                    + 'ipt type="text/javascript">inDapIF=true;</scr'
                    + 'ipt>'
                    + '</head><body style="margin : 0; padding: 0;"><!-- Rubicon Project Ad Tag -->'
                    + '<div data-rp-impression-id="'
                    + curBid.impression_id
                    + '">'
                    + '<scr'
                    + 'ipt type="text/javascript">'
                    + curBid.script
                    + '</scr'
                    + 'ipt></div></body></html>';

                curReturnParcel.size = bidSize;
                curReturnParcel.targetingType = 'slot';
                curReturnParcel.targeting = {};

                var targetingCpm = '';
                var rubiSizeId = '';

                //? if(FEATURES.GPT_LINE_ITEMS) {
                targetingCpm = __baseClass._bidTransformers.targeting.apply(bidPrice);

                if (__baseClass._configs.lineItemType === Constants.LineItemTypes.CUSTOM) {
                    if (curBid.targeting) {
                        var rubiTargeting = curBid.targeting;
                        rubiSizeId = curBid.size_id;

                        for (var j = 0; j < rubiTargeting.length; j++) {
                            curReturnParcel.targeting[rubiTargeting[j].key] = rubiTargeting[j].values;
                        }
                    }
                    /* eslint-disable camelcase */
                    curReturnParcel.targeting.rpfl_elemid = [curReturnParcel.requestId];
                    /* eslint-enable camelcase */
                } else {
                    var sizeKey = Size.arrayToString(curReturnParcel.size);

                    if (bidDealId) {
                        curReturnParcel.targeting[__baseClass._configs.targetingKeys.pm] = [sizeKey + '_' + bidDealId];

                        /* Set the custom KVPs for deal only so Rubicon handle tier deal line items */

                        if (curBid.targeting) {
                            var rubiTargetingDeal = curBid.targeting;
                            for (var k = 0; k < rubiTargetingDeal.length; k++) {
                                curReturnParcel.targeting[rubiTargetingDeal[k].key] = rubiTargetingDeal[k].values;
                            }
                        }
                    }

                    /* Set the om key as long as they sent _something_ in the cpm, even if it was zero */

                    if (curBid.hasOwnProperty('cpm')) {
                        curReturnParcel.targeting[__baseClass._configs.targetingKeys.om] = [sizeKey + '_' + targetingCpm];
                    }

                    curReturnParcel.targeting[__baseClass._configs.targetingKeys.id] = [curReturnParcel.requestId];
                }
                //? }

                //? if(FEATURES.RETURN_CREATIVE) {
                curReturnParcel.adm = bidCreative;
                //? }

                //? if(FEATURES.RETURN_PRICE) {
                curReturnParcel.price = Number(__baseClass._bidTransformers.price.apply(bidPrice));
                //? }

                var pubKitAdId = RenderService.registerAd({
                    sessionId: sessionId,
                    partnerId: __profile.partnerId,
                    adm: bidCreative,
                    requestId: curReturnParcel.requestId,
                    size: rubiSizeId ? rubiSizeId : curReturnParcel.size,
                    price: targetingCpm ? targetingCpm : '',
                    dealId: bidDealId ? bidDealId : '',
                    timeOfExpiry: __profile.features.demandExpiry.enabled ? __profile.features.demandExpiry.value + System.now() : 0 // eslint-disable-line
                });
                
                //? if(FEATURES.INTERNAL_RENDER) {
                curReturnParcel.targeting.pubKitAdId = pubKitAdId;
                //? }
            }
        }

        if (__profile.enabledAnalytics.requestTime) {
            var result = 'hs_slot_pass';

            if (bidReceived) {
                result = 'hs_slot_bid';
            } else if (adResponse.status !== 'ok') {
                result = 'hs_slot_error';
            }

            EventsService.emit(result, headerStatsInfo);
        }
    }

    /**
     * Set page-level first party data
     *
     * @param {object} data [description]
     */
    function setFirstPartyData(data) {
        //? if (DEBUG){
        var results = Inspector.validate({
            type: 'object',
            strict: true,
            properties: {
                keywords: {
                    optional: true,
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                inventory: {
                    optional: true,
                    properties: {
                        '*': {
                            type: 'array',
                            items: {
                                type: 'string'
                            }
                        }
                    }
                },
                visitor: {
                    optional: true,
                    properties: {
                        '*': {
                            type: 'array',
                            items: {
                                type: 'string'
                            }
                        }
                    }
                }
            }
        }, data);
        if (!results.valid) {
            throw Whoopsie('INVALID_ARGUMENT', results.format());
        }
        //? }

        __pageFirstPartyData = data;
    }

    /* =====================================
     * Constructors
     * ---------------------------------- */

    (function __constructor() {

        /* Check if all siteId are similar and < 10 and activate SRA if true */
        function getArchitecture() {
            var testSRA = {};
            var SRA_BID_LIMIT = 10;

            for (var key in configs.xSlots) {
                testSRA[configs.xSlots[key]['siteId']] = (+testSRA[configs.xSlots[key]['siteId']] || 0) + 1;  
            }

            if (configs.SRA && (Object.keys(testSRA).length == 1) && (Object.values(testSRA)[0] < SRA_BID_LIMIT+1) ) {
                console.warn('SiteIDs are similar, SRA enabled');
                return Partner.Architectures.SRA;
            } else {
                return Partner.Architectures.MRA;
            }
        }

        EventsService = SpaceCamp.services.EventsService;
        RenderService = SpaceCamp.services.RenderService;
        ComplianceService = SpaceCamp.services.ComplianceService;

        __profile = {
            partnerId: 'RubiconHtb',
            namespace: 'RubiconHtb',
            statsId: 'RUBI',
            version: '2.1.4',
            targetingType: 'slot',
            enabledAnalytics: {
                requestTime: true
            },
            features: {
                demandExpiry: {
                    enabled: false,
                    value: 0
                },
                rateLimiting: {
                    enabled: false,
                    value: 0
                }
            },
            targetingKeys: {
                id: 'ix_rubi_id',
                om: 'ix_rubi_om',
                pm: 'ix_rubi_pm'
            },
            bidUnitInCents: 100,
            lineItemType: Constants.LineItemTypes.ID_AND_SIZE,
            callbackType: Partner.CallbackTypes.NONE,
            architecture: getArchitecture(),
            requestType: Partner.RequestTypes.AJAX
        };

        //? if (DEBUG) {
        var results = ConfigValidators.partnerBaseConfig(configs) || PartnerSpecificValidator(configs);

        if (results) {
            throw Whoopsie('INVALID_CONFIG', results);
        }
        //? }

        __sizeToSizeIdMapping = {
            '468x60': 1,
            '728x90': 2,
            '120x600': 8,
            '160x600': 9,
            '300x600': 10,
            '250x250': 14,
            '300x250': 15,
            '336x280': 16,
            '300x100': 19,
            '980x120': 31,
            '250x360': 32,
            '180x500': 33,
            '980x150': 35,
            '468x400': 37,
            '930x180': 38,
            '320x50': 43,
            '300x50': 44,
            '300x300': 48,
            '300x1050': 54,
            '970x90': 55,
            '970x250': 57,
            '1000x90': 58,
            '320x80': 59,
            '320x150': 60,
            '1000x1000': 61,
            '640x480': 65,
            '320x480': 67,
            '1800x1000': 68,
            '320x320': 72,
            '320x160': 73,
            '980x240': 78,
            '980x300': 79,
            '980x400': 80,
            '480x300': 83,
            '970x310': 94,
            '970x210': 96,
            '480x320': 101,
            '768x1024': 102,
            '480x280': 103,
            '320x240': 108,
            '1000x300': 113,
            '320x100': 117,
            '800x250': 125,
            '200x600': 126,
            '320x250': 159,
            '970x1000': 264,
            '840x250': 158,
            '840x150': 147
        };

        __baseUrl = Browser.getProtocol() + '//fastlane.rubiconproject.com/a/api/fastlane.json';

        __baseClass = Partner(__profile, configs, null, {
            parseResponse: __parseResponse,
            generateRequestObj: __generateRequestObj
        });
    })();

    /* =====================================
     * Public Interface
     * ---------------------------------- */

    var derivedClass = {
        /* Class Information
         * ---------------------------------- */

        //? if (DEBUG) {
        __type__: 'RubiconModule',
        //? }

        //? if (TEST) {
        __baseClass: __baseClass,
        //? }

        /* Data
         * ---------------------------------- */

        //? if (TEST) {
        __profile: __profile,
        __baseUrl: __baseUrl,
        //? }

        /* Functions
         * ---------------------------------- */

        setFirstPartyData: setFirstPartyData,

        //? if (TEST) {
        __parseResponse: __parseResponse,
        __generateRequestObj: __generateRequestObj
        //? }
    };

    return Classify.derive(__baseClass, derivedClass);
}

////////////////////////////////////////////////////////////////////////////////
// Exports /////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

module.exports = RubiconModule;
