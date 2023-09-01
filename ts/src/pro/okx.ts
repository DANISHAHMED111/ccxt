
//  ---------------------------------------------------------------------------

import okxRest from '../okx.js';
import { ArgumentsRequired, AuthenticationError, BadRequest, InvalidNonce } from '../base/errors.js';
import { ArrayCache, ArrayCacheByTimestamp, ArrayCacheBySymbolById } from '../base/ws/Cache.js';
import { sha256 } from '../static_dependencies/noble-hashes/sha256.js';
import { Int, OrderSide, OrderType } from '../base/types.js';
import Client from '../base/ws/Client.js';

//  ---------------------------------------------------------------------------

export default class okx extends okxRest {
    describe () {
        return this.deepExtend (super.describe (), {
            'has': {
                'ws': true,
                'watchTicker': true,
                'watchTickers': true,
                'watchOrderBook': true,
                'watchTrades': true,
                'watchBalance': true,
                'watchOHLCV': true,
                'watchOrders': true,
                'watchMyTrades': true,
                'createOrderWs': true,
                'editOrderWs': true,
                'cancelOrderWs': true,
                'cancelOrdersWs': true,
                'cancelAllOrdersWs': true,
            },
            'urls': {
                'api': {
                    'ws': 'wss://ws.okx.com:8443/ws/v5',
                },
                'test': {
                    'ws': 'wss://wspap.okx.com:8443/ws/v5',
                },
            },
            'options': {
                'watchOrderBook': {
                    //
                    // bbo-tbt
                    // 1. Newly added channel that sends tick-by-tick Level 1 data
                    // 2. All API users can subscribe
                    // 3. Public depth channel, verification not required
                    //
                    // books-l2-tbt
                    // 1. Only users who're VIP5 and above can subscribe
                    // 2. Identity verification required before subscription
                    //
                    // books50-l2-tbt
                    // 1. Only users who're VIP4 and above can subscribe
                    // 2. Identity verification required before subscription
                    //
                    // books
                    // 1. All API users can subscribe
                    // 2. Public depth channel, verification not required
                    //
                    // books5
                    // 1. All API users can subscribe
                    // 2. Public depth channel, verification not required
                    // 3. Data feeds will be delivered every 100ms (vs. every 200ms now)
                    //
                    'depth': 'books',
                },
                'watchBalance': 'spot', // margin, futures, swap
                'watchTicker': {
                    'channel': 'tickers', // tickers, sprd-tickers, index-tickers, block-tickers
                },
                'watchTickers': {
                    'channel': 'tickers', // tickers, sprd-tickers, index-tickers, block-tickers
                },
                'watchOrders': {
                    'type': 'ANY', // SPOT, MARGIN, SWAP, FUTURES, OPTION, ANY
                },
                'watchMyTrades': {
                    'type': 'ANY', // SPOT, MARGIN, SWAP, FUTURES, OPTION, ANY
                },
                'createOrderWs': {
                    'op': 'batch-orders', // order, batch-orders
                },
                'editOrderWs': {
                    'op': 'amend-order', // amend-order, batch-amend-orders
                },
                'ws': {
                    // 'inflate': true,
                },
                'checksum': true,
            },
            'streaming': {
                // okex does not support built-in ws protocol-level ping-pong
                // instead it requires a custom text-based ping-pong
                'ping': this.ping,
                'keepAlive': 20000,
            },
        });
    }

    getUrl (channel: string, access = 'public') {
        // for context: https://www.okx.com/help-center/changes-to-v5-api-websocket-subscription-parameter-and-url
        const isSandbox = this.options['sandboxMode'];
        const sandboxSuffix = isSandbox ? '?brokerId=9999' : '';
        const isPublic = (access === 'public');
        const url = this.urls['api']['ws'];
        if ((channel.indexOf ('candle') > -1) || (channel === 'orders-algo')) {
            return url + '/business' + sandboxSuffix;
        } else if (isPublic) {
            return url + '/public' + sandboxSuffix;
        }
        return url + '/private' + sandboxSuffix;
    }

    async subscribeMultiple (access, channel, symbols: string[] = undefined, params = {}) {
        await this.loadMarkets ();
        if (symbols === undefined) {
            symbols = this.symbols;
        }
        symbols = this.marketSymbols (symbols);
        const url = this.getUrl (channel, access);
        let messageHash = channel;
        const args = [];
        messageHash += '::' + symbols.join (',');
        for (let i = 0; i < symbols.length; i++) {
            const marketId = this.marketId (symbols[i]);
            const arg = {
                'channel': channel,
                'instId': marketId,
            };
            args.push (this.extend (arg, params));
        }
        const request = {
            'op': 'subscribe',
            'args': args,
        };
        return await this.watch (url, messageHash, request, messageHash);
    }

    async subscribe (access, messageHash, channel, symbol, params = {}) {
        await this.loadMarkets ();
        const url = this.getUrl (channel, access);
        const firstArgument = {
            'channel': channel,
        };
        if (symbol !== undefined) {
            const market = this.market (symbol);
            messageHash += ':' + market['id'];
            firstArgument['instId'] = market['id'];
        }
        const request = {
            'op': 'subscribe',
            'args': [
                this.deepExtend (firstArgument, params),
            ],
        };
        return await this.watch (url, messageHash, request, messageHash);
    }

    async watchTrades (symbol: string, since: Int = undefined, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name okx#watchTrades
         * @description get the list of most recent trades for a particular symbol
         * @param {string} symbol unified symbol of the market to fetch trades for
         * @param {int} [since] timestamp in ms of the earliest trade to fetch
         * @param {int} [limit] the maximum amount of trades to fetch
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @returns {object[]} a list of [trade structures]{@link https://github.com/ccxt/ccxt/wiki/Manual#public-trades}
         */
        await this.loadMarkets ();
        symbol = this.symbol (symbol);
        const trades = await this.subscribe ('public', 'trades', 'trades', symbol, params);
        if (this.newUpdates) {
            limit = trades.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (trades, since, limit, 'timestamp', true);
    }

    handleTrades (client: Client, message) {
        //
        //     {
        //         arg: { channel: 'trades', instId: 'BTC-USDT' },
        //         data: [
        //             {
        //                 instId: 'BTC-USDT',
        //                 tradeId: '216970876',
        //                 px: '31684.5',
        //                 sz: '0.00001186',
        //                 side: 'buy',
        //                 ts: '1626531038288'
        //             }
        //         ]
        //     }
        //
        const arg = this.safeValue (message, 'arg', {});
        const channel = this.safeString (arg, 'channel');
        const data = this.safeValue (message, 'data', []);
        const tradesLimit = this.safeInteger (this.options, 'tradesLimit', 1000);
        for (let i = 0; i < data.length; i++) {
            const trade = this.parseTrade (data[i]);
            const symbol = trade['symbol'];
            const marketId = this.safeString (trade['info'], 'instId');
            const messageHash = channel + ':' + marketId;
            let stored = this.safeValue (this.trades, symbol);
            if (stored === undefined) {
                stored = new ArrayCache (tradesLimit);
                this.trades[symbol] = stored;
            }
            stored.append (trade);
            client.resolve (stored, messageHash);
        }
        return message;
    }

    async watchTicker (symbol: string, params = {}) {
        /**
         * @method
         * @name okx#watchTicker
         * @see https://www.okx.com/docs-v5/en/#order-book-trading-market-data-ws-tickers-channel
         * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for a specific market
         * @param {string} symbol unified symbol of the market to fetch the ticker for
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @param {string} [params.channel] the channel to subscribe to, tickers by default. Can be tickers, sprd-tickers, index-tickers, block-tickers
         * @returns {object} a [ticker structure]{@link https://github.com/ccxt/ccxt/wiki/Manual#ticker-structure}
         */
        let channel = undefined;
        [ channel, params ] = this.handleOptionAndParams (params, 'watchTicker', 'channel', 'tickers');
        params['channel'] = channel;
        const ticker = await this.watchTickers ([ symbol ], params);
        return this.safeValue (ticker, symbol);
    }

    async watchTickers (symbols: string[] = undefined, params = {}) {
        /**
         * @method
         * @name okx#watchTickers
         * @see https://www.okx.com/docs-v5/en/#order-book-trading-market-data-ws-tickers-channel
         * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for all markets of a specific list
         * @param {string[]} [symbols] unified symbol of the market to fetch the ticker for
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @param {string} [params.channel] the channel to subscribe to, tickers by default. Can be tickers, sprd-tickers, index-tickers, block-tickers
         * @returns {object} a [ticker structure]{@link https://github.com/ccxt/ccxt/wiki/Manual#ticker-structure}
         */
        if (this.isEmpty (symbols)) {
            throw new ArgumentsRequired (this.id + ' watchTickers requires a list of symbols');
        }
        let channel = undefined;
        [ channel, params ] = this.handleOptionAndParams (params, 'watchTickers', 'channel', 'tickers');
        const newTickers = await this.subscribeMultiple ('public', channel, symbols, params);
        if (this.newUpdates) {
            return newTickers;
        }
        return this.filterByArray (this.tickers, 'symbol', symbols);
    }

    handleTicker (client: Client, message) {
        //
        //     {
        //         arg: { channel: 'tickers', instId: 'BTC-USDT' },
        //         data: [
        //             {
        //                 instType: 'SPOT',
        //                 instId: 'BTC-USDT',
        //                 last: '31500.1',
        //                 lastSz: '0.00001754',
        //                 askPx: '31500.1',
        //                 askSz: '0.00998144',
        //                 bidPx: '31500',
        //                 bidSz: '3.05652439',
        //                 open24h: '31697',
        //                 high24h: '32248',
        //                 low24h: '31165.6',
        //                 sodUtc0: '31385.5',
        //                 sodUtc8: '32134.9',
        //                 volCcy24h: '503403597.38138519',
        //                 vol24h: '15937.10781721',
        //                 ts: '1626526618762'
        //             }
        //         ]
        //     }
        //
        const arg = this.safeValue (message, 'arg', {});
        const channel = this.safeString (arg, 'channel');
        const data = this.safeValue (message, 'data', []);
        const newTickers = [];
        for (let i = 0; i < data.length; i++) {
            const ticker = this.parseTicker (data[i]);
            const symbol = ticker['symbol'];
            this.tickers[symbol] = ticker;
            newTickers.push (ticker);
        }
        const messageHashes = this.findMessageHashes (client, channel + '::');
        for (let i = 0; i < messageHashes.length; i++) {
            const messageHash = messageHashes[i];
            const parts = messageHash.split ('::');
            const symbolsString = parts[1];
            const symbols = symbolsString.split (',');
            const tickers = this.filterByArray (newTickers, 'symbol', symbols);
            const tickersSymbols = Object.keys (tickers);
            const numTickers = tickersSymbols.length;
            if (numTickers > 0) {
                client.resolve (tickers, messageHash);
            }
        }
        return message;
    }

    async watchOHLCV (symbol: string, timeframe = '1m', since: Int = undefined, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name okx#watchOHLCV
         * @description watches historical candlestick data containing the open, high, low, and close price, and the volume of a market
         * @param {string} symbol unified symbol of the market to fetch OHLCV data for
         * @param {string} timeframe the length of time each candle represents
         * @param {int} [since] timestamp in ms of the earliest candle to fetch
         * @param {int} [limit] the maximum amount of candles to fetch
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @returns {int[][]} A list of candles ordered as timestamp, open, high, low, close, volume
         */
        await this.loadMarkets ();
        symbol = this.symbol (symbol);
        const interval = this.safeString (this.timeframes, timeframe, timeframe);
        const name = 'candle' + interval;
        const ohlcv = await this.subscribe ('public', name, name, symbol, params);
        if (this.newUpdates) {
            limit = ohlcv.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (ohlcv, since, limit, 0, true);
    }

    handleOHLCV (client: Client, message) {
        //
        //     {
        //         arg: { channel: 'candle1m', instId: 'BTC-USDT' },
        //         data: [
        //             [
        //                 '1626690720000',
        //                 '31334',
        //                 '31334',
        //                 '31334',
        //                 '31334',
        //                 '0.0077',
        //                 '241.2718'
        //             ]
        //         ]
        //     }
        //
        const arg = this.safeValue (message, 'arg', {});
        const channel = this.safeString (arg, 'channel');
        const data = this.safeValue (message, 'data', []);
        const marketId = this.safeString (arg, 'instId');
        const market = this.safeMarket (marketId);
        const symbol = market['id'];
        const interval = channel.replace ('candle', '');
        // use a reverse lookup in a static map instead
        const timeframe = this.findTimeframe (interval);
        for (let i = 0; i < data.length; i++) {
            const parsed = this.parseOHLCV (data[i], market);
            this.ohlcvs[symbol] = this.safeValue (this.ohlcvs, symbol, {});
            let stored = this.safeValue (this.ohlcvs[symbol], timeframe);
            if (stored === undefined) {
                const limit = this.safeInteger (this.options, 'OHLCVLimit', 1000);
                stored = new ArrayCacheByTimestamp (limit);
                this.ohlcvs[symbol][timeframe] = stored;
            }
            stored.append (parsed);
            const messageHash = channel + ':' + marketId;
            client.resolve (stored, messageHash);
        }
    }

    async watchOrderBook (symbol: string, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name okx#watchOrderBook
         * @description watches information on open orders with bid (buy) and ask (sell) prices, volumes and other data
         * @param {string} symbol unified symbol of the market to fetch the order book for
         * @param {int} [limit] the maximum amount of order book entries to return
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @returns {object} A dictionary of [order book structures]{@link https://github.com/ccxt/ccxt/wiki/Manual#order-book-structure} indexed by market symbols
         */
        const options = this.safeValue (this.options, 'watchOrderBook', {});
        //
        // bbo-tbt
        // 1. Newly added channel that sends tick-by-tick Level 1 data
        // 2. All API users can subscribe
        // 3. Public depth channel, verification not required
        //
        // books-l2-tbt
        // 1. Only users who're VIP5 and above can subscribe
        // 2. Identity verification required before subscription
        //
        // books50-l2-tbt
        // 1. Only users who're VIP4 and above can subscribe
        // 2. Identity verification required before subscription
        //
        // books
        // 1. All API users can subscribe
        // 2. Public depth channel, verification not required
        //
        // books5
        // 1. All API users can subscribe
        // 2. Public depth channel, verification not required
        // 3. Data feeds will be delivered every 100ms (vs. every 200ms now)
        //
        const depth = this.safeString (options, 'depth', 'books');
        if ((depth === 'books-l2-tbt') || (depth === 'books50-l2-tbt')) {
            await this.authenticate ({ 'access': 'public' });
        }
        const orderbook = await this.subscribe ('public', depth, depth, symbol, params);
        return orderbook.limit ();
    }

    handleDelta (bookside, delta) {
        //
        //     [
        //         '31685', // price
        //         '0.78069158', // amount
        //         '0', // liquidated orders
        //         '17' // orders
        //     ]
        //
        const price = this.safeFloat (delta, 0);
        const amount = this.safeFloat (delta, 1);
        bookside.store (price, amount);
    }

    handleDeltas (bookside, deltas) {
        for (let i = 0; i < deltas.length; i++) {
            this.handleDelta (bookside, deltas[i]);
        }
    }

    handleOrderBookMessage (client: Client, message, orderbook, messageHash) {
        //
        //     {
        //         asks: [
        //             [ '31738.3', '0.05973179', '0', '3' ],
        //             [ '31738.5', '0.11035404', '0', '2' ],
        //             [ '31739.6', '0.01', '0', '1' ],
        //         ],
        //         bids: [
        //             [ '31738.2', '0.67557666', '0', '9' ],
        //             [ '31738', '0.02466947', '0', '2' ],
        //             [ '31736.3', '0.01705046', '0', '2' ],
        //         ],
        //         instId: 'BTC-USDT',
        //         ts: '1626537446491'
        //     }
        //
        const asks = this.safeValue (message, 'asks', []);
        const bids = this.safeValue (message, 'bids', []);
        const storedAsks = orderbook['asks'];
        const storedBids = orderbook['bids'];
        this.handleDeltas (storedAsks, asks);
        this.handleDeltas (storedBids, bids);
        const checksum = this.safeValue (this.options, 'checksum', true);
        if (checksum) {
            const asksLength = storedAsks.length;
            const bidsLength = storedBids.length;
            const payloadArray = [];
            for (let i = 0; i < 25; i++) {
                if (i < bidsLength) {
                    payloadArray.push (this.numberToString (storedBids[i][0]));
                    payloadArray.push (this.numberToString (storedBids[i][1]));
                }
                if (i < asksLength) {
                    payloadArray.push (this.numberToString (storedAsks[i][0]));
                    payloadArray.push (this.numberToString (storedAsks[i][1]));
                }
            }
            const payload = payloadArray.join (':');
            const responseChecksum = this.safeInteger (message, 'checksum');
            const localChecksum = this.crc32 (payload, true);
            if (responseChecksum !== localChecksum) {
                const error = new InvalidNonce (this.id + ' invalid checksum');
                client.reject (error, messageHash);
            }
        }
        const timestamp = this.safeInteger (message, 'ts');
        orderbook['timestamp'] = timestamp;
        orderbook['datetime'] = this.iso8601 (timestamp);
        return orderbook;
    }

    handleOrderBook (client: Client, message) {
        //
        // snapshot
        //
        //     {
        //         arg: { channel: 'books-l2-tbt', instId: 'BTC-USDT' },
        //         action: 'snapshot',
        //         data: [
        //             {
        //                 asks: [
        //                     [ '31685', '0.78069158', '0', '17' ],
        //                     [ '31685.1', '0.0001', '0', '1' ],
        //                     [ '31685.6', '0.04543165', '0', '1' ],
        //                 ],
        //                 bids: [
        //                     [ '31684.9', '0.01', '0', '1' ],
        //                     [ '31682.9', '0.0001', '0', '1' ],
        //                     [ '31680.7', '0.01', '0', '1' ],
        //                 ],
        //                 ts: '1626532416403',
        //                 checksum: -1023440116
        //             }
        //         ]
        //     }
        //
        // update
        //
        //     {
        //         arg: { channel: 'books-l2-tbt', instId: 'BTC-USDT' },
        //         action: 'update',
        //         data: [
        //             {
        //                 asks: [
        //                     [ '31657.7', '0', '0', '0' ],
        //                     [ '31659.7', '0.01', '0', '1' ],
        //                     [ '31987.3', '0.01', '0', '1' ]
        //                 ],
        //                 bids: [
        //                     [ '31642.9', '0.50296385', '0', '4' ],
        //                     [ '31639.9', '0', '0', '0' ],
        //                     [ '31638.7', '0.01', '0', '1' ],
        //                 ],
        //                 ts: '1626535709008',
        //                 checksum: 830931827
        //             }
        //         ]
        //     }
        //
        // books5
        //
        //     {
        //         arg: { channel: 'books5', instId: 'BTC-USDT' },
        //         data: [
        //             {
        //                 asks: [
        //                     [ '31738.3', '0.05973179', '0', '3' ],
        //                     [ '31738.5', '0.11035404', '0', '2' ],
        //                     [ '31739.6', '0.01', '0', '1' ],
        //                 ],
        //                 bids: [
        //                     [ '31738.2', '0.67557666', '0', '9' ],
        //                     [ '31738', '0.02466947', '0', '2' ],
        //                     [ '31736.3', '0.01705046', '0', '2' ],
        //                 ],
        //                 instId: 'BTC-USDT',
        //                 ts: '1626537446491'
        //             }
        //         ]
        //     }
        //
        // bbo-tbt
        //
        //     {
        //         "arg":{
        //             "channel":"bbo-tbt",
        //             "instId":"BTC-USDT"
        //         },
        //         "data":[
        //             {
        //                 "asks":[["36232.2","1.8826134","0","17"]],
        //                 "bids":[["36232.1","0.00572212","0","2"]],
        //                 "ts":"1651826598363"
        //             }
        //         ]
        //     }
        //
        const arg = this.safeValue (message, 'arg', {});
        const channel = this.safeString (arg, 'channel');
        const action = this.safeString (message, 'action');
        const data = this.safeValue (message, 'data', []);
        const marketId = this.safeString (arg, 'instId');
        const market = this.safeMarket (marketId);
        const symbol = market['symbol'];
        const depths = {
            'bbo-tbt': 1,
            'books': 400,
            'books5': 5,
            'books-l2-tbt': 400,
            'books50-l2-tbt': 50,
        };
        const limit = this.safeInteger (depths, channel);
        const messageHash = channel + ':' + marketId;
        if (action === 'snapshot') {
            for (let i = 0; i < data.length; i++) {
                const update = data[i];
                const orderbook = this.orderBook ({}, limit);
                this.orderbooks[symbol] = orderbook;
                orderbook['symbol'] = symbol;
                this.handleOrderBookMessage (client, update, orderbook, messageHash);
                client.resolve (orderbook, messageHash);
            }
        } else if (action === 'update') {
            if (symbol in this.orderbooks) {
                const orderbook = this.orderbooks[symbol];
                for (let i = 0; i < data.length; i++) {
                    const update = data[i];
                    this.handleOrderBookMessage (client, update, orderbook, messageHash);
                    client.resolve (orderbook, messageHash);
                }
            }
        } else if ((channel === 'books5') || (channel === 'bbo-tbt')) {
            let orderbook = this.safeValue (this.orderbooks, symbol);
            if (orderbook === undefined) {
                orderbook = this.orderBook ({}, limit);
            }
            this.orderbooks[symbol] = orderbook;
            for (let i = 0; i < data.length; i++) {
                const update = data[i];
                const timestamp = this.safeInteger (update, 'ts');
                const snapshot = this.parseOrderBook (update, symbol, timestamp, 'bids', 'asks', 0, 1);
                orderbook.reset (snapshot);
                client.resolve (orderbook, messageHash);
            }
        }
        return message;
    }

    async authenticate (params = {}) {
        this.checkRequiredCredentials ();
        const access = this.safeString (params, 'access', 'private');
        params = this.omit (params, [ 'access' ]);
        const url = this.getUrl ('users', access);
        const messageHash = 'authenticated';
        const client = this.client (url);
        const future = client.future (messageHash);
        const authenticated = this.safeValue (client.subscriptions, messageHash);
        if (authenticated === undefined) {
            const timestamp = this.seconds ().toString ();
            const method = 'GET';
            const path = '/users/self/verify';
            const auth = timestamp + method + path;
            const signature = this.hmac (this.encode (auth), this.encode (this.secret), sha256, 'base64');
            const operation = 'login';
            const request = {
                'op': operation,
                'args': [
                    {
                        'apiKey': this.apiKey,
                        'passphrase': this.password,
                        'timestamp': timestamp,
                        'sign': signature,
                    },
                ],
            };
            const message = this.extend (request, params);
            this.watch (url, messageHash, message, messageHash);
        }
        return future;
    }

    async watchBalance (params = {}) {
        /**
         * @method
         * @name okx#watchBalance
         * @description watch balance and get the amount of funds available for trading or funds locked in orders
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @returns {object} a [balance structure]{@link https://github.com/ccxt/ccxt/wiki/Manual#balance-structure}
         */
        await this.loadMarkets ();
        await this.authenticate ();
        return await this.subscribe ('private', 'account', 'account', undefined, params);
    }

    handleBalance (client: Client, message) {
        //
        //     {
        //         arg: { channel: 'account' },
        //         data: [
        //             {
        //                 adjEq: '',
        //                 details: [
        //                     {
        //                         availBal: '',
        //                         availEq: '8.21009913',
        //                         cashBal: '8.21009913',
        //                         ccy: 'USDT',
        //                         coinUsdPrice: '0.99994',
        //                         crossLiab: '',
        //                         disEq: '8.2096065240522',
        //                         eq: '8.21009913',
        //                         eqUsd: '8.2096065240522',
        //                         frozenBal: '0',
        //                         interest: '',
        //                         isoEq: '0',
        //                         isoLiab: '',
        //                         liab: '',
        //                         maxLoan: '',
        //                         mgnRatio: '',
        //                         notionalLever: '0',
        //                         ordFrozen: '0',
        //                         twap: '0',
        //                         uTime: '1621927314996',
        //                         upl: '0'
        //                     },
        //                 ],
        //                 imr: '',
        //                 isoEq: '0',
        //                 mgnRatio: '',
        //                 mmr: '',
        //                 notionalUsd: '',
        //                 ordFroz: '',
        //                 totalEq: '22.1930992296832',
        //                 uTime: '1626692120916'
        //             }
        //         ]
        //     }
        //
        const arg = this.safeValue (message, 'arg', {});
        const channel = this.safeString (arg, 'channel');
        const type = 'spot';
        const balance = this.parseTradingBalance (message);
        const oldBalance = this.safeValue (this.balance, type, {});
        const newBalance = this.deepExtend (oldBalance, balance);
        this.balance[type] = this.safeBalance (newBalance);
        client.resolve (this.balance[type], channel);
    }

    orderToTrade (order, market = undefined) {
        const info = this.safeValue (order, 'info', {});
        const timestamp = this.safeInteger (info, 'fillTime');
        const feeMarketId = this.safeString (info, 'fillFeeCcy');
        const isTaker = this.safeString (info, 'execType', '') === 'T';
        return this.safeTrade ({
            'info': info,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': this.safeString (order, 'symbol'),
            'id': this.safeString (info, 'tradeId'),
            'order': this.safeString (order, 'id'),
            'type': this.safeString (order, 'type'),
            'takerOrMaker': (isTaker) ? 'taker' : 'maker',
            'side': this.safeString (order, 'side'),
            'price': this.safeNumber (info, 'fillPx'),
            'amount': this.safeNumber (info, 'fillSz'),
            'cost': undefined,
            'fee': {
                'cost': this.safeNumber (info, 'fillFee'),
                'currency': this.safeCurrencyCode (feeMarketId),
            },
        }, market);
    }

    async watchMyTrades (symbol: string = undefined, since: Int = undefined, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name okx#watchMyTrades
         * @see https://www.okx.com/docs-v5/en/#order-book-trading-trade-ws-order-channel
         * @description watches information on multiple trades made by the user
         * @param {string} [symbol] unified market symbol of the market trades were made in
         * @param {int} [since] the earliest time in ms to fetch trades for
         * @param {int} [limit] the maximum number of trade structures to retrieve
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @param {bool} [params.stop] true if fetching trigger or conditional trades
         * @returns {object[]} a list of [trade structures]{@link https://github.com/ccxt/ccxt/wiki/Manual#trade-structure
         */
        await this.loadMarkets ();
        await this.authenticate ();
        // By default, receive order updates from any instrument type
        let type = undefined;
        [ type, params ] = this.handleOptionAndParams (params, 'watchMyTrades', 'type', 'ANY');
        const isStop = this.safeValue (params, 'stop', false);
        params = this.omit (params, [ 'stop' ]);
        const channel = isStop ? 'orders-algo' : 'orders';
        let messageHash = channel + '::myTrades';
        let market = undefined;
        if (symbol !== undefined) {
            market = this.market (symbol);
            symbol = market['symbol'];
            type = market['type'];
            messageHash = messageHash + '::' + symbol;
        }
        if (type === 'future') {
            type = 'futures';
        }
        const uppercaseType = type.toUpperCase ();
        const request = {
            'instType': uppercaseType,
        };
        const orders = await this.subscribe ('private', messageHash, channel, symbol, this.extend (request, params));
        if (this.newUpdates) {
            limit = orders.getLimit (symbol, limit);
        }
        return this.filterBySymbolSinceLimit (orders, symbol, since, limit, true);
    }

    async watchOrders (symbol: string = undefined, since: Int = undefined, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name okx#watchOrders
         * @see https://www.okx.com/docs-v5/en/#order-book-trading-trade-ws-order-channel
         * @description watches information on multiple orders made by the user
         * @param {string} [symbol] unified market symbol of the market orders were made in
         * @param {int} [since] the earliest time in ms to fetch orders for
         * @param {int} [limit] the maximum number of  orde structures to retrieve
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @param {bool} [params.stop] true if fetching trigger or conditional orders
         * @returns {object[]} a list of [order structures]{@link https://github.com/ccxt/ccxt/wiki/Manual#order-structure}
         */
        await this.loadMarkets ();
        await this.authenticate ();
        let type = undefined;
        // By default, receive order updates from any instrument type
        [ type, params ] = this.handleOptionAndParams (params, 'watchOrders', 'type', 'ANY');
        const isStop = this.safeValue (params, 'stop', false);
        params = this.omit (params, [ 'stop' ]);
        let market = undefined;
        if (symbol !== undefined) {
            market = this.market (symbol);
            symbol = market['symbol'];
            type = market['type'];
        }
        if (type === 'future') {
            type = 'futures';
        }
        const uppercaseType = type.toUpperCase ();
        const request = {
            'instType': uppercaseType,
        };
        const channel = isStop ? 'orders-algo' : 'orders';
        const orders = await this.subscribe ('private', channel, channel, symbol, this.extend (request, params));
        if (this.newUpdates) {
            limit = orders.getLimit (symbol, limit);
        }
        return this.filterBySymbolSinceLimit (orders, symbol, since, limit, true);
    }

    handleOrders (client: Client, message, subscription = undefined) {
        //
        //     {
        //         "arg":{
        //             "channel":"orders",
        //             "instType":"SPOT"
        //         },
        //         "data":[
        //             {
        //                 "accFillSz":"0",
        //                 "amendResult":"",
        //                 "avgPx":"",
        //                 "cTime":"1634548275191",
        //                 "category":"normal",
        //                 "ccy":"",
        //                 "clOrdId":"e847386590ce4dBC330547db94a08ba0",
        //                 "code":"0",
        //                 "execType":"",
        //                 "fee":"0",
        //                 "feeCcy":"USDT",
        //                 "fillFee":"0",
        //                 "fillFeeCcy":"",
        //                 "fillNotionalUsd":"",
        //                 "fillPx":"",
        //                 "fillSz":"0",
        //                 "fillTime":"",
        //                 "instId":"ETH-USDT",
        //                 "instType":"SPOT",
        //                 "lever":"",
        //                 "msg":"",
        //                 "notionalUsd":"451.4516256",
        //                 "ordId":"370257534141235201",
        //                 "ordType":"limit",
        //                 "pnl":"0",
        //                 "posSide":"",
        //                 "px":"60000",
        //                 "rebate":"0",
        //                 "rebateCcy":"ETH",
        //                 "reqId":"",
        //                 "side":"sell",
        //                 "slOrdPx":"",
        //                 "slTriggerPx":"",
        //                 "state":"live",
        //                 "sz":"0.007526",
        //                 "tag":"",
        //                 "tdMode":"cash",
        //                 "tgtCcy":"",
        //                 "tpOrdPx":"",
        //                 "tpTriggerPx":"",
        //                 "tradeId":"",
        //                 "uTime":"1634548275191"
        //             }
        //         ]
        //     }
        //
        this.handleMyTrades (client, message);
        const arg = this.safeValue (message, 'arg', {});
        const channel = this.safeString (arg, 'channel');
        const orders = this.safeValue (message, 'data', []);
        const ordersLength = orders.length;
        if (ordersLength > 0) {
            const limit = this.safeInteger (this.options, 'ordersLimit', 1000);
            if (this.orders === undefined) {
                this.orders = new ArrayCacheBySymbolById (limit);
            }
            const stored = this.orders;
            const marketIds = [];
            const parsed = this.parseOrders (orders);
            for (let i = 0; i < parsed.length; i++) {
                const order = parsed[i];
                stored.append (order);
                const symbol = order['symbol'];
                const market = this.market (symbol);
                marketIds.push (market['id']);
            }
            client.resolve (this.orders, channel);
            for (let i = 0; i < marketIds.length; i++) {
                const messageHash = channel + ':' + marketIds[i];
                client.resolve (this.orders, messageHash);
            }
        }
    }

    handleMyTrades (client: Client, message) {
        //
        //     {
        //         "arg":{
        //             "channel":"orders",
        //             "instType":"SPOT"
        //         },
        //         "data":[
        //             {
        //                 "accFillSz":"0",
        //                 "amendResult":"",
        //                 "avgPx":"",
        //                 "cTime":"1634548275191",
        //                 "category":"normal",
        //                 "ccy":"",
        //                 "clOrdId":"e847386590ce4dBC330547db94a08ba0",
        //                 "code":"0",
        //                 "execType":"",
        //                 "fee":"0",
        //                 "feeCcy":"USDT",
        //                 "fillFee":"0",
        //                 "fillFeeCcy":"",
        //                 "fillNotionalUsd":"",
        //                 "fillPx":"",
        //                 "fillSz":"0",
        //                 "fillTime":"",
        //                 "instId":"ETH-USDT",
        //                 "instType":"SPOT",
        //                 "lever":"",
        //                 "msg":"",
        //                 "notionalUsd":"451.4516256",
        //                 "ordId":"370257534141235201",
        //                 "ordType":"limit",
        //                 "pnl":"0",
        //                 "posSide":"",
        //                 "px":"60000",
        //                 "rebate":"0",
        //                 "rebateCcy":"ETH",
        //                 "reqId":"",
        //                 "side":"sell",
        //                 "slOrdPx":"",
        //                 "slTriggerPx":"",
        //                 "state":"live",
        //                 "sz":"0.007526",
        //                 "tag":"",
        //                 "tdMode":"cash",
        //                 "tgtCcy":"",
        //                 "tpOrdPx":"",
        //                 "tpTriggerPx":"",
        //                 "tradeId":"",
        //                 "uTime":"1634548275191"
        //             }
        //         ]
        //     }
        //
        const arg = this.safeValue (message, 'arg', {});
        const channel = this.safeString (arg, 'channel');
        const rawOrders = this.safeValue (message, 'data', []);
        const filteredOrders = [];
        // filter orders with no last trade id
        for (let i = 0; i < rawOrders.length; i++) {
            const rawOrder = rawOrders[i];
            const tradeId = this.safeString (rawOrder, 'tradeId');
            if (!this.isEmpty (tradeId)) {
                const order = this.parseOrder (rawOrder);
                filteredOrders.push (order);
            }
        }
        const tradesLength = filteredOrders.length;
        if (tradesLength === 0) {
            return;
        }
        if (this.myTrades === undefined) {
            const limit = this.safeInteger (this.options, 'tradesLimit', 1000);
            this.myTrades = new ArrayCacheBySymbolById (limit);
        }
        const myTrades = this.myTrades;
        const symbols = {};
        for (let i = 0; i < filteredOrders.length; i++) {
            const rawTrade = filteredOrders[i];
            const trade = this.orderToTrade (rawTrade);
            myTrades.append (trade);
            const symbol = trade['symbol'];
            symbols[symbol] = true;
        }
        const messageHash = channel + '::myTrades';
        client.resolve (this.myTrades, messageHash);
        const tradeSymbols = Object.keys (symbols);
        for (let i = 0; i < tradeSymbols.length; i++) {
            const symbolMessageHash = messageHash + '::' + tradeSymbols[i];
            client.resolve (this.orders, symbolMessageHash);
        }
    }

    async createOrderWs (symbol: string, type: OrderType, side: OrderSide, amount: number, price: number = undefined, params = {}) {
        /**
         * @method
         * @name okx#createOrderWs
         * @see https://www.okx.com/docs-v5/en/#websocket-api-trade-place-order
         * @description create a trade order
         * @param {string} symbol unified symbol of the market to create an order in
         * @param {string} type 'market' or 'limit'
         * @param {string} side 'buy' or 'sell'
         * @param {float} amount how much of currency you want to trade in units of base currency
         * @param {float|undefined} [price] the price at which the order is to be fullfilled, in units of the quote currency, ignored in market orders
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @param {boolean} params.test test order, default false
         * @returns {object} an [order structure]{@link https://github.com/ccxt/ccxt/wiki/Manual#order-structure}
         */
        await this.loadMarkets ();
        await this.authenticate ();
        const url = this.getUrl ('private', 'private');
        const messageHash = this.nonce ().toString ();
        let op = undefined;
        [ op, params ] = this.handleOptionAndParams (params, 'createOrderWs', 'op', 'batch-orders');
        const args = this.createOrderRequest (symbol, type, side, amount, price, params);
        const ordType = this.safeString (args, 'ordType');
        if ((ordType === 'trigger') || (ordType === 'conditional') || (type === 'oco') || (type === 'move_order_stop') || (type === 'iceberg') || (type === 'twap')) {
            throw new BadRequest (this.id + ' createOrderWs() does not support algo trading. this.options["createOrderWs"]["op"] must be either order or batch-order');
        }
        if ((op !== 'order') && (op !== 'batch-orders')) {
            throw new BadRequest (this.id + ' createOrderWs() does not support algo trading. this.options["createOrderWs"]["op"] must be either order or privatePostTradeOrder or privatePostTradeOrderAlgo');
        }
        const request = {
            'id': messageHash,
            'op': op,
            'args': [ args ],
        };
        return await this.watch (url, messageHash, request, messageHash);
    }

    handlePlaceOrders (client: Client, message) {
        //
        //  batch-orders/order/cancel-order
        //    {
        //        id: '1689281055',
        //        op: 'batch-orders',
        //        code: '0',
        //        msg: '',
        //        data: [{
        //            tag: 'e847386590ce4dBC',
        //            ordId: '599823446566084608',
        //            clOrdId: 'e847386590ce4dBCb939511604f394b0',
        //            sCode: '0',
        //            sMsg: 'Order successfully placed.'
        //        },
        //        ...
        //        ]
        //    }
        //
        const messageHash = this.safeString (message, 'id');
        let args = this.safeValue (message, 'data', []);
        // filter out partial errors
        args = this.filterBy (args, 'sCode', '0');
        // if empty means request failed and handle error
        if (this.isEmpty (args)) {
            const method = this.safeString (message, 'op');
            const stringMsg = this.json (message);
            this.handleErrors (undefined, undefined, client.url, method, undefined, stringMsg, stringMsg, undefined, undefined);
        }
        const orders = this.parseOrders (args, undefined, undefined, undefined);
        client.resolve (orders, messageHash);
    }

    async editOrderWs (id: string, symbol: string, type: OrderType, side: OrderSide, amount: number, price: number = undefined, params = {}) {
        /**
         * @method
         * @name okx#editOrderWs
         * @description edit a trade order
         * @see https://www.okx.com/docs-v5/en/#order-book-trading-trade-ws-amend-order
         * @see https://www.okx.com/docs-v5/en/#order-book-trading-trade-ws-amend-multiple-orders
         * @param {string} id order id
         * @param {string} symbol unified symbol of the market to create an order in
         * @param {string} type 'market' or 'limit'
         * @param {string} side 'buy' or 'sell'
         * @param {float} amount how much of the currency you want to trade in units of the base currency
         * @param {float|undefined} [price] the price at which the order is to be fullfilled, in units of the quote currency, ignored in market orders
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @returns {object} an [order structure]{@link https://github.com/ccxt/ccxt/wiki/Manual#order-structure}
         */
        await this.loadMarkets ();
        await this.authenticate ();
        const url = this.getUrl ('private', 'private');
        const messageHash = this.nonce ().toString ();
        let op = undefined;
        [ op, params ] = this.handleOptionAndParams (params, 'editOrderWs', 'op', 'amend-order');
        const args = this.editOrderRequest (id, symbol, type, side, amount, price, params);
        const request = {
            'id': messageHash,
            'op': op,
            'args': [ args ],
        };
        return await this.watch (url, messageHash, this.extend (request, params), messageHash);
    }

    async cancelOrderWs (id: string, symbol: string = undefined, params = {}) {
        /**
         * @method
         * @name okx#cancelOrderWs
         * @see https://okx-docs.github.io/apidocs/websocket_api/en/#cancel-order-trade
         * @description cancel multiple orders
         * @param {string} id order id
         * @param {string} symbol unified market symbol, default is undefined
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @param {string} [params.clOrdId] client order id
         * @returns {object} an list of [order structures]{@link https://github.com/ccxt/ccxt/wiki/Manual#order-structure}
         */
        if (symbol === undefined) {
            throw new BadRequest (this.id + ' cancelOrderWs() requires a symbol argument');
        }
        await this.loadMarkets ();
        await this.authenticate ();
        const url = this.getUrl ('private', 'private');
        const messageHash = this.nonce ().toString ();
        const clientOrderId = this.safeString2 (params, 'clOrdId', 'clientOrderId');
        params = this.omit (params, [ 'clientOrderId', 'clOrdId' ]);
        const arg = {
            'instId': this.marketId (symbol),
        };
        if (clientOrderId !== undefined) {
            arg['clOrdId'] = clientOrderId;
        } else {
            arg['ordId'] = id;
        }
        const request = {
            'id': messageHash,
            'op': 'cancel-order',
            'args': [ this.extend (arg, params) ],
        };
        return await this.watch (url, messageHash, request, messageHash);
    }

    async cancelOrdersWs (ids: string[], symbol: string = undefined, params = {}) {
        /**
         * @method
         * @name okx#cancelOrdersWs
         * @see https://www.okx.com/docs-v5/en/#order-book-trading-trade-ws-mass-cancel-order
         * @description cancel multiple orders
         * @param {string[]} ids order ids
         * @param {string} symbol unified market symbol, default is undefined
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @returns {object} an list of [order structures]{@link https://github.com/ccxt/ccxt/wiki/Manual#order-structure}
         */
        const idsLength = ids.length;
        if (idsLength > 20) {
            throw new BadRequest (this.id + ' cancelOrdersWs() accepts up to 20 ids at a time');
        }
        if (symbol === undefined) {
            throw new BadRequest (this.id + ' cancelOrdersWs() requires a symbol argument');
        }
        await this.loadMarkets ();
        await this.authenticate ();
        const url = this.getUrl ('private', 'private');
        const messageHash = this.nonce ().toString ();
        const args = [];
        for (let i = 0; i < idsLength; i++) {
            const arg = {
                'instId': this.marketId (symbol),
                'ordId': ids[i],
            };
            args.push (arg);
        }
        const request = {
            'id': messageHash,
            'op': 'batch-cancel-orders',
            'args': args,
        };
        return await this.watch (url, messageHash, this.deepExtend (request, params), messageHash);
    }

    async cancelAllOrdersWs (symbol: string = undefined, params = {}) {
        /**
         * @method
         * @name okx#cancelAllOrdersWs
         * @see https://docs.okx.com/websockets/#message-cancelAll
         * @description cancel all open orders of a type. Only applicable to Option in Portfolio Margin mode, and MMP privilege is required.
         * @param {string} symbol unified market symbol, only orders in the market of this symbol are cancelled when symbol is not undefined
         * @param {object} [params] extra parameters specific to the okx api endpoint
         * @returns {object[]} a list of [order structures]{@link https://github.com/ccxt/ccxt/wiki/Manual#order-structure}
         */
        if (symbol === undefined) {
            throw new BadRequest (this.id + ' cancelAllOrdersWs() requires a symbol argument');
        }
        await this.loadMarkets ();
        await this.authenticate ();
        const market = this.market (symbol);
        if (market['type'] !== 'option') {
            throw new BadRequest (this.id + 'cancelAllOrdersWs is only applicable to Option in Portfolio Margin mode, and MMP privilege is required.');
        }
        const url = this.getUrl ('private', 'private');
        const messageHash = this.nonce ().toString ();
        const request = {
            'id': messageHash,
            'op': 'mass-cancel',
            'args': [ this.extend ({
                'instType': 'OPTION',
                'instFamily': market['id'],
            }, params) ],
        };
        return await this.watch (url, messageHash, request, messageHash);
    }

    handleCancelAllOrders (client: Client, message) {
        //
        //    {
        //        "id": "1512",
        //        "op": "mass-cancel",
        //        "data": [
        //            {
        //                "result": true
        //            }
        //        ],
        //        "code": "0",
        //        "msg": ""
        //    }
        //
        const messageHash = this.safeString (message, 'id');
        const data = this.safeValue (message, 'data', []);
        client.resolve (data, messageHash);
    }

    handleSubscriptionStatus (client: Client, message) {
        //
        //     { event: 'subscribe', arg: { channel: 'tickers', instId: 'BTC-USDT' } }
        //
        // const channel = this.safeString (message, 'channel');
        // client.subscriptions[channel] = message;
        return message;
    }

    handleAuthenticate (client: Client, message) {
        //
        //     { event: 'login', success: true }
        //
        const future = this.safeValue (client.futures, 'authenticated');
        future.resolve (true);
    }

    ping (client) {
        // okex does not support built-in ws protocol-level ping-pong
        // instead it requires custom text-based ping-pong
        return 'ping';
    }

    handlePong (client: Client, message) {
        client.lastPong = this.milliseconds ();
        return message;
    }

    handleErrorMessage (client: Client, message) {
        //
        //     { event: 'error', msg: 'Illegal request: {"op":"subscribe","args":["spot/ticker:BTC-USDT"]}', code: '60012' }
        //     { event: 'error', msg: "channel:ticker,instId:BTC-USDT doesn't exist", code: '60018' }
        //
        const errorCode = this.safeInteger (message, 'code');
        try {
            if (errorCode) {
                const feedback = this.id + ' ' + this.json (message);
                this.throwExactlyMatchedException (this.exceptions['exact'], errorCode, feedback);
                const messageString = this.safeValue (message, 'msg');
                if (messageString !== undefined) {
                    this.throwBroadlyMatchedException (this.exceptions['broad'], messageString, feedback);
                }
            }
        } catch (e) {
            if (e instanceof AuthenticationError) {
                const messageHash = 'authenticated';
                client.reject (e, messageHash);
                if (messageHash in client.subscriptions) {
                    delete client.subscriptions[messageHash];
                }
                return false;
            } else {
                client.reject (e);
            }
        }
        return message;
    }

    handleMessage (client: Client, message) {
        if (!this.handleErrorMessage (client, message)) {
            return;
        }
        //
        //     { event: 'subscribe', arg: { channel: 'tickers', instId: 'BTC-USDT' } }
        //     { event: 'login', msg: '', code: '0' }
        //
        //     {
        //         arg: { channel: 'tickers', instId: 'BTC-USDT' },
        //         data: [
        //             {
        //                 instType: 'SPOT',
        //                 instId: 'BTC-USDT',
        //                 last: '31500.1',
        //                 lastSz: '0.00001754',
        //                 askPx: '31500.1',
        //                 askSz: '0.00998144',
        //                 bidPx: '31500',
        //                 bidSz: '3.05652439',
        //                 open24h: '31697',
        //                 high24h: '32248',
        //                 low24h: '31165.6',
        //                 sodUtc0: '31385.5',
        //                 sodUtc8: '32134.9',
        //                 volCcy24h: '503403597.38138519',
        //                 vol24h: '15937.10781721',
        //                 ts: '1626526618762'
        //             }
        //         ]
        //     }
        //
        //     { event: 'error', msg: 'Illegal request: {"op":"subscribe","args":["spot/ticker:BTC-USDT"]}', code: '60012' }
        //     { event: 'error', msg: "channel:ticker,instId:BTC-USDT doesn't exist", code: '60018' }
        //     { event: 'error', msg: 'Invalid OK_ACCESS_KEY', code: '60005' }
        //     {
        //         event: 'error',
        //         msg: 'Illegal request: {"op":"login","args":["de89b035-b233-44b2-9a13-0ccdd00bda0e","7KUcc8YzQhnxBE3K","1626691289","H57N99mBt5NvW8U19FITrPdOxycAERFMaapQWRqLaSE="]}',
        //         code: '60012'
        //     }
        //
        //
        //
        if (message === 'pong') {
            return this.handlePong (client, message);
        }
        // const table = this.safeString (message, 'table');
        // if (table === undefined) {
        const event = this.safeString2 (message, 'event', 'op');
        if (event !== undefined) {
            const methods = {
                // 'info': this.handleSystemStatus,
                // 'book': 'handleOrderBook',
                'login': this.handleAuthenticate,
                'subscribe': this.handleSubscriptionStatus,
                'order': this.handlePlaceOrders,
                'batch-orders': this.handlePlaceOrders,
                'amend-order': this.handlePlaceOrders,
                'batch-amend-orders': this.handlePlaceOrders,
                'cancel-order': this.handlePlaceOrders,
                'mass-cancel': this.handleCancelAllOrders,
            };
            const method = this.safeValue (methods, event);
            if (method === undefined) {
                return message;
            } else {
                return method.call (this, client, message);
            }
        } else {
            const arg = this.safeValue (message, 'arg', {});
            const channel = this.safeString (arg, 'channel');
            const methods = {
                'bbo-tbt': this.handleOrderBook, // newly added channel that sends tick-by-tick Level 1 data, all API users can subscribe, public depth channel, verification not required
                'books': this.handleOrderBook, // all API users can subscribe, public depth channel, verification not required
                'books5': this.handleOrderBook, // all API users can subscribe, public depth channel, verification not required, data feeds will be delivered every 100ms (vs. every 200ms now)
                'books50-l2-tbt': this.handleOrderBook, // only users who're VIP4 and above can subscribe, identity verification required before subscription
                'books-l2-tbt': this.handleOrderBook, // only users who're VIP5 and above can subscribe, identity verification required before subscription
                'tickers': this.handleTicker,
                'index-tickers': this.handleTicker,
                'sprd-tickers': this.handleTicker,
                'block-tickers': this.handleTicker,
                'trades': this.handleTrades,
                'account': this.handleBalance,
                // 'margin_account': this.handleBalance,
                'orders': this.handleOrders,
                'orders-algo': this.handleOrders,
            };
            const method = this.safeValue (methods, channel);
            if (method === undefined) {
                if (channel.indexOf ('candle') === 0) {
                    this.handleOHLCV (client, message);
                } else {
                    return message;
                }
            } else {
                return method.call (this, client, message);
            }
        }
    }
}
