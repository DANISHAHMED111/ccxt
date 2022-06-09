"use strict";

// ----------------------------------------------------------------------------

const functions = require ('./functions')

const {
    isNode
    , keys
    , values
    , deepExtend
    , extend
    , clone
    , flatten
    , unique
    , indexBy
    , sortBy
    , sortBy2
    , groupBy
    , aggregate
    , uuid
    , unCamelCase
    , precisionFromString
    , throttle
    , capitalize
    , now
    , timeout
    , TimedOut
    , buildOHLCVC
    , decimalToPrecision
    , defaultFetch
} = functions

const { // eslint-disable-line object-curly-newline
    ExchangeError
    , BadSymbol
    , NullResponse
    , InvalidAddress
    , InvalidOrder
    , NotSupported
    , AuthenticationError
    , DDoSProtection
    , RequestTimeout
    , ExchangeNotAvailable
    , RateLimitExceeded } = require ('./errors')

const { TRUNCATE, ROUND, DECIMAL_PLACES, NO_PADDING } = functions.precisionConstants

const BN = require ('../static_dependencies/BN/bn')
const Precise = require ('./Precise')

// ----------------------------------------------------------------------------

module.exports = class Exchange {

    describe () {
        return {
            'id': undefined,
            'name': undefined,
            'countries': undefined,
            'enableRateLimit': true,
            'rateLimit': 2000, // milliseconds = seconds * 1000
            'certified': false, // if certified by the CCXT dev team
            'pro': false, // if it is integrated with CCXT Pro for WebSocket support
            'alias': false, // whether this exchange is an alias to another exchange
            'has': {
                'publicAPI': true,
                'privateAPI': true,
                'CORS': undefined,
                'spot': undefined,
                'margin': undefined,
                'swap': undefined,
                'future': undefined,
                'option': undefined,
                'addMargin': undefined,
                'cancelAllOrders': undefined,
                'cancelOrder': true,
                'cancelOrders': undefined,
                'createDepositAddress': undefined,
                'createLimitOrder': true,
                'createMarketOrder': true,
                'createOrder': true,
                'createPostOnlyOrder': undefined,
                'createReduceOnlyOrder': undefined,
                'createStopOrder': undefined,
                'createStopLimitOrder': undefined,
                'createStopMarketOrder': undefined,
                'editOrder': 'emulated',
                'fetchAccounts': undefined,
                'fetchBalance': true,
                'fetchBidsAsks': undefined,
                'fetchBorrowInterest': undefined,
                'fetchBorrowRate': undefined,
                'fetchBorrowRateHistory': undefined,
                'fetchBorrowRatesPerSymbol': undefined,
                'fetchBorrowRates': undefined,
                'fetchCanceledOrders': undefined,
                'fetchClosedOrder': undefined,
                'fetchClosedOrders': undefined,
                'fetchCurrencies': 'emulated',
                'fetchDeposit': undefined,
                'fetchDepositAddress': undefined,
                'fetchDepositAddresses': undefined,
                'fetchDepositAddressesByNetwork': undefined,
                'fetchDeposits': undefined,
                'fetchTransactionFee': undefined,
                'fetchTransactionFees': undefined,
                'fetchFundingHistory': undefined,
                'fetchFundingRate': undefined,
                'fetchFundingRateHistory': undefined,
                'fetchFundingRates': undefined,
                'fetchIndexOHLCV': undefined,
                'fetchL2OrderBook': true,
                'fetchLedger': undefined,
                'fetchLedgerEntry': undefined,
                'fetchLeverageTiers': undefined,
                'fetchMarketLeverageTiers': undefined,
                'fetchMarkets': true,
                'fetchMarkOHLCV': undefined,
                'fetchMyTrades': undefined,
                'fetchOHLCV': 'emulated',
                'fetchOpenOrder': undefined,
                'fetchOpenOrders': undefined,
                'fetchOrder': undefined,
                'fetchOrderBook': true,
                'fetchOrderBooks': undefined,
                'fetchOrders': undefined,
                'fetchOrderTrades': undefined,
                'fetchPermissions': undefined,
                'fetchPosition': undefined,
                'fetchPositions': undefined,
                'fetchPositionsRisk': undefined,
                'fetchPremiumIndexOHLCV': undefined,
                'fetchStatus': 'emulated',
                'fetchTicker': true,
                'fetchTickers': undefined,
                'fetchTime': undefined,
                'fetchTrades': true,
                'fetchTradingFee': undefined,
                'fetchTradingFees': undefined,
                'fetchTradingLimits': undefined,
                'fetchTransactions': undefined,
                'fetchTransfers': undefined,
                'fetchWithdrawal': undefined,
                'fetchWithdrawals': undefined,
                'loadMarkets': true,
                'reduceMargin': undefined,
                'setLeverage': undefined,
                'setMargin': undefined,
                'setMarginMode': undefined,
                'setPositionMode': undefined,
                'signIn': undefined,
                'transfer': undefined,
                'withdraw': undefined,
            },
            'urls': {
                'logo': undefined,
                'api': undefined,
                'www': undefined,
                'doc': undefined,
                'fees': undefined,
            },
            'api': undefined,
            'requiredCredentials': {
                'apiKey':     true,
                'secret':     true,
                'uid':        false,
                'login':      false,
                'password':   false,
                'twofa':      false, // 2-factor authentication (one-time password key)
                'privateKey': false, // a "0x"-prefixed hexstring private key for a wallet
                'walletAddress': false, // the wallet address "0x"-prefixed hexstring
                'token':      false, // reserved for HTTP auth in some cases
            },
            'markets': undefined, // to be filled manually or by fetchMarkets
            'currencies': {}, // to be filled manually or by fetchMarkets
            'timeframes': undefined, // redefine if the exchange has.fetchOHLCV
            'fees': {
                'trading': {
                    'tierBased': undefined,
                    'percentage': undefined,
                    'taker': undefined,
                    'maker': undefined,
                },
                'funding': {
                    'tierBased': undefined,
                    'percentage': undefined,
                    'withdraw': {},
                    'deposit': {},
                },
            },
            'status': {
                'status': 'ok',
                'updated': undefined,
                'eta': undefined,
                'url': undefined,
            },
            'exceptions': undefined,
            'httpExceptions': {
                '422': ExchangeError,
                '418': DDoSProtection,
                '429': RateLimitExceeded,
                '404': ExchangeNotAvailable,
                '409': ExchangeNotAvailable,
                '410': ExchangeNotAvailable,
                '500': ExchangeNotAvailable,
                '501': ExchangeNotAvailable,
                '502': ExchangeNotAvailable,
                '520': ExchangeNotAvailable,
                '521': ExchangeNotAvailable,
                '522': ExchangeNotAvailable,
                '525': ExchangeNotAvailable,
                '526': ExchangeNotAvailable,
                '400': ExchangeNotAvailable,
                '403': ExchangeNotAvailable,
                '405': ExchangeNotAvailable,
                '503': ExchangeNotAvailable,
                '530': ExchangeNotAvailable,
                '408': RequestTimeout,
                '504': RequestTimeout,
                '401': AuthenticationError,
                '511': AuthenticationError,
            },
            'commonCurrencies': { // gets extended/overwritten in subclasses
                'XBT': 'BTC',
                'BCC': 'BCH',
                'BCHABC': 'BCH',
                'BCHSV': 'BSV',
            },
            'precisionMode': DECIMAL_PLACES,
            'paddingMode': NO_PADDING,
            'limits': {
                'leverage': { 'min': undefined, 'max': undefined },
                'amount': { 'min': undefined, 'max': undefined },
                'price': { 'min': undefined, 'max': undefined },
                'cost': { 'min': undefined, 'max': undefined },
            },
        } // return
    } // describe ()

    constructor (userConfig = {}) {
        Object.assign (this, functions)
        //
        //     if (isNode) {
        //         this.nodeVersion = process.version.match (/\d+\.\d+\.\d+/)[0]
        //         this.userAgent = {
        //             'User-Agent': 'ccxt/' + Exchange.ccxtVersion +
        //                 ' (+https://github.com/ccxt/ccxt)' +
        //                 ' Node.js/' + this.nodeVersion + ' (JavaScript)'
        //         }
        //     }
        //
        this.options = {} // exchange-specific options, if any
        // fetch implementation options (JS only)
        this.fetchOptions = {
            // keepalive: true, // does not work in Chrome, https://github.com/ccxt/ccxt/issues/6368
        }
        // http properties
        this.userAgents = {
            'chrome': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36',
            'chrome39': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
            'chrome100': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36',
        }
        this.headers = {}
        // prepended to URL, like https://proxy.com/https://exchange.com/api...
        this.proxy = ''
        this.origin = '*' // CORS origin
        // underlying properties
        this.minFundingAddressLength = 1 // used in checkAddress
        this.substituteCommonCurrencyCodes = true  // reserved
        this.quoteJsonNumbers = true // treat numbers in json as quoted precise strings
        this.number = Number // or String (a pointer to a function)
        this.handleContentTypeApplicationZip = false
        // whether fees should be summed by currency code
        this.reduceFees = true
        // do not delete this line, it is needed for users to be able to define their own fetchImplementation
        this.fetchImplementation = defaultFetch
        this.validateServerSsl = true
        this.validateClientSsl = false
        // default property values
        this.timeout       = 10000 // milliseconds
        this.verbose       = false
        this.debug         = false
        this.userAgent     = undefined
        this.twofa         = undefined // two-factor authentication (2FA)
        // default credentials
        this.apiKey        = undefined
        this.secret        = undefined
        this.uid           = undefined
        this.login         = undefined
        this.password      = undefined
        this.privateKey    = undefined // a "0x"-prefixed hexstring private key for a wallet
        this.walletAddress = undefined // a wallet address "0x"-prefixed hexstring
        this.token         = undefined // reserved for HTTP auth in some cases
        // placeholders for cached data
        this.balance      = {}
        this.orderbooks   = {}
        this.tickers      = {}
        this.orders       = undefined
        this.trades       = {}
        this.transactions = {}
        this.ohlcvs       = {}
        this.myTrades     = undefined
        this.positions    = {}
        // web3 and cryptography flags
        this.requiresWeb3 = false
        this.requiresEddsa = false
        this.precision = {}
        // response handling flags and properties
        this.enableLastJsonResponse = true
        this.enableLastHttpResponse = true
        this.enableLastResponseHeaders = true
        this.last_http_response    = undefined
        this.last_json_response    = undefined
        this.last_response_headers = undefined
        // camelCase and snake_notation support
        const unCamelCaseProperties = (obj = this) => {
            if (obj !== null) {
                const ownPropertyNames = Object.getOwnPropertyNames (obj)
                for (let i = 0; i < ownPropertyNames.length; i++) {
                    const k = ownPropertyNames[i]
                    this[unCamelCase (k)] = this[k]
                }
                unCamelCaseProperties (Object.getPrototypeOf (obj))
            }
        }
        unCamelCaseProperties ()
        // merge constructor overrides to this instance
        const configEntries = Object.entries (this.describe ()).concat (Object.entries (userConfig))
        for (let i = 0; i < configEntries.length; i++) {
            const [property, value] = configEntries[i]
            if (value && Object.getPrototypeOf (value) === Object.prototype) {
                this[property] = deepExtend (this[property], value)
            } else {
                this[property] = value
            }
        }
        // http client options
        const agentOptions = {
            'keepAlive': true,
        }
        // ssl options
        if (!this.validateServerSsl) {
            agentOptions['rejectUnauthorized'] = false;
        }
        // js-specific http options
        if (!this.httpAgent && defaultFetch.http && isNode) {
            this.httpAgent = new defaultFetch.http.Agent (agentOptions)
        }
        if (!this.httpsAgent && defaultFetch.https && isNode) {
            this.httpsAgent = new defaultFetch.https.Agent (agentOptions)
        }
        // generate old metainfo interface
        const hasKeys = Object.keys (this.has)
        for (let i = 0; i < hasKeys.length; i++) {
            const k = hasKeys[i]
            this['has' + capitalize (k)] = !!this.has[k] // converts 'emulated' to true
        }
        // generate implicit api
        if (this.api) {
            this.defineRestApi (this.api, 'request')
        }
        // init the request rate limiter
        this.initRestRateLimiter ()
        // init predefined markets if any
        if (this.markets) {
            this.setMarkets (this.markets)
        }
    }

    defaults () {
        return { /* override me */ }
    }

    nonce () {
        return this.seconds ()
    }

    encodeURIComponent (...args) {
        return encodeURIComponent (...args)
    }

    checkRequiredVersion (requiredVersion, error = true) {
        let result = true
        const [ major1, minor1, patch1 ] = requiredVersion.split ('.')
            , [ major2, minor2, patch2 ] = Exchange.ccxtVersion.split ('.')
            , intMajor1 = parseInt (major1)
            , intMinor1 = parseInt (minor1)
            , intPatch1 = parseInt (patch1)
            , intMajor2 = parseInt (major2)
            , intMinor2 = parseInt (minor2)
            , intPatch2 = parseInt (patch2)
        if (intMajor1 > intMajor2) {
            result = false
        }
        if (intMajor1 === intMajor2) {
            if (intMinor1 > intMinor2) {
                result = false
            } else if (intMinor1 === intMinor2 && intPatch1 > intPatch2) {
                result = false
            }
        }
        if (!result) {
            if (error) {
                throw new NotSupported ('Your current version of CCXT is ' + Exchange.ccxtVersion + ', a newer version ' + requiredVersion + ' is required, please, upgrade your version of CCXT')
            } else {
                return error
            }
        }
        return result
    }

    checkRequiredCredentials (error = true) {
        const keys = Object.keys (this.requiredCredentials)
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            if (this.requiredCredentials[key] && !this[key]) {
                if (error) {
                    throw new AuthenticationError (this.id + ' requires `' + key + '` credential')
                } else {
                    return error
                }
            }
        }
        return true
    }

    checkAddress (address) {
        if (address === undefined) {
            throw new InvalidAddress (this.id + ' address is undefined')
        }
        // check the address is not the same letter like 'aaaaa' nor too short nor has a space
        if ((unique (address).length === 1) || address.length < this.minFundingAddressLength || address.includes (' ')) {
            throw new InvalidAddress (this.id + ' address is invalid or has less than ' + this.minFundingAddressLength.toString () + ' characters: "' + this.json (address) + '"')
        }
        return address
    }

    initRestRateLimiter () {
        if (this.rateLimit === undefined) {
            throw new Error (this.id + '.rateLimit property is not configured')
        }
        this.tokenBucket = this.extend ({
            delay: 0.001,
            capacity: 1,
            cost: 1,
            maxCapacity: 1000,
            refillRate: (this.rateLimit > 0) ? 1 / this.rateLimit : Number.MAX_VALUE
        }, this.tokenBucket)
        this.throttle = throttle (this.tokenBucket)
        this.executeRestRequest = (url, method = 'GET', headers = undefined, body = undefined) => {
            // fetchImplementation cannot be called on this. in browsers:
            // TypeError Failed to execute 'fetch' on 'Window': Illegal invocation
            const fetchImplementation = this.fetchImplementation
            const params = { method, headers, body, timeout: this.timeout }
            if (this.agent) {
                params['agent'] = this.agent
            } else if (this.httpAgent && url.indexOf ('http://') === 0) {
                params['agent'] = this.httpAgent
            } else if (this.httpsAgent && url.indexOf ('https://') === 0) {
                params['agent'] = this.httpsAgent
            }
            const promise =
                fetchImplementation (url, this.extend (params, this.fetchOptions))
                    .catch ((e) => {
                        if (isNode) {
                            throw new ExchangeNotAvailable ([ this.id, method, url, e.type, e.message ].join (' '))
                        }
                        throw e // rethrow all unknown errors
                    })
                    .then ((response) => this.handleRestResponse (response, url, method, headers, body))
            return timeout (this.timeout, promise).catch ((e) => {
                if (e instanceof TimedOut) {
                    throw new RequestTimeout (this.id + ' ' + method + ' ' + url + ' request timed out (' + this.timeout + ' ms)')
                }
                throw e
            })
        }
    }

    setSandboxMode (enabled) {
        if (!!enabled) { // eslint-disable-line no-extra-boolean-cast
            if ('test' in this.urls) {
                if (typeof this.urls['api'] === 'string') {
                    this.urls['apiBackup'] = this.urls['api']
                    this.urls['api'] = this.urls['test']
                } else {
                    this.urls['apiBackup'] = clone (this.urls['api'])
                    this.urls['api'] = clone (this.urls['test'])
                }
            } else {
                throw new NotSupported (this.id + ' does not have a sandbox URL')
            }
        } else if ('apiBackup' in this.urls) {
            if (typeof this.urls['api'] === 'string') {
                this.urls['api'] = this.urls['apiBackup']
            } else {
                this.urls['api'] = clone (this.urls['apiBackup'])
            }
        }
    }

    defineRestApiEndpoint (methodName, uppercaseMethod, lowercaseMethod, camelcaseMethod, path, paths, config = {}) {
        const splitPath = path.split (/[^a-zA-Z0-9]/)
        const camelcaseSuffix  = splitPath.map (this.capitalize).join ('')
        const underscoreSuffix = splitPath.map ((x) => x.trim ().toLowerCase ()).filter ((x) => x.length > 0).join ('_')
        const camelcasePrefix = [ paths[0] ].concat (paths.slice (1).map (this.capitalize)).join ('')
        const underscorePrefix = [ paths[0] ].concat (paths.slice (1).map ((x) => x.trim ()).filter ((x) => x.length > 0)).join ('_')
        const camelcase  = camelcasePrefix + camelcaseMethod + this.capitalize (camelcaseSuffix)
        const underscore = underscorePrefix + '_' + lowercaseMethod + '_' + underscoreSuffix
        const typeArgument = (paths.length > 1) ? paths : paths[0]
        // handle call costs here
        const partial = async (params = {}, context = {}) => this[methodName] (path, typeArgument, uppercaseMethod, params, undefined, undefined, config, context)
        // const partial = async (params) => this[methodName] (path, typeArgument, uppercaseMethod, params || {})
        this[camelcase]  = partial
        this[underscore] = partial
    }

    defineRestApi (api, methodName, paths = []) {
        const keys = Object.keys (api)
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            const value = api[key]
            const uppercaseMethod = key.toUpperCase ()
            const lowercaseMethod = key.toLowerCase ()
            const camelcaseMethod = this.capitalize (lowercaseMethod)
            if (Array.isArray (value)) {
                for (let k = 0; k < value.length; k++) {
                    const path = value[k].trim ()
                    this.defineRestApiEndpoint (methodName, uppercaseMethod, lowercaseMethod, camelcaseMethod, path, paths)
                }
            // the options HTTP method conflicts with the 'options' API url path
            // } else if (key.match (/^(?:get|post|put|delete|options|head|patch)$/i)) {
            } else if (key.match (/^(?:get|post|put|delete|head|patch)$/i)) {
                const endpoints = Object.keys (value);
                for (let j = 0; j < endpoints.length; j++) {
                    const endpoint = endpoints[j]
                    const path = endpoint.trim ()
                    const config = value[endpoint]
                    if (typeof config === 'object') {
                        this.defineRestApiEndpoint (methodName, uppercaseMethod, lowercaseMethod, camelcaseMethod, path, paths, config)
                    } else if (typeof config === 'number') {
                        this.defineRestApiEndpoint (methodName, uppercaseMethod, lowercaseMethod, camelcaseMethod, path, paths, { cost: config })
                    } else {
                        throw new NotSupported (this.id + ' defineRestApi() API format is not supported, API leafs must strings, objects or numbers');
                    }
                }
            } else {
                this.defineRestApi (value, methodName, paths.concat ([ key ]))
            }
        }
    }

    log (... args) {
        console.log (... args)
    }

    setHeaders (headers) {
        return headers;
    }

    fetch (url, method = 'GET', headers = undefined, body = undefined) {
        if (isNode && this.userAgent) {
            if (typeof this.userAgent === 'string') {
                headers = extend ({ 'User-Agent': this.userAgent }, headers)
            } else if ((typeof this.userAgent === 'object') && ('User-Agent' in this.userAgent)) {
                headers = extend (this.userAgent, headers)
            }
        }
        if (typeof this.proxy === 'function') {
            url = this.proxy (url)
            if (isNode) {
                headers = extend ({ 'Origin': this.origin }, headers)
            }
        } else if (typeof this.proxy === 'string') {
            if (this.proxy.length && isNode) {
                headers = extend ({ 'Origin': this.origin }, headers)
            }
            url = this.proxy + url
        }
        headers = extend (this.headers, headers)
        headers = this.setHeaders (headers)
        if (this.verbose) {
            this.log ("fetch Request:\n", this.id, method, url, "\nRequestHeaders:\n", headers, "\nRequestBody:\n", body, "\n")
        }
        return this.executeRestRequest (url, method, headers, body)
    }

    async fetch2 (path, type = 'public', method = 'GET', params = {}, headers = undefined, body = undefined, config = {}, context = {}) {
        if (this.enableRateLimit) {
            const cost = this.calculateRateLimiterCost (type, method, path, params, config, context)
            await this.throttle (cost)
        }
        const request = this.sign (path, type, method, params, headers, body)
        return this.fetch (request.url, request.method, request.headers, request.body)
    }

    request (path, type = 'public', method = 'GET', params = {}, headers = undefined, body = undefined, config = {}, context = {}) {
        return this.fetch2 (path, type, method, params, headers, body, config, context)
    }

    parseJson (jsonString) {
        try {
            if (this.isJsonEncodedObject (jsonString)) {
                return JSON.parse (this.onJsonResponse (jsonString))
            }
        } catch (e) {
            // SyntaxError
            return undefined
        }
    }

    handleHttpStatusCode (code, reason, url, method, body) {
        const codeAsString = code.toString ()
        if (codeAsString in this.httpExceptions) {
            const ErrorClass = this.httpExceptions[codeAsString]
            throw new ErrorClass ([ this.id, method, url, code, reason, body ].join (' '))
        }
    }

    getResponseHeaders (response) {
        const result = {}
        response.headers.forEach ((value, key) => {
            key = key.split ('-').map ((word) => capitalize (word)).join ('-')
            result[key] = value
        })
        return result
    }

    handleRestResponse (response, url, method = 'GET', requestHeaders = undefined, requestBody = undefined) {
        const responseHeaders = this.getResponseHeaders (response)
        if (this.handleContentTypeApplicationZip && (responseHeaders['Content-Type'] === 'application/zip')) {
            const responseBuffer = response.buffer ();
            if (this.enableLastResponseHeaders) {
                this.last_response_headers = responseHeaders
            }
            if (this.enableLastHttpResponse) {
                this.last_http_response = responseBuffer
            }
            if (this.verbose) {
                this.log ("handleRestResponse:\n", this.id, method, url, response.status, response.statusText, "\nResponseHeaders:\n", responseHeaders, "ZIP redacted", "\n")
            }
            // no error handler needed, because it would not be a zip response in case of an error
            return responseBuffer;
        }
        return response.text ().then ((responseBody) => {
            const bodyText = this.onRestResponse (response.status, response.statusText, url, method, responseHeaders, responseBody, requestHeaders, requestBody);
            const json = this.parseJson (bodyText)
            if (this.enableLastResponseHeaders) {
                this.last_response_headers = responseHeaders
            }
            if (this.enableLastHttpResponse) {
                this.last_http_response = responseBody
            }
            if (this.enableLastJsonResponse) {
                this.last_json_response = json
            }
            if (this.verbose) {
                this.log ("handleRestResponse:\n", this.id, method, url, response.status, response.statusText, "\nResponseHeaders:\n", responseHeaders, "\nResponseBody:\n", responseBody, "\n")
            }
            const skipFurtherErrorHandling = this.handleErrors (response.status, response.statusText, url, method, responseHeaders, responseBody, json, requestHeaders, requestBody)
            if (!skipFurtherErrorHandling) {
                this.handleHttpStatusCode (response.status, response.statusText, url, method, responseBody)
            }
            return json || responseBody
        })
    }

    onRestResponse (statusCode, statusText, url, method, responseHeaders, responseBody, requestHeaders, requestBody) {
        return responseBody.trim ()
    }

    onJsonResponse (responseBody) {
        return this.quoteJsonNumbers ? responseBody.replace (/":([+.0-9eE-]+)([,}])/g, '":"$1"$2') : responseBody;
    }

    setMarkets (markets, currencies = undefined) {
        const values = Object.values (markets).map ((market) => deepExtend ({
            'id': undefined,
            'symbol': undefined,
            'base': undefined,
            'quote': undefined,
            'baseId': undefined,
            'quoteId': undefined,
            'active': undefined,
            'type': undefined,
            'linear': undefined,
            'inverse': undefined,
            'spot': false,
            'swap': false,
            'future': false,
            'option': false,
            'margin': false,
            'contract': false,
            'contractSize': undefined,
            'expiry': undefined,
            'expiryDatetime': undefined,
            'optionType': undefined,
            'strike': undefined,
            'settle': undefined,
            'settleId': undefined,
            'precision': this.precision,
            'limits': this.limits,
            'info': undefined,
        }, this.fees['trading'], market))
        this.markets = indexBy (values, 'symbol')
        this.markets_by_id = indexBy (markets, 'id')
        this.symbols = Object.keys (this.markets).sort ()
        this.ids = Object.keys (this.markets_by_id).sort ()
        if (currencies) {
            this.currencies = deepExtend (this.currencies, currencies)
        } else {
            let baseCurrencies =
                values.filter ((market) => 'base' in market)
                    .map ((market) => ({
                        id: market.baseId || market.base,
                        numericId: (market.baseNumericId !== undefined) ? market.baseNumericId : undefined,
                        code: market.base,
                        precision: market.precision ? (market.precision.base || market.precision.amount) : 8,
                    }))
            let quoteCurrencies =
                values.filter ((market) => 'quote' in market)
                    .map ((market) => ({
                        id: market.quoteId || market.quote,
                        numericId: (market.quoteNumericId !== undefined) ? market.quoteNumericId : undefined,
                        code: market.quote,
                        precision: market.precision ? (market.precision.quote || market.precision.price) : 8,
                    }))
            baseCurrencies = sortBy (baseCurrencies, 'code')
            quoteCurrencies = sortBy (quoteCurrencies, 'code')
            this.baseCurrencies = indexBy (baseCurrencies, 'code')
            this.quoteCurrencies = indexBy (quoteCurrencies, 'code')
            const allCurrencies = baseCurrencies.concat (quoteCurrencies)
            const groupedCurrencies = groupBy (allCurrencies, 'code')
            const currencies = Object.keys (groupedCurrencies).map ((code) =>
                groupedCurrencies[code].reduce ((previous, current) => // eslint-disable-line implicit-arrow-linebreak
                    ((previous.precision > current.precision) ? previous : current), groupedCurrencies[code][0])) // eslint-disable-line implicit-arrow-linebreak
            const sortedCurrencies = sortBy (flatten (currencies), 'code')
            this.currencies = deepExtend (this.currencies, indexBy (sortedCurrencies, 'code'))
        }
        this.currencies_by_id = indexBy (this.currencies, 'id')
        this.codes = Object.keys (this.currencies).sort ()
        return this.markets
    }

    async loadMarketsHelper (reload = false, params = {}) {
        if (!reload && this.markets) {
            if (!this.markets_by_id) {
                return this.setMarkets (this.markets)
            }
            return this.markets
        }
        let currencies = undefined
        // only call if exchange API provides endpoint (true), thus avoid emulated versions ('emulated')
        if (this.has.fetchCurrencies === true) {
            currencies = await this.fetchCurrencies ()
        }
        const markets = await this.fetchMarkets (params)
        return this.setMarkets (markets, currencies)
    }

    async fetchPermissions (params = {}) {
        throw new NotSupported (this.id + ' fetchPermissions() is not supported yet')
    }

    loadMarkets (reload = false, params = {}) {
        // this method is async, it returns a promise
        if ((reload && !this.reloadingMarkets) || !this.marketsLoading) {
            this.reloadingMarkets = true
            this.marketsLoading = this.loadMarketsHelper (reload, params).then ((resolved) => {
                this.reloadingMarkets = false
                return resolved
            }, (error) => {
                this.reloadingMarkets = false
                throw error
            })
        }
        return this.marketsLoading
    }

    async loadAccounts (reload = false, params = {}) {
        if (reload) {
            this.accounts = await this.fetchAccounts (params)
        } else {
            if (this.accounts) {
                return this.accounts
            } else {
                this.accounts = await this.fetchAccounts (params)
            }
        }
        this.accountsById = this.indexBy (this.accounts, 'id')
        return this.accounts
    }

    fetchBidsAsks (symbols = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchBidsAsks() is not supported yet')
    }

    async fetchOHLCVC (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        if (!this.has['fetchTrades']) {
            throw new NotSupported (this.id + ' fetchOHLCV() is not supported yet')
        }
        await this.loadMarkets ()
        const trades = await this.fetchTrades (symbol, since, limit, params)
        const ohlcvc = buildOHLCVC (trades, timeframe, since, limit)
        return ohlcvc
    }

    async fetchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        if (!this.has['fetchTrades']) {
            throw new NotSupported (this.id + ' fetchOHLCV() is not supported yet')
        }
        await this.loadMarkets ()
        const trades = await this.fetchTrades (symbol, since, limit, params)
        const ohlcvc = buildOHLCVC (trades, timeframe, since, limit)
        return ohlcvc.map ((c) => c.slice (0, -1))
    }

    parseTradingViewOHLCV (ohlcvs, market = undefined, timeframe = '1m', since = undefined, limit = undefined) {
        const result = this.convertTradingViewToOHLCV (ohlcvs)
        return this.parseOHLCVs (result, market, timeframe, since, limit)
    }

    convertTradingViewToOHLCV (ohlcvs, t = 't', o = 'o', h = 'h', l = 'l', c = 'c', v = 'v', ms = false) {
        const result = [];
        for (let i = 0; i < ohlcvs[t].length; i++) {
            result.push ([
                ms ? ohlcvs[t][i] : (ohlcvs[t][i] * 1000),
                ohlcvs[o][i],
                ohlcvs[h][i],
                ohlcvs[l][i],
                ohlcvs[c][i],
                ohlcvs[v][i],
            ])
        }
        return result
    }

    convertOHLCVToTradingView (ohlcvs, t = 't', o = 'o', h = 'h', l = 'l', c = 'c', v = 'v', ms = false) {
        const result = {}
        result[t] = []
        result[o] = []
        result[h] = []
        result[l] = []
        result[c] = []
        result[v] = []
        for (let i = 0; i < ohlcvs.length; i++) {
            result[t].push (ms ? ohlcvs[i][0] : parseInt (ohlcvs[i][0] / 1000))
            result[o].push (ohlcvs[i][1])
            result[h].push (ohlcvs[i][2])
            result[l].push (ohlcvs[i][3])
            result[c].push (ohlcvs[i][4])
            result[v].push (ohlcvs[i][5])
        }
        return result
    }

    fetchCurrencies (params = {}) {
        // markets are returned as a list
        // currencies are returned as a dict
        // this is for historical reasons
        // and may be changed for consistency later
        return new Promise ((resolve, reject) => resolve (this.currencies));
    }

    fetchMarkets (params = {}) {
        // markets are returned as a list
        // currencies are returned as a dict
        // this is for historical reasons
        // and may be changed for consistency later
        return new Promise ((resolve, reject) => resolve (Object.values (this.markets)))
    }

    marketId (symbol) {
        const market = this.market (symbol)
        return (market !== undefined ? market['id'] : symbol)
    }

    marketIds (symbols) {
        return symbols.map ((symbol) => this.marketId (symbol))
    }

    marketSymbols (symbols) {
        return (symbols === undefined) ? symbols : symbols.map ((symbol) => this.symbol (symbol))
    }

    symbol (symbol) {
        return this.market (symbol).symbol || symbol
    }

    resolvePath (path, params) {
        return [
            this.implodeParams (path, params),
            this.omit (params, this.extractParams (path))
        ];
    }

    parseBidAsk (bidask, priceKey = 0, amountKey = 1) {
        const price = this.safeNumber (bidask, priceKey)
        const amount = this.safeNumber (bidask, amountKey)
        return [ price, amount ]
    }

    parseBidsAsks (bidasks, priceKey = 0, amountKey = 1) {
        return Object.values (bidasks || []).map ((bidask) => this.parseBidAsk (bidask, priceKey, amountKey))
    }

    async fetchL2OrderBook (symbol, limit = undefined, params = {}) {
        const orderbook = await this.fetchOrderBook (symbol, limit, params)
        return extend (orderbook, {
            'bids': sortBy (aggregate (orderbook.bids), 0, true),
            'asks': sortBy (aggregate (orderbook.asks), 0),
        })
    }

    parseOrderBook (orderbook, symbol, timestamp = undefined, bidsKey = 'bids', asksKey = 'asks', priceKey = 0, amountKey = 1) {
        return {
            'symbol': symbol,
            'bids': sortBy ((bidsKey in orderbook) ? this.parseBidsAsks (orderbook[bidsKey], priceKey, amountKey) : [], 0, true),
            'asks': sortBy ((asksKey in orderbook) ? this.parseBidsAsks (orderbook[asksKey], priceKey, amountKey) : [], 0),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'nonce': undefined,
        }
    }

    safeBalance (balance) {
        const codes = Object.keys (this.omit (balance, [ 'info', 'timestamp', 'datetime', 'free', 'used', 'total' ]));
        balance['free'] = {}
        balance['used'] = {}
        balance['total'] = {}
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i]
            if (balance[code].total === undefined) {
                if (balance[code].free !== undefined && balance[code].used !== undefined) {
                    balance[code].total = Precise.stringAdd (balance[code].free, balance[code].used)
                }
            }
            if (balance[code].free === undefined) {
                if (balance[code].total !== undefined && balance[code].used !== undefined) {
                    balance[code].free = Precise.stringSub (balance[code].total, balance[code].used)
                }
            }
            if (balance[code].used === undefined) {
                if (balance[code].total !== undefined && balance[code].free !== undefined) {
                    balance[code].used = Precise.stringSub (balance[code].total, balance[code].free)
                }
            }
            balance[code].free = this.parseNumber (balance[code].free)
            balance[code].used = this.parseNumber (balance[code].used)
            balance[code].total = this.parseNumber (balance[code].total)
            balance.free[code] = balance[code].free
            balance.used[code] = balance[code].used
            balance.total[code] = balance[code].total
        }
        return balance
    }

    async loadTradingLimits (symbols = undefined, reload = false, params = {}) {
        if (this.has['fetchTradingLimits']) {
            if (reload || !('limitsLoaded' in this.options)) {
                const response = await this.fetchTradingLimits (symbols);
                for (let i = 0; i < symbols.length; i++) {
                    const symbol = symbols[i];
                    this.markets[symbol] = this.deepExtend (this.markets[symbol], response[symbol]);
                }
                this.options['limitsLoaded'] = this.milliseconds ();
            }
        }
        return this.markets;
    }

    filterBySinceLimit (array, since = undefined, limit = undefined, key = 'timestamp', tail = false) {
        const sinceIsDefined = (since !== undefined && since !== null)
        if (sinceIsDefined) {
            array = array.filter ((entry) => entry[key] >= since)
        }
        if (limit !== undefined && limit !== null) {
            array = tail ? array.slice (-limit) : array.slice (0, limit)
        }
        return array
    }

    filterByValueSinceLimit (array, field, value = undefined, since = undefined, limit = undefined, key = 'timestamp', tail = false) {
        const valueIsDefined = value !== undefined && value !== null
        const sinceIsDefined = since !== undefined && since !== null
        // single-pass filter for both symbol and since
        if (valueIsDefined || sinceIsDefined) {
            array = array.filter ((entry) =>
                ((valueIsDefined ? (entry[field] === value) : true) &&
                 (sinceIsDefined ? (entry[key] >= since) : true)))
        }
        if (limit !== undefined && limit !== null) {
            array = tail ? array.slice (-limit) : array.slice (0, limit)
        }
        return array
    }

    filterByArray (objects, key, values = undefined, indexed = true) {
        objects = Object.values (objects)
        // return all of them if no values were passed
        if (values === undefined || values === null) {
            return indexed ? indexBy (objects, key) : objects
        }
        const result = []
        for (let i = 0; i < objects.length; i++) {
            if (values.includes (objects[i][key])) {
                result.push (objects[i])
            }
        }
        return indexed ? indexBy (result, key) : result
    }

    safeTicker (ticker, market = undefined) {
        let open = this.safeValue (ticker, 'open');
        let close = this.safeValue (ticker, 'close');
        let last = this.safeValue (ticker, 'last');
        let change = this.safeValue (ticker, 'change');
        let percentage = this.safeValue (ticker, 'percentage');
        let average = this.safeValue (ticker, 'average');
        let vwap = this.safeValue (ticker, 'vwap');
        const baseVolume = this.safeValue (ticker, 'baseVolume');
        const quoteVolume = this.safeValue (ticker, 'quoteVolume');
        if (vwap === undefined) {
            vwap = Precise.stringDiv (quoteVolume, baseVolume);
        }
        if ((last !== undefined) && (close === undefined)) {
            close = last;
        } else if ((last === undefined) && (close !== undefined)) {
            last = close;
        }
        if ((last !== undefined) && (open !== undefined)) {
            if (change === undefined) {
                change = Precise.stringSub (last, open);
            }
            if (average === undefined) {
                average = Precise.stringDiv (Precise.stringAdd (last, open), '2');
            }
        }
        if ((percentage === undefined) && (change !== undefined) && (open !== undefined) && (Precise.stringGt (open, '0'))) {
            percentage = Precise.stringMul (Precise.stringDiv (change, open), '100');
        }
        if ((change === undefined) && (percentage !== undefined) && (open !== undefined)) {
            change = Precise.stringDiv (Precise.stringMul (percentage, open), '100');
        }
        if ((open === undefined) && (last !== undefined) && (change !== undefined)) {
            open = Precise.stringSub (last, change);
        }
        // timestamp and symbol operations don't belong in safeTicker
        // they should be done in the derived classes
        return this.extend (ticker, {
            'bid': this.safeNumber (ticker, 'bid'),
            'bidVolume': this.safeNumber (ticker, 'bidVolume'),
            'ask': this.safeNumber (ticker, 'ask'),
            'askVolume': this.safeNumber (ticker, 'askVolume'),
            'high': this.safeNumber (ticker, 'high'),
            'low': this.safeNumber (ticker, 'low'),
            'open': this.parseNumber (open),
            'close': this.parseNumber (close),
            'last': this.parseNumber (last),
            'change': this.parseNumber (change),
            'percentage': this.parseNumber (percentage),
            'average': this.parseNumber (average),
            'vwap': this.parseNumber (vwap),
            'baseVolume': this.parseNumber (baseVolume),
            'quoteVolume': this.parseNumber (quoteVolume),
            'previousClose': this.safeNumber (ticker, 'previousClose'),
        });
    }

    parseAccounts (accounts, params = {}) {
        const array = Object.values (accounts || [])
        return array.map ((account) => this.extend (this.parseAccount (account, undefined), params))
    }

    parseTickers (tickers, symbols = undefined, params = {}) {
        const result = [];
        const values = Object.values (tickers || []);
        for (let i = 0; i < values.length; i++) {
            result.push (this.extend (this.parseTicker (values[i]), params));
        }
        return this.filterByArray (result, 'symbol', symbols);
    }

    parseDepositAddresses (addresses, codes = undefined, indexed = true, params = {}) {
        let result = [];
        for (let i = 0; i < addresses.length; i++) {
            const address = this.extend (this.parseDepositAddress (addresses[i]), params);
            result.push (address);
        }
        if (codes) {
            result = this.filterByArray (result, 'currency', codes, false);
        }
        return indexed ? this.indexBy (result, 'currency') : result;
    }

    parseTrades (trades, market = undefined, since = undefined, limit = undefined, params = {}) {
        let result = Object.values (trades || []).map ((trade) => this.merge (this.parseTrade (trade, market), params))
        result = sortBy2 (result, 'timestamp', 'id')
        const symbol = (market !== undefined) ? market['symbol'] : undefined
        const tail = since === undefined
        return this.filterBySymbolSinceLimit (result, symbol, since, limit, tail)
    }

    parseTransactions (transactions, currency = undefined, since = undefined, limit = undefined, params = {}) {
        let result = Object.values (transactions || []).map ((transaction) => this.extend (this.parseTransaction (transaction, currency), params))
        result = this.sortBy (result, 'timestamp');
        const code = (currency !== undefined) ? currency['code'] : undefined;
        const tail = since === undefined;
        return this.filterByCurrencySinceLimit (result, code, since, limit, tail);
    }

    parseTransfers (transfers, currency = undefined, since = undefined, limit = undefined, params = {}) {
        let result = Object.values (transfers || []).map ((transfer) => this.extend (this.parseTransfer (transfer, currency), params))
        result = this.sortBy (result, 'timestamp');
        const code = (currency !== undefined) ? currency['code'] : undefined;
        const tail = since === undefined;
        return this.filterByCurrencySinceLimit (result, code, since, limit, tail);
    }

    parseLedger (data, currency = undefined, since = undefined, limit = undefined, params = {}) {
        let result = [];
        const array = Object.values (data || []);
        for (let i = 0; i < array.length; i++) {
            const itemOrItems = this.parseLedgerEntry (array[i], currency);
            if (Array.isArray (itemOrItems)) {
                for (let j = 0; j < itemOrItems.length; j++) {
                    result.push (this.extend (itemOrItems[j], params));
                }
            } else {
                result.push (this.extend (itemOrItems, params));
            }
        }
        result = this.sortBy (result, 'timestamp');
        const code = (currency !== undefined) ? currency['code'] : undefined;
        const tail = since === undefined;
        return this.filterByCurrencySinceLimit (result, code, since, limit, tail);
    }

    safeLedgerEntry (entry, currency = undefined) {
        currency = this.safeCurrency (undefined, currency);
        let direction = this.safeString (entry, 'direction');
        let before = this.safeString (entry, 'before');
        let after = this.safeString (entry, 'after');
        let amount = this.safeString (entry, 'amount');
        let fee = this.safeString (entry, 'fee');
        if (amount !== undefined && fee !== undefined) {
            if (before === undefined && after !== undefined) {
                const amountAndFee = Precise.stringAdd (amount, fee);
                before = Precise.stringSub (after, amountAndFee);
            } else if (before !== undefined && after === undefined) {
                const amountAndFee = Precise.stringAdd (amount, fee);
                after = Precise.stringAdd (before, amountAndFee);
            }
        }
        if (before !== undefined && after !== undefined) {
            if (direction === undefined) {
                if (Precise.stringGt (before, after)) {
                    direction = 'out';
                }
                if (Precise.stringGt (after, before)) {
                    direction = 'in';
                }
            }
            if (amount === undefined && fee !== undefined) {
                const betweenAfterBefore = Precise.stringSub (after, before);
                amount = Precise.stringSub (betweenAfterBefore, fee);
            }
            if (amount !== undefined && fee === undefined) {
                const betweenAfterBefore = Precise.stringSub (after, before);
                fee = Precise.stringSub (betweenAfterBefore, amount);
            }
        }
        return this.extend ({
            'id': undefined,
            'timestamp': undefined,
            'datetime': undefined,
            'direction': undefined,
            'account': undefined,
            'referenceId': undefined,
            'referenceAccount': undefined,
            'type': undefined,
            'currency': currency['code'],
            'amount': amount,
            'before': before,
            'after': after,
            'status': undefined,
            'fee': fee,
            'info': undefined,
        }, entry);
    }

    parseOrders (orders, market = undefined, since = undefined, limit = undefined, params = {}) {
        //
        // the value of orders is either a dict or a list
        //
        // dict
        //
        //     {
        //         'id1': { ... },
        //         'id2': { ... },
        //         'id3': { ... },
        //         ...
        //     }
        //
        // list
        //
        //     [
        //         { 'id': 'id1', ... },
        //         { 'id': 'id2', ... },
        //         { 'id': 'id3', ... },
        //         ...
        //     ]
        //
        let result = Array.isArray (orders) ?
            Object.values (orders).map ((order) => this.extend (this.parseOrder (order, market), params)) :
            Object.entries (orders).map (([ id, order ]) => this.extend (this.parseOrder (this.extend ({ 'id': id }, order), market), params))
        result = sortBy (result, 'timestamp')
        const symbol = (market !== undefined) ? market['symbol'] : undefined
        const tail = since === undefined
        return this.filterBySymbolSinceLimit (result, symbol, since, limit, tail)
    }

    safeCurrency (currencyId, currency = undefined) {
        if ((currencyId === undefined) && (currency !== undefined)) {
            return currency
        }
        if ((this.currencies_by_id !== undefined) && (currencyId in this.currencies_by_id)) {
            return this.currencies_by_id[currencyId]
        }
        return {
            'id': currencyId,
            'code': (currencyId === undefined) ? currencyId : this.commonCurrencyCode (currencyId.toUpperCase ()),
        }
    }

    safeMarket (marketId, market = undefined, delimiter = undefined) {
        if (marketId !== undefined) {
            if (this.markets_by_id !== undefined && marketId in this.markets_by_id) {
                market = this.markets_by_id[marketId]
            } else if (delimiter !== undefined) {
                const parts = marketId.split (delimiter)
                if (parts.length === 2) {
                    const baseId = this.safeString (parts, 0);
                    const quoteId = this.safeString (parts, 1);
                    const base = this.safeCurrencyCode (baseId)
                    const quote = this.safeCurrencyCode (quoteId)
                    const symbol = base + '/' + quote
                    return {
                        'id': marketId,
                        'symbol': symbol,
                        'base': base,
                        'quote': quote,
                        'baseId': baseId,
                        'quoteId': quoteId,
                    }
                } else {
                    return {
                        'id': marketId,
                        'symbol': marketId,
                        'base': undefined,
                        'quote': undefined,
                        'baseId': undefined,
                        'quoteId': undefined,
                    }
                }
            }
        }
        if (market !== undefined) {
            return market
        }
        return {
            'id': marketId,
            'symbol': marketId,
            'base': undefined,
            'quote': undefined,
            'baseId': undefined,
            'quoteId': undefined,
        }
    }

    filterBySymbol (array, symbol = undefined) {
        return ((symbol !== undefined) ? array.filter ((entry) => entry.symbol === symbol) : array)
    }

    parseOHLCV (ohlcv, market = undefined) {
        return Array.isArray (ohlcv) ? ohlcv.slice (0, 6) : ohlcv
    }

    parseOHLCVs (ohlcvs, market = undefined, timeframe = '1m', since = undefined, limit = undefined) {
        // this code is commented out temporarily to catch for exchange-specific errors
        // if (!this.isArray (ohlcvs)) {
        //     throw new ExchangeError (this.id + ' parseOHLCVs() expected an array in the ohlcvs argument, but got ' + typeof ohlcvs);
        // }
        const parsed = ohlcvs.map ((ohlcv) => this.parseOHLCV (ohlcv, market))
        const sorted = this.sortBy (parsed, 0)
        const tail = since === undefined
        return this.filterBySinceLimit (sorted, since, limit, 0, tail)
    }

    editLimitBuyOrder (id, symbol, ...args) {
        return this.editLimitOrder (id, symbol, 'buy', ...args)
    }

    editLimitSellOrder (id, symbol, ...args) {
        return this.editLimitOrder (id, symbol, 'sell', ...args)
    }

    editLimitOrder (id, symbol, ...args) {
        return this.editOrder (id, symbol, 'limit', ...args)
    }

    async editOrder (id, symbol, ...args) {
        await this.cancelOrder (id, symbol);
        return this.createOrder (symbol, ...args)
    }

    calculateFee (symbol, type, side, amount, price, takerOrMaker = 'taker', params = {}) {
        const market = this.markets[symbol];
        const feeSide = this.safeString (market, 'feeSide', 'quote');
        let key = 'quote';
        let cost = undefined;
        if (feeSide === 'quote') {
            // the fee is always in quote currency
            cost = amount * price;
        } else if (feeSide === 'base') {
            // the fee is always in base currency
            cost = amount;
        } else if (feeSide === 'get') {
            // the fee is always in the currency you get
            cost = amount;
            if (side === 'sell') {
                cost *= price;
            } else {
                key = 'base';
            }
        } else if (feeSide === 'give') {
            // the fee is always in the currency you give
            cost = amount;
            if (side === 'buy') {
                cost *= price;
            } else {
                key = 'base';
            }
        }
        const rate = market[takerOrMaker];
        if (cost !== undefined) {
            cost *= rate;
        }
        return {
            'type': takerOrMaker,
            'currency': market[key],
            'rate': rate,
            'cost': cost,
        };
    }

    checkRequiredDependencies () {
        return
    }

    remove0xPrefix (hexData) {
        if (hexData.slice (0, 2) === '0x') {
            return hexData.slice (2)
        } else {
            return hexData
        }
    }

    hashMessage (message) {
        // takes a hex encoded message
        const binaryMessage = this.base16ToBinary (this.remove0xPrefix (message))
        const prefix = this.stringToBinary ('\x19Ethereum Signed Message:\n' + binaryMessage.sigBytes)
        return '0x' + this.hash (this.binaryConcat (prefix, binaryMessage), 'keccak', 'hex')
    }

    signHash (hash, privateKey) {
        const signature = this.ecdsa (hash.slice (-64), privateKey.slice (-64), 'secp256k1', undefined)
        return {
            'r': '0x' + signature['r'],
            's': '0x' + signature['s'],
            'v': 27 + signature['v'],
        }
    }

    signMessage (message, privateKey) {
        return this.signHash (this.hashMessage (message), privateKey.slice (-64))
    }

    signMessageString (message, privateKey) {
        // still takes the input as a hex string
        // same as above but returns a string instead of an object
        const signature = this.signMessage (message, privateKey)
        return signature['r'] + this.remove0xPrefix (signature['s']) + this.binaryToBase16 (this.numberToBE (signature['v']))
    }

    getNetwork (network, code) {
        network = network.toUpperCase ();
        const aliases = {
            'ETHEREUM': 'ETH',
            'ETHER': 'ETH',
            'ERC20': 'ETH',
            'ETH': 'ETH',
            'TRC20': 'TRX',
            'TRON': 'TRX',
            'TRX': 'TRX',
            'BEP20': 'BSC',
            'BSC': 'BSC',
            'HRC20': 'HT',
            'HECO': 'HT',
            'SPL': 'SOL',
            'SOL': 'SOL',
            'TERRA': 'LUNA',
            'LUNA': 'LUNA',
            'POLYGON': 'MATIC',
            'MATIC': 'MATIC',
            'EOS': 'EOS',
            'WAVES': 'WAVES',
            'AVALANCHE': 'AVAX',
            'AVAX': 'AVAX',
            'QTUM': 'QTUM',
            'CHZ': 'CHZ',
            'NEO': 'NEO',
            'ONT': 'ONT',
            'RON': 'RON',
        };
        if (network === code) {
            return network;
        } else if (network in aliases) {
            return aliases[network];
        } else {
            throw new NotSupported (this.id + ' network ' + network + ' is not yet supported');
        }
    }

    reduceFeesByCurrency (fees, string = false) {
        //
        // this function takes a list of fee structures having the following format
        //
        //     string = true
        //
        //     [
        //         { 'currency': 'BTC', 'cost': '0.1' },
        //         { 'currency': 'BTC', 'cost': '0.2'  },
        //         { 'currency': 'BTC', 'cost': '0.2', 'rate': '0.00123' },
        //         { 'currency': 'BTC', 'cost': '0.4', 'rate': '0.00123' },
        //         { 'currency': 'BTC', 'cost': '0.5', 'rate': '0.00456' },
        //         { 'currency': 'USDT', 'cost': '12.3456' },
        //     ]
        //
        //     string = false
        //
        //     [
        //         { 'currency': 'BTC', 'cost': 0.1 },
        //         { 'currency': 'BTC', 'cost': 0.2 },
        //         { 'currency': 'BTC', 'cost': 0.2, 'rate': 0.00123 },
        //         { 'currency': 'BTC', 'cost': 0.4, 'rate': 0.00123 },
        //         { 'currency': 'BTC', 'cost': 0.5, 'rate': 0.00456 },
        //         { 'currency': 'USDT', 'cost': 12.3456 },
        //     ]
        //
        // and returns a reduced fee list, where fees are summed per currency and rate (if any)
        //
        //     string = true
        //
        //     [
        //         { 'currency': 'BTC', 'cost': '0.3'  },
        //         { 'currency': 'BTC', 'cost': '0.6', 'rate': '0.00123' },
        //         { 'currency': 'BTC', 'cost': '0.5', 'rate': '0.00456' },
        //         { 'currency': 'USDT', 'cost': '12.3456' },
        //     ]
        //
        //     string  = false
        //
        //     [
        //         { 'currency': 'BTC', 'cost': 0.3  },
        //         { 'currency': 'BTC', 'cost': 0.6, 'rate': 0.00123 },
        //         { 'currency': 'BTC', 'cost': 0.5, 'rate': 0.00456 },
        //         { 'currency': 'USDT', 'cost': 12.3456 },
        //     ]
        //
        const reduced = {};
        for (let i = 0; i < fees.length; i++) {
            const fee = fees[i];
            const feeCurrencyCode = this.safeString (fee, 'currency');
            if (feeCurrencyCode !== undefined) {
                const rate = this.safeString (fee, 'rate');
                const cost = this.safeValue (fee, 'cost');
                if (!(feeCurrencyCode in reduced)) {
                    reduced[feeCurrencyCode] = {};
                }
                const rateKey = (rate === undefined) ? '' : rate;
                if (rateKey in reduced[feeCurrencyCode]) {
                    if (string) {
                        reduced[feeCurrencyCode][rateKey]['cost'] = Precise.stringAdd (reduced[feeCurrencyCode][rateKey]['cost'], cost);
                    } else {
                        reduced[feeCurrencyCode][rateKey]['cost'] = this.sum (reduced[feeCurrencyCode][rateKey]['cost'], cost);
                    }
                } else {
                    reduced[feeCurrencyCode][rateKey] = {
                        'currency': feeCurrencyCode,
                        'cost': string ? cost : this.parseNumber (cost),
                    };
                    if (rate !== undefined) {
                        reduced[feeCurrencyCode][rateKey]['rate'] = string ? rate : this.parseNumber (rate);
                    }
                }
            }
        }
        let result = [];
        const feeValues = Object.values (reduced);
        for (let i = 0; i < feeValues.length; i++) {
            const reducedFeeValues = Object.values (feeValues[i]);
            result = this.arrayConcat (result, reducedFeeValues);
        }
        return result;
    }

    safeTrade (trade, market = undefined) {
        const amount = this.safeString (trade, 'amount');
        const price = this.safeString (trade, 'price');
        let cost = this.safeString (trade, 'cost');
        if (cost === undefined) {
            // contract trading
            const contractSize = this.safeString (market, 'contractSize');
            let multiplyPrice = price;
            if (contractSize !== undefined) {
                const inverse = this.safeValue (market, 'inverse', false);
                if (inverse) {
                    multiplyPrice = Precise.stringDiv ('1', price);
                }
                multiplyPrice = Precise.stringMul (multiplyPrice, contractSize);
            }
            cost = Precise.stringMul (multiplyPrice, amount);
        }
        const parseFee = this.safeValue (trade, 'fee') === undefined;
        const parseFees = this.safeValue (trade, 'fees') === undefined;
        const shouldParseFees = parseFee || parseFees;
        const fees = this.safeValue (trade, 'fees', []);
        if (shouldParseFees) {
            const tradeFees = this.safeValue (trade, 'fees');
            if (tradeFees !== undefined) {
                for (let j = 0; j < tradeFees.length; j++) {
                    const tradeFee = tradeFees[j];
                    fees.push (this.extend ({}, tradeFee));
                }
            } else {
                const tradeFee = this.safeValue (trade, 'fee');
                if (tradeFee !== undefined) {
                    fees.push (this.extend ({}, tradeFee));
                }
            }
        }
        const fee = this.safeValue (trade, 'fee');
        if (shouldParseFees) {
            const reducedFees = this.reduceFees ? this.reduceFeesByCurrency (fees, true) : fees;
            const reducedLength = reducedFees.length;
            for (let i = 0; i < reducedLength; i++) {
                reducedFees[i]['cost'] = this.safeNumber (reducedFees[i], 'cost');
                if ('rate' in reducedFees[i]) {
                    reducedFees[i]['rate'] = this.safeNumber (reducedFees[i], 'rate');
                }
            }
            if (!parseFee && (reducedLength === 0)) {
                fee['cost'] = this.safeNumber (fee, 'cost');
                if ('rate' in fee) {
                    fee['rate'] = this.safeNumber (fee, 'rate');
                }
                reducedFees.push (fee);
            }
            if (parseFees) {
                trade['fees'] = reducedFees;
            }
            if (parseFee && (reducedLength === 1)) {
                trade['fee'] = reducedFees[0];
            }
            const tradeFee = this.safeValue (trade, 'fee');
            if (tradeFee !== undefined) {
                tradeFee['cost'] = this.safeNumber (tradeFee, 'cost');
                if ('rate' in tradeFee) {
                    tradeFee['rate'] = this.safeNumber (tradeFee, 'rate');
                }
                trade['fee'] = tradeFee;
            }
        }
        trade['amount'] = this.parseNumber (amount);
        trade['price'] = this.parseNumber (price);
        trade['cost'] = this.parseNumber (cost);
        return trade;
    }

    safeOrder (order, market = undefined) {
        // parses numbers as strings
        // it is important pass the trades as unparsed rawTrades
        let amount = this.omitZero (this.safeString (order, 'amount'));
        let remaining = this.safeString (order, 'remaining');
        let filled = this.safeString (order, 'filled');
        let cost = this.safeString (order, 'cost');
        let average = this.omitZero (this.safeString (order, 'average'));
        let price = this.omitZero (this.safeString (order, 'price'));
        let lastTradeTimeTimestamp = this.safeInteger (order, 'lastTradeTimestamp');
        const parseFilled = (filled === undefined);
        const parseCost = (cost === undefined);
        const parseLastTradeTimeTimestamp = (lastTradeTimeTimestamp === undefined);
        const fee = this.safeValue (order, 'fee');
        const parseFee = (fee === undefined);
        const parseFees = this.safeValue (order, 'fees') === undefined;
        const shouldParseFees = parseFee || parseFees;
        const fees = this.safeValue (order, 'fees', []);
        let trades = [];
        if (parseFilled || parseCost || shouldParseFees) {
            const rawTrades = this.safeValue (order, 'trades', trades);
            const oldNumber = this.number;
            // we parse trades as strings here!
            this.number = String;
            trades = this.parseTrades (rawTrades, market, undefined, undefined, {
                'symbol': order['symbol'],
                'side': order['side'],
                'type': order['type'],
                'order': order['id'],
            });
            this.number = oldNumber;
            if (Array.isArray (trades) && trades.length) {
                // move properties that are defined in trades up into the order
                if (order['symbol'] === undefined) {
                    order['symbol'] = trades[0]['symbol'];
                }
                if (order['side'] === undefined) {
                    order['side'] = trades[0]['side'];
                }
                if (order['type'] === undefined) {
                    order['type'] = trades[0]['type'];
                }
                if (order['id'] === undefined) {
                    order['id'] = trades[0]['order'];
                }
                if (parseFilled) {
                    filled = '0';
                }
                if (parseCost) {
                    cost = '0';
                }
                for (let i = 0; i < trades.length; i++) {
                    const trade = trades[i];
                    const tradeAmount = this.safeString (trade, 'amount');
                    if (parseFilled && (tradeAmount !== undefined)) {
                        filled = Precise.stringAdd (filled, tradeAmount);
                    }
                    const tradeCost = this.safeString (trade, 'cost');
                    if (parseCost && (tradeCost !== undefined)) {
                        cost = Precise.stringAdd (cost, tradeCost);
                    }
                    const tradeTimestamp = this.safeValue (trade, 'timestamp');
                    if (parseLastTradeTimeTimestamp && (tradeTimestamp !== undefined)) {
                        if (lastTradeTimeTimestamp === undefined) {
                            lastTradeTimeTimestamp = tradeTimestamp;
                        } else {
                            lastTradeTimeTimestamp = Math.max (lastTradeTimeTimestamp, tradeTimestamp);
                        }
                    }
                    if (shouldParseFees) {
                        const tradeFees = this.safeValue (trade, 'fees');
                        if (tradeFees !== undefined) {
                            for (let j = 0; j < tradeFees.length; j++) {
                                const tradeFee = tradeFees[j];
                                fees.push (this.extend ({}, tradeFee));
                            }
                        } else {
                            const tradeFee = this.safeValue (trade, 'fee');
                            if (tradeFee !== undefined) {
                                fees.push (this.extend ({}, tradeFee));
                            }
                        }
                    }
                }
            }
        }
        if (shouldParseFees) {
            const reducedFees = this.reduceFees ? this.reduceFeesByCurrency (fees, true) : fees;
            const reducedLength = reducedFees.length;
            for (let i = 0; i < reducedLength; i++) {
                reducedFees[i]['cost'] = this.parseNumber (reducedFees[i]['cost']);
                if ('rate' in reducedFees[i]) {
                    reducedFees[i]['rate'] = this.parseNumber (reducedFees[i]['rate'])
                }
            }
            if (!parseFee && (reducedLength === 0)) {
                fee['cost'] = this.safeNumber (fee, 'cost');
                if ('rate' in fee) {
                    fee['rate'] = this.parseNumber (fee['rate'])
                }
                reducedFees.push (fee);
            }
            if (parseFees) {
                order['fees'] = reducedFees;
            }
            if (parseFee && (reducedLength === 1)) {
                order['fee'] = reducedFees[0];
            }
        }
        if (amount === undefined) {
            // ensure amount = filled + remaining
            if (filled !== undefined && remaining !== undefined) {
                amount = Precise.stringAdd (filled, remaining);
            } else if (this.safeString (order, 'status') === 'closed') {
                amount = filled;
            }
        }
        if (filled === undefined) {
            if (amount !== undefined && remaining !== undefined) {
                filled = Precise.stringSub (amount, remaining);
            }
        }
        if (remaining === undefined) {
            if (amount !== undefined && filled !== undefined) {
                remaining = Precise.stringSub (amount, filled);
            }
        }
        // ensure that the average field is calculated correctly
        if (average === undefined) {
            if ((filled !== undefined) && (cost !== undefined) && Precise.stringGt (filled, '0')) {
                average = Precise.stringDiv (cost, filled);
            }
        }
        // also ensure the cost field is calculated correctly
        const costPriceExists = (average !== undefined) || (price !== undefined);
        if (parseCost && (filled !== undefined) && costPriceExists) {
            let multiplyPrice = undefined;
            if (average === undefined) {
                multiplyPrice = price;
            } else {
                multiplyPrice = average;
            }
            // contract trading
            const contractSize = this.safeString (market, 'contractSize');
            if (contractSize !== undefined) {
                const inverse = this.safeValue (market, 'inverse', false);
                if (inverse) {
                    multiplyPrice = Precise.stringDiv ('1', multiplyPrice);
                }
                multiplyPrice = Precise.stringMul (multiplyPrice, contractSize);
            }
            cost = Precise.stringMul (multiplyPrice, filled);
        }
        // support for market orders
        const orderType = this.safeValue (order, 'type');
        const emptyPrice = (price === "market_price") || (price === undefined) || Precise.stringEquals (price, '0');
        if (emptyPrice && (orderType === 'market')) {
            price = average;
        }
        // we have trades with string values at this point so we will mutate them
        for (let i = 0; i < trades.length; i++) {
            const entry = trades[i];
            entry['amount'] = this.safeNumber (entry, 'amount');
            entry['price'] = this.safeNumber (entry, 'price');
            entry['cost'] = this.safeNumber (entry, 'cost');
            const fee = this.safeValue (entry, 'fee', {});
            fee['cost'] = this.safeNumber (fee, 'cost');
            if ('rate' in fee) {
                fee['rate'] = this.safeNumber (fee, 'rate');
            }
            entry['fee'] = fee;
        }
        // timeInForceHandling
        let timeInForce = this.safeString (order, 'timeInForce');
        if (timeInForce === undefined) {
            if (this.safeString (order, 'type') === 'market') {
                timeInForce = 'IOC';
            }
            // allow postOnly override
            if (this.safeValue (order, 'postOnly', false)) {
                timeInForce = 'PO';
            }
        }
        return this.extend (order, {
            'lastTradeTimestamp': lastTradeTimeTimestamp,
            'price': this.parseNumber (price),
            'amount': this.parseNumber (amount),
            'cost': this.parseNumber (cost),
            'average': this.parseNumber (average),
            'filled': this.parseNumber (filled),
            'remaining': this.parseNumber (remaining),
            'timeInForce': timeInForce,
            'trades': trades,
        });
    }

    parseNumber (value, d = undefined) {
        if (value === undefined) {
            return d
        } else {
            try {
                return this.number (value)
            } catch (e) {
                return d
            }
        }
    }

    parseLeverageTiers (response, symbols = undefined, marketIdKey = undefined) {
        // marketIdKey should only be undefined when response is a dictionary
        const tiers = {};
        for (let i = 0; i < response.length; i++) {
            const item = response[i];
            const id = this.safeString (item, marketIdKey);
            const market = this.safeMarket (id);
            const symbol = market['symbol'];
            let symbolsLength = 0;
            if (symbols !== undefined) {
                symbolsLength = symbols.length;
            }
            const contract = this.safeValue (market, 'contract', false);
            if (contract && (symbolsLength === 0 || symbols.includes (symbol))) {
                tiers[symbol] = this.parseMarketLeverageTiers (item, market);
            }
        }
        return tiers;
    }

    checkOrderArguments (market, type, side, amount, price, params) {
        if (price === undefined) {
            if (type === 'limit') {
                  throw new ArgumentsRequired (this.id + ' createOrder() requires a price argument for a limit order');
            }
        }
        if (amount <= 0) {
            throw new ArgumentsRequired (this.id + ' createOrder() amount should be above 0');
        }
    }

    parsePositions (positions, symbols = undefined, params = {}) {
        symbols = this.marketSymbols (symbols);
        const result = Object.values (positions || []).map ((position) => this.merge (this.parsePosition (position), params));
        return this.filterByArray (result, 'symbol', symbols, false);
    }

    safeNumber2 (object, key1, key2, d = undefined) {
        const value = this.safeString2 (object, key1, key2);
        return this.parseNumber (value, d);
    }

    // METHODS BELOW THIS LINE ARE TRANSPILED FROM JAVASCRIPT TO PYTHON AND PHP

    oath () {
        if (this.twofa !== undefined) {
            return this.totp (this.twofa);
        } else {
            throw new ExchangeError (this.id + ' exchange.twofa has not been set for 2FA Two-Factor Authentication');
        }
    }

    async fetchBalance (params = {}) {
        throw new NotSupported (this.id + ' fetchBalance() is not supported yet');
    }

    async fetchPartialBalance (part, params = {}) {
        const balance = await this.fetchBalance (params);
        return balance[part];
    }

    async fetchFreeBalance (params = {}) {
        return await this.fetchPartialBalance ('free', params);
    }

    async fetchUsedBalance (params = {}) {
        return await this.fetchPartialBalance ('used', params);
    }

    async fetchTotalBalance (params = {}) {
        return await this.fetchPartialBalance ('total', params);
    }

    async fetchStatus (params = {}) {
        if (this.has['fetchTime']) {
            const time = await this.fetchTime (params);
            this.status = this.extend (this.status, {
                'updated': time,
            });
        }
        return this.status;
    }

    async fetchFundingFee (code, params = {}) {
        const warnOnFetchFundingFee = this.safeValue (this.options, 'warnOnFetchFundingFee', true);
        if (warnOnFetchFundingFee) {
            throw new NotSupported (this.id + ' fetchFundingFee() method is deprecated, it will be removed in July 2022, please, use fetchTransactionFee() or set exchange.options["warnOnFetchFundingFee"] = false to suppress this warning');
        }
        return this.fetchTransactionFee (code, params);
    }

    async fetchFundingFees (codes = undefined, params = {}) {
        const warnOnFetchFundingFees = this.safeValue (this.options, 'warnOnFetchFundingFees', true);
        if (warnOnFetchFundingFees) {
            throw new NotSupported (this.id + ' fetchFundingFees() method is deprecated, it will be removed in July 2022. Please, use fetchTransactionFees() or set exchange.options["warnOnFetchFundingFees"] = false to suppress this warning');
        }
        return this.fetchTransactionFees (codes, params);
    }

    async fetchTransactionFee (code, params = {}) {
        if (!this.has['fetchTransactionFees']) {
            throw new NotSupported (this.id + ' fetchTransactionFee() is not supported yet');
        }
        return this.fetchTransactionFees ([code], params);
    }

    async fetchTransactionFees (codes = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchTransactionFees() is not supported yet');
    }

    getSupportedMapping (key, mapping = {}) {
        if (key in mapping) {
            return mapping[key];
        } else {
            throw new NotSupported (this.id + ' ' + key + ' does not have a value in mapping');
        }
    }

    async fetchBorrowRate (code, params = {}) {
        await this.loadMarkets ();
        if (!this.has['fetchBorrowRates']) {
            throw new NotSupported (this.id + ' fetchBorrowRate() is not supported yet');
        }
        const borrowRates = await this.fetchBorrowRates (params);
        const rate = this.safeValue (borrowRates, code);
        if (rate === undefined) {
            throw new ExchangeError (this.id + ' fetchBorrowRate() could not find the borrow rate for currency code ' + code);
        }
        return rate;
    }

    handleMarketTypeAndParams (methodName, market = undefined, params = {}) {
        const defaultType = this.safeString2 (this.options, 'defaultType', 'type', 'spot');
        const methodOptions = this.safeValue (this.options, methodName);
        let methodType = defaultType;
        if (methodOptions !== undefined) {
            if (typeof methodOptions === 'string') {
                methodType = methodOptions;
            } else {
                methodType = this.safeString2 (methodOptions, 'defaultType', 'type', methodType);
            }
        }
        const marketType = (market === undefined) ? methodType : market['type'];
        const type = this.safeString2 (params, 'defaultType', 'type', marketType);
        params = this.omit (params, [ 'defaultType', 'type' ]);
        return [ type, params ];
    }

    throwExactlyMatchedException (exact, string, message) {
        if (string in exact) {
            throw new exact[string] (message);
        }
    }

    throwBroadlyMatchedException (broad, string, message) {
        const broadKey = this.findBroadlyMatchedKey (broad, string);
        if (broadKey !== undefined) {
            throw new broad[broadKey] (message);
        }
    }

    findBroadlyMatchedKey (broad, string) {
        // a helper for matching error strings exactly vs broadly
        const keys = Object.keys (broad);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (string.indexOf (key) >= 0) {
                return key;
            }
        }
        return undefined;
    }

    handleErrors (statusCode, statusText, url, method, responseHeaders, responseBody, response, requestHeaders, requestBody) {
        // it is a stub method that must be overrided in the derived exchange classes
        // throw new NotSupported (this.id + ' handleErrors() not implemented yet');
    }

    calculateRateLimiterCost (api, method, path, params, config = {}, context = {}) {
        return this.safeValue (config, 'cost', 1);
    }

    async fetchTicker (symbol, params = {}) {
        if (this.has['fetchTickers']) {
            const tickers = await this.fetchTickers ([ symbol ], params);
            const ticker = this.safeValue (tickers, symbol);
            if (ticker === undefined) {
                throw new NullResponse (this.id + ' fetchTickers() could not find a ticker for ' + symbol);
            } else {
                return ticker;
            }
        } else {
            throw new NotSupported (this.id + ' fetchTicker() is not supported yet');
        }
    }

    async fetchTickers (symbols = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchTickers() is not supported yet');
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchOrder() is not supported yet');
    }

    async fetchOrderStatus (id, symbol = undefined, params = {}) {
        const order = await this.fetchOrder (id, symbol, params);
        return order['status'];
    }

    async fetchUnifiedOrder (order, params = {}) {
        return await this.fetchOrder (this.safeValue (order, 'id'), this.safeValue (order, 'symbol'), params);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        throw new NotSupported (this.id + ' createOrder() is not supported yet');
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        throw new NotSupported (this.id + ' cancelOrder() is not supported yet');
    }

    async cancelUnifiedOrder (order, params = {}) {
        return this.cancelOrder (this.safeValue (order, 'id'), this.safeValue (order, 'symbol'), params);
    }

    async fetchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchOrders() is not supported yet');
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchOpenOrders() is not supported yet');
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchClosedOrders() is not supported yet');
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchMyTrades() is not supported yet');
    }

    async fetchTransactions (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchTransactions() is not supported yet');
    }

    async fetchDeposits (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchDeposits() is not supported yet');
    }

    async fetchWithdrawals (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        throw new NotSupported (this.id + ' fetchWithdrawals() is not supported yet');
    }

    async fetchDepositAddress (code, params = {}) {
        if (this.has['fetchDepositAddresses']) {
            const depositAddresses = await this.fetchDepositAddresses ([ code ], params);
            const depositAddress = this.safeValue (depositAddresses, code);
            if (depositAddress === undefined) {
                throw new InvalidAddress (this.id + ' fetchDepositAddress() could not find a deposit address for ' + code + ', make sure you have created a corresponding deposit address in your wallet on the exchange website');
            } else {
                return depositAddress;
            }
        } else {
            throw new NotSupported (this.id + ' fetchDepositAddress() is not supported yet');
        }
    }

    account () {
        return {
            'free': undefined,
            'used': undefined,
            'total': undefined,
        };
    }

    commonCurrencyCode (currency) {
        if (!this.substituteCommonCurrencyCodes) {
            return currency;
        }
        return this.safeString (this.commonCurrencies, currency, currency);
    }

    currency (code) {
        if (this.currencies === undefined) {
            throw new ExchangeError (this.id + ' currencies not loaded');
        }
        if (typeof code === 'string') {
            if (code in this.currencies) {
                return this.currencies[code];
            } else if (code in this.currencies_by_id) {
                return this.currencies_by_id[code];
            }
        }
        throw new ExchangeError (this.id + ' does not have currency code ' + code);
    }

    market (symbol) {
        if (this.markets === undefined) {
            throw new ExchangeError (this.id + ' markets not loaded');
        }
        if (this.markets_by_id === undefined) {
            throw new ExchangeError (this.id + ' markets not loaded');
        }
        if (typeof symbol === 'string') {
            if (symbol in this.markets) {
                return this.markets[symbol];
            } else if (symbol in this.markets_by_id) {
                return this.markets_by_id[symbol];
            }
        }
        throw new BadSymbol (this.id + ' does not have market symbol ' + symbol);
    }

    handleWithdrawTagAndParams (tag, params) {
        if (typeof tag === 'object') {
            params = this.extend (tag, params);
            tag = undefined;
        }
        if (tag === undefined) {
            tag = this.safeString (params, 'tag');
            if (tag !== undefined) {
                params = this.omit (params, 'tag');
            }
        }
        return [ tag, params ];
    }

    async createLimitOrder (symbol, side, amount, price, params = {}) {
        return await this.createOrder (symbol, 'limit', side, amount, price, params);
    }

    async createMarketOrder (symbol, side, amount, price, params = {}) {
        return await this.createOrder (symbol, 'market', side, amount, price, params);
    }

    async createLimitBuyOrder (symbol, amount, price, params = {}) {
        return await this.createOrder  (symbol, 'limit', 'buy', amount, price, params);
    }

    async createLimitSellOrder (symbol, amount, price, params = {}) {
        return await this.createOrder (symbol, 'limit', 'sell', amount, price, params);
    }

    async createMarketBuyOrder (symbol, amount, params = {}) {
        return await this.createOrder (symbol, 'market', 'buy', amount, undefined, params);
    }

    async createMarketSellOrder (symbol, amount, params = {}) {
        return await this.createOrder (symbol, 'market', 'sell', amount, undefined, params);
    }

    costToPrecision (symbol, cost) {
        const market = this.market (symbol);
        return this.decimalToPrecision (cost, TRUNCATE, market['precision']['price'], this.precisionMode, this.paddingMode);
    }

    priceToPrecision (symbol, price) {
        const market = this.market (symbol);
        return this.decimalToPrecision (price, ROUND, market['precision']['price'], this.precisionMode, this.paddingMode);
    }

    amountToPrecision (symbol, amount) {
        const market = this.market (symbol);
        return this.decimalToPrecision (amount, TRUNCATE, market['precision']['amount'], this.precisionMode, this.paddingMode);
    }

    feeToPrecision (symbol, fee) {
        const market = this.market (symbol);
        return this.decimalToPrecision (fee, ROUND, market['precision']['price'], this.precisionMode, this.paddingMode);
    }

    currencyToPrecision (code, fee, networkCode = undefined) {
        const currency = this.currencies[code];
        let precision = this.safeValue (currency, 'precision');
        if (networkCode !== undefined) {
            const networks = this.safeValue (currency, 'networks', {});
            const networkItem = this.safeValue (networks, networkCode, {});
            precision = this.safeValue (networkItem, 'precision', precision);
        }
        if (precision === undefined) {
            return fee;
        } else {
            return this.decimalToPrecision (fee, ROUND, precision, this.precisionMode, this.paddingMode);
        }
    }

    safeNumber (object, key, d = undefined) {
        const value = this.safeString (object, key);
        return this.parseNumber (value, d);
    }

    safeNumberN (object, arr, d = undefined) {
        const value = this.safeStringN (object, arr);
        return this.parseNumber(value, d);
    }

    parsePrecision (precision) {
        if (precision === undefined) {
            return undefined;
        }
        return '1e' + Precise.stringNeg (precision);
    }

    async loadTimeDifference (params = {}) {
        const serverTime = await this.fetchTime (params);
        const after = this.milliseconds ();
        this.options['timeDifference'] = after - serverTime;
        return this.options['timeDifference'];
    }

    implodeHostname (url) {
        return this.implodeParams (url, { 'hostname': this.hostname });
    }

    async fetchMarketLeverageTiers (symbol, params = {}) {
        if (this.has['fetchLeverageTiers']) {
            const market = await this.market (symbol);
            if (!market['contract']) {
                throw new BadSymbol (this.id + ' fetchMarketLeverageTiers() supports contract markets only');
            }
            const tiers = await this.fetchLeverageTiers ([ symbol ]);
            return this.safeValue (tiers, symbol);
        } else {
            throw new NotSupported (this.id + ' fetchMarketLeverageTiers() is not supported yet');
        }
    }

    async createPostOnlyOrder (symbol, type, side, amount, price, params = {}) {
        if (!this.has['createPostOnlyOrder']) {
            throw new NotSupported (this.id + 'createPostOnlyOrder() is not supported yet');
        }
        const query = this.extend (params, { 'postOnly': true });
        return await this.createOrder (symbol, type, side, amount, price, query);
    }

    async createReduceOnlyOrder (symbol, type, side, amount, price, params = {}) {
        if (!this.has['createReduceOnlyOrder']) {
            throw new NotSupported (this.id + 'createReduceOnlyOrder() is not supported yet');
        }
        const query = this.extend (params, { 'reduceOnly': true });
        return await this.createOrder (symbol, type, side, amount, price, query);
    }

    async createStopOrder (symbol, type, side, amount, price = undefined, stopPrice = undefined, params = {}) {
        if (!this.has['createStopOrder']) {
            throw new NotSupported (this.id + ' createStopOrder() is not supported yet');
        }
        if (stopPrice === undefined) {
            throw new ArgumentsRequired (this.id + ' create_stop_order() requires a stopPrice argument');
        }
        const query = this.extend (params, { 'stopPrice': stopPrice });
        return await this.createOrder (symbol, type, side, amount, price, query);
    }

    async createStopLimitOrder (symbol, side, amount, price, stopPrice, params = {}) {
        if (!this.has['createStopLimitOrder']) {
            throw new NotSupported (this.id + ' createStopLimitOrder() is not supported yet');
        }
        const query = this.extend (params, { 'stopPrice': stopPrice });
        return await this.createOrder (symbol, 'limit', side, amount, price, query);
    }

    async createStopMarketOrder (symbol, side, amount, stopPrice, params = {}) {
        if (!this.has['createStopMarketOrder']) {
            throw new NotSupported (this.id + ' createStopMarketOrder() is not supported yet');
        }
        const query = this.extend (params, { 'stopPrice': stopPrice });
        return await this.createOrder (symbol, 'market', side, amount, undefined, query);
    }

    safeCurrencyCode (currencyId, currency = undefined) {
        currency = this.safeCurrency (currencyId, currency);
        return currency['code'];
    }

    filterBySymbolSinceLimit (array, symbol = undefined, since = undefined, limit = undefined, tail = false) {
        return this.filterByValueSinceLimit (array, 'symbol', symbol, since, limit, 'timestamp', tail);
    }

    filterByCurrencySinceLimit (array, code = undefined, since = undefined, limit = undefined, tail = false) {
        return this.filterByValueSinceLimit (array, 'currency', code, since, limit, 'timestamp', tail);
    }

    parseBorrowInterests (response, market = undefined) {
        const interests = [];
        for (let i = 0; i < response.length; i++) {
            const row = response[i];
            interests.push (this.parseBorrowInterest (row, market));
        }
        return interests;
    }

    parseFundingRateHistories (response, market = undefined, since = undefined, limit = undefined) {
        const rates = [];
        for (let i = 0; i < response.length; i++) {
            const entry = response[i];
            rates.push (this.parseFundingRateHistory (entry, market));
        }
        const sorted = this.sortBy (rates, 'timestamp');
        const symbol = (market === undefined) ? undefined : market['symbol'];
        return this.filterBySymbolSinceLimit (sorted, symbol, since, limit);
    }

    safeSymbol (marketId, market = undefined, delimiter = undefined) {
        market = this.safeMarket (marketId, market, delimiter);
        return market['symbol'];
    }

    parseFundingRate (contract, market = undefined) {
        throw new NotSupported (this.id + ' parseFundingRate() is not supported yet');
    }

    parseFundingRates (response, market = undefined) {
        const result = {};
        for (let i = 0; i < response.length; i++) {
            const parsed = this.parseFundingRate (response[i], market);
            result[parsed['symbol']] = parsed;
        }
        return result;
    }

    isPostOnly (isMarketOrder, exchangeSpecificParam, params = {}) {
        /**
         * @ignore
         * @method
         * @param {string} type Order type
         * @param {boolean} exchangeSpecificParam exchange specific postOnly
         * @param {dict} params exchange specific params
         * @returns {boolean} true if a post only order, false otherwise
         */
        const timeInForce = this.safeStringUpper (params, 'timeInForce');
        let postOnly = this.safeValue2 (params, 'postOnly', 'post_only', false);
        // we assume timeInForce is uppercase from safeStringUpper (params, 'timeInForce')
        const ioc = timeInForce === 'IOC';
        const fok = timeInForce === 'FOK';
        const timeInForcePostOnly = timeInForce === 'PO';
        postOnly = postOnly || timeInForcePostOnly || exchangeSpecificParam;
        if (postOnly) {
            if (ioc || fok) {
                throw new InvalidOrder (this.id + ' postOnly orders cannot have timeInForce equal to ' + timeInForce);
            } else if (isMarketOrder) {
                throw new InvalidOrder (this.id + ' market orders cannot be postOnly');
            } else {
                return true;
            }
        } else {
            return false;
        }
    }

    async fetchTradingFees (params = {}) {
        throw new NotSupported (this.id + ' fetchTradingFees() is not supported yet');
    }

    async fetchTradingFee (symbol, params = {}) {
        if (!this.has['fetchTradingFees']) {
            throw new NotSupported (this.id + ' fetchTradingFee() is not supported yet');
        }
        return await this.fetchTradingFees (params);
    }

    parseOpenInterest (interest, market = undefined) {
        throw new NotSupported (this.id + ' parseOpenInterest () is not supported yet');
    }

    parseOpenInterests (response, market = undefined, since = undefined, limit = undefined) {
        const interests = [];
        for (let i = 0; i < response.length; i++) {
            const entry = response[i];
            const interest = this.parseOpenInterest (entry, market);
            interests.push (interest);
        }
        const sorted = this.sortBy (interests, 'timestamp');
        const symbol = this.safeString (market, 'symbol');
        return this.filterBySymbolSinceLimit (sorted, symbol, since, limit);
    }

    async fetchFundingRate (symbol, params = {}) {
        if (this.has['fetchFundingRates']) {
            const market = await this.market (symbol);
            if (!market['contract']) {
                throw new BadSymbol (this.id + ' fetchFundingRate() supports contract markets only');
            }
            const rates = await this.fetchFundingRates ([ symbol ], params);
            const rate = this.safeValue (rates, symbol);
            if (rate === undefined) {
                throw new NullResponse (this.id + ' fetchFundingRate () returned no data for ' + symbol);
            } else {
                return rate;
            }
        } else {
            throw new NotSupported (this.id + ' fetchFundingRate () is not supported yet');
        }
    }

    async fetchMarkOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name exchange#fetchMarkOHLCV
         * @description fetches historical mark price candlestick data containing the open, high, low, and close price of a market
         * @param {str} symbol unified symbol of the market to fetch OHLCV data for
         * @param {str} timeframe the length of time each candle represents
         * @param {int|undefined} since timestamp in ms of the earliest candle to fetch
         * @param {int|undefined} limit the maximum amount of candles to fetch
         * @param {dict} params extra parameters specific to the exchange api endpoint
         * @returns {[[int|float]]} A list of candles ordered as timestamp, open, high, low, close, undefined
         */
        if (this.has['fetchMarkOHLCV']) {
            const request = {
                'price': 'mark',
            };
            return await this.fetchOHLCV (symbol, timeframe, since, limit, this.extend (request, params));
        } else {
            throw new NotSupported (this.id + ' fetchMarkOHLCV () is not supported yet');
        }
    }

    async fetchIndexOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name exchange#fetchIndexOHLCV
         * @description fetches historical index price candlestick data containing the open, high, low, and close price of a market
         * @param {str} symbol unified symbol of the market to fetch OHLCV data for
         * @param {str} timeframe the length of time each candle represents
         * @param {int|undefined} since timestamp in ms of the earliest candle to fetch
         * @param {int|undefined} limit the maximum amount of candles to fetch
         * @param {dict} params extra parameters specific to the exchange api endpoint
         * @returns {[[int|float]]} A list of candles ordered as timestamp, open, high, low, close, undefined
         */
        if (this.has['fetchIndexOHLCV']) {
            const request = {
                'price': 'index',
            };
            return await this.fetchOHLCV (symbol, timeframe, since, limit, this.extend (request, params));
        } else {
            throw new NotSupported (this.id + ' fetchIndexOHLCV () is not supported yet');
        }
    }

    async fetchPremiumIndexOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name exchange#fetchPremiumIndexOHLCV
         * @description fetches historical premium index price candlestick data containing the open, high, low, and close price of a market
         * @param {str} symbol unified symbol of the market to fetch OHLCV data for
         * @param {str} timeframe the length of time each candle represents
         * @param {int|undefined} since timestamp in ms of the earliest candle to fetch
         * @param {int|undefined} limit the maximum amount of candles to fetch
         * @param {dict} params extra parameters specific to the exchange api endpoint
         * @returns {[[int|float]]} A list of candles ordered as timestamp, open, high, low, close, undefined
         */
        if (this.has['fetchPremiumIndexOHLCV']) {
            const request = {
                'price': 'premiumIndex',
            };
            return await this.fetchOHLCV (symbol, timeframe, since, limit, this.extend (request, params));
        } else {
            throw new NotSupported (this.id + ' fetchPremiumIndexOHLCV () is not supported yet');
        }
    }
}
