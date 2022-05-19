'use strict';

//  ---------------------------------------------------------------------------

const ccxt = require ('ccxt');
// BadSymbol, BadRequest
const { AuthenticationError } = require ('ccxt/js/base/errors');
const { ArrayCache, ArrayCacheBySymbolById, ArrayCacheByTimestamp } = require ('./base/Cache');

//  ---------------------------------------------------------------------------

module.exports = class bybit extends ccxt.bybit {
    describe () {
        return this.deepExtend (super.describe (), {
            'has': {
                'ws': true,
                'watchBalance': true,
                'watchMyTrades': false,
                'watchOHLCV': true,
                'watchOrderBook': true,
                'watchOrders': true,
                'watchTicker': true,
                'watchTickers': false, // for now
                'watchTrades': true,
            },
            'urls': {
                'api': {
                    'ws': {
                        'inverse': {
                            'public': 'wss://stream.{hostname}/realtime',
                            'private': 'wss://stream.{hostname}/realtime',
                        },
                        'linear': {
                            'public': 'wss://stream.{hostname}/realtime_public',
                            'private': 'wss://stream.{hostname}/realtime_private',
                        },
                        'spot': {
                            'public': 'wss://stream.{hostname}/spot/quote/ws/v2',
                            'private': 'wss://stream.{hostname}/spot/ws',
                        },
                        'usdc': {
                            'option': {
                                'public': 'wss://stream.{hostname}/trade/option/usdc/public/v1',
                                'private': 'wss://stream.{hostname}/trade/option/usdc/private/v1',
                            },
                            'swap': {
                                'public': 'wss://stream.{hostname}/perpetual/ws/v1/realtime_public',
                                'private': 'wss://stream.{hostname}/trade/option/usdc/private/v1', // check this
                            },
                        },
                    },
                },
                'test': {
                    'ws': {
                        'inverse': {
                            'public': 'wss://stream-testnet.{hostname}/realtime',
                            'private': 'wss://stream-testnet.{hostname}/realtime',
                        },
                        'linear': {
                            'public': 'wss://stream-testnet.{hostname}/realtime_public',
                            'private': 'wss://stream-testnet.{hostname}/realtime_private',
                        },
                        'spot': {
                            'public': 'wss://stream-testnet.{hostname}/spot/quote/ws/v2',
                            'private': 'wss://stream-testnet.{hostname}/spot/ws',
                        },
                        'usdc': {
                            'option': {
                                'public': 'wss://stream-testnet.{hostname}/trade/option/usdc/public/v1',
                                'private': 'wss://stream-testnet.{hostname}/trade/option/usdc/private/v1',
                            },
                            'swap': {
                                'public': 'wss://stream-testnet.{hostname}/perpetual/ws/v1/realtime_public',
                                'private': 'wss://stream-testnet.{hostname}/trade/option/usdc/private/v1', // check this
                            },
                        },
                    },
                },
            },
            'options': {
            },
            'streaming': {
                'ping': this.ping,
            },
            'exceptions': {
                'ws': {
                    'exact': {
                    },
                },
            },
        });
    }

    getUrlByMarketType (symbol = undefined, isPrivate = false, params = {}) {
        const accessibility = isPrivate ? 'private' : 'public';
        let url = this.urls['api']['ws'];
        const market = this.market (symbol);
        const isUsdcSettled = market['settle'] === 'USDC';
        const isSpot = market['spot'];
        const type = market['type'];
        const isLinear = market['linear'];
        if (isSpot) {
            url = url['spot'][accessibility];
        } else if (isUsdcSettled) {
            url = url['usdc'][type][accessibility];
        } else if (isLinear) {
            url = url['linear'][accessibility];
        } else {
            // inverse
            url = url['inverse'][accessibility];
        }
        url = this.implodeHostname (url);
        return [url, params];
    }

    async watchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const messageHash = 'ticker:' + market['symbol'];
        let url = undefined;
        [ url, params ] = this.getUrlByMarketType (symbol, false, params);
        if (market['spot']) {
            const channel = 'realtimes';
            const reqParams = {
                'symbol': market['id'],
            };
            return await this.watchSpotPublic (url, channel, messageHash, reqParams, params);
        } else {
            const channel = 'instrument_info.100ms.' + market['id'];
            const reqParams = [ channel ];
            return await this.watchSwapPublic (url, messageHash, reqParams, params);
        }
    }

    handleTicker (client, message) {
        //
        //  spot
        //    {
        //        topic: 'realtimes',
        //        params: { symbol: 'BTCUSDT', binary: 'false', symbolName: 'BTCUSDT' },
        //        data: {
        //          t: 1652883737410,
        //          s: 'BTCUSDT',
        //          o: '30422.68',
        //          h: '30715',
        //          l: '29288.44',
        //          c: '29462.94',
        //          v: '4350.340495',
        //          qv: '130497543.0334267',
        //          m: '-0.0315'
        //        }
        //    }
        //
        // swap/futures use an incremental approach sending first the snapshot and then the updates
        //
        // snapshot message
        //     {
        //         "topic":"instrument_info.100ms.BTCUSDT",
        //         "type":"snapshot",
        //         "data":{
        //            "id":1,
        //            "symbol":"BTCUSDT",
        //            "last_price_e4":"291050000",
        //            "last_price":"29105.00",
        //            "bid1_price_e4":"291045000",
        //            "bid1_price":"29104.50",
        //            "ask1_price_e4":"291050000",
        //            "ask1_price":"29105.00",
        //            "last_tick_direction":"ZeroPlusTick",
        //            "prev_price_24h_e4":"297900000",
        //            "prev_price_24h":"29790.00",
        //            "price_24h_pcnt_e6":"-22994",
        //            "high_price_24h_e4":"300200000",
        //            "high_price_24h":"30020.00",
        //            "low_price_24h_e4":"286330000",
        //            "low_price_24h":"28633.00",
        //            "prev_price_1h_e4":"291435000",
        //            "prev_price_1h":"29143.50",
        //            "price_1h_pcnt_e6":"-1321",
        //            "mark_price_e4":"291148200",
        //            "mark_price":"29114.82",
        //            "index_price_e4":"291173600",
        //            "index_price":"29117.36",
        //            "open_interest_e8":"2725210700000",
        //            "total_turnover_e8":"6184585271557950000",
        //            "turnover_24h_e8":"373066109692150560",
        //            "total_volume_e8":"3319897492699924",
        //            "volume_24h_e8":"12774825300000",
        //            "funding_rate_e6":"-97",
        //            "predicted_funding_rate_e6":"100",
        //            "cross_seq":"11834024892",
        //            "created_at":"1970-01-01T00:00:00.000Z",
        //            "updated_at":"2022-05-19T08:52:10.000Z",
        //            "next_funding_time":"2022-05-19T16:00:00Z",
        //            "count_down_hour":"8",
        //            "funding_rate_interval":"8",
        //            "settle_time_e9":"0",
        //            "delisting_status":"0"
        //         },
        //         "cross_seq":"11834024953",
        //         "timestamp_e6":"1652950330515050"
        //     }
        //
        // update message
        //    {
        //        "topic":"instrument_info.100ms.BTCUSDT",
        //        "type":"delta",
        //        "data":{
        //           "update":[
        //              {
        //                 "id":1,
        //                 "symbol":"BTCUSDT",
        //                 "open_interest_e8":"2721359000000",
        //                 "cross_seq":"11834107074",
        //                 "created_at":"1970-01-01T00:00:00.000Z",
        //                 "updated_at":"2022-05-19T08:54:18.000Z"
        //              }
        //           ]
        //        },
        //        "cross_seq":"11834107125",
        //        "timestamp_e6":"1652950458616087"
        //    }
        //
        const topic = this.safeString (message, 'topic', '');
        if (topic === 'realtimes') {
            // spot markets
            const data = this.safeValue (message, 'data');
            const ticker = this.parseTicker (data);
            const symbol = ticker['symbol'];
            this.tickers[symbol] = ticker;
            const messageHash = 'ticker:' + symbol;
            client.resolve (ticker, messageHash);
            return;
        }
        const type = this.safeString (message, 'type', '');
        const data = this.safeValue (message, 'data', {});
        let symbol = undefined;
        if (type === 'snapshot') {
            const parsed = this.parseTicker (data);
            symbol = parsed['symbol'];
            this.tickers[symbol] = parsed;
        }
        if (type === 'delta') {
            const topicParts = topic.split ('.');
            const topicLength = topicParts.length;
            const marketId = this.safeString (topicParts, topicLength - 1);
            const market = this.market (marketId);
            symbol = market['symbol'];
            const updates = this.safeValue (data, 'update', []);
            let ticker = this.safeValue (this.tickers, symbol, {});
            for (let i = 0; i < updates.length; i++) {
                const update = updates[i];
                ticker = this.updateTicker (ticker, update);
            }
            this.tickers[symbol] = ticker;
        }
        const messageHash = 'ticker:' + symbol;
        client.resolve (this.tickers[symbol], messageHash);
    }

    updateTicker (ticker, update) {
        // First we update the raw ticker with the new values
        // then we parse it again, although we could just
        // update the changed values in the already parsed ticker
        // doing that would lead to an inconsistent info object
        // inside ticker
        const rawTicker = ticker['info'];
        const updateKeys = Object.keys (update);
        const updateLength = updateKeys.length;
        if (updateLength > 0) {
            for (let i = 0; i < updateKeys.length; i++) {
                const key = updateKeys[i];
                if (key in rawTicker) {
                    rawTicker[key] = update[key];
                }
            }
            const parsed = this.parseTicker (rawTicker);
            return parsed;
        }
        return ticker;
    }

    async watchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const interval = this.timeframes[timeframe];
        let url = undefined;
        [ url, params ] = this.getUrlByMarketType (symbol, false, params);
        const messageHash = 'kline' + ':' + timeframe + ':' + symbol;
        let ohlcv = undefined;
        if (market['spot']) {
            const channel = 'kline';
            const reqParams = {
                'symbol': market['id'],
                'klineType': timeframe, // spot uses the same timeframe as ours
            };
            ohlcv = await this.watchSpotPublic (url, channel, messageHash, reqParams, params);
        } else {
            const prefix = market['linear'] ? 'candle' : 'klineV2';
            const channel = prefix + '.' + interval + '.' + market['id'];
            const reqParams = [ channel ];
            ohlcv = await this.watchSwapPublic (url, messageHash, reqParams, params);
        }
        if (this.newUpdates) {
            limit = ohlcv.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (ohlcv, since, limit, 0, true);
    }

    handleOHLCV (client, message) {
        //
        // swap
        //    {
        //        topic: 'klineV2.1.LTCUSD',
        //        data: [
        //          {
        //            start: 1652893140,
        //            end: 1652893200,
        //            open: 67.9,
        //            close: 67.84,
        //            high: 67.91,
        //            low: 67.84,
        //            volume: 56,
        //            turnover: 0.82528936,
        //            timestamp: '1652893152874413',
        //            confirm: false,
        //            cross_seq: 63544166
        //          }
        //        ],
        //        timestamp_e6: 1652893152874413
        //    }
        //
        // spot
        //    {
        //        topic: 'kline',
        //        params: {
        //          symbol: 'LTCUSDT',
        //          binary: 'false',
        //          klineType: '1m',
        //          symbolName: 'LTCUSDT'
        //        },
        //        data: {
        //          t: 1652893440000,
        //          s: 'LTCUSDT',
        //          sn: 'LTCUSDT',
        //          c: '67.92',
        //          h: '68.05',
        //          l: '67.92',
        //          o: '68.05',
        //          v: '9.71302'
        //        }
        //    }
        //
        const data = this.safeValue (message, 'data', {});
        const topic = this.safeString (message, 'topic');
        if (Array.isArray (data)) {
            // swap messages
            const topicParts = topic.split ('.');
            const topicLength = topicParts.length;
            const marketId = this.safeString (topicParts, topicLength - 1);
            const timeframe = this.safeString (topicParts, topicLength - 2);
            const marketIds = {};
            for (let i = 0; i < data.length; i++) {
                const ohlcv = data[i];
                const market = this.market (marketId);
                const symbol = market['symbol'];
                const parsed = this.parseWsOHLCV (ohlcv, market);
                let stored = this.safeValue (this.ohlcvs, symbol);
                if (stored === undefined) {
                    const limit = this.safeInteger (this.options, 'OHLCVLimit', 1000);
                    stored = new ArrayCacheByTimestamp (limit);
                    this.ohlcvs[symbol] = stored;
                }
                stored.append (parsed);
                marketIds[symbol] = timeframe;
            }
            const keys = Object.keys (marketIds);
            for (let i = 0; i < keys.length; i++) {
                const symbol = keys[i];
                const interval = marketIds[symbol];
                const timeframe = this.findTimeframe (interval);
                const messageHash = 'kline' + ':' + timeframe + ':' + symbol;
                const stored = this.safeValue (this.ohlcvs, symbol);
                client.resolve (stored, messageHash);
            }
        } else {
            // spot messages
            const params = this.safeValue (message, 'params', {});
            const data = this.safeValue (message, 'data');
            const marketId = this.safeString (params, 'symbol');
            const timeframe = this.safeString (params, 'klineType');
            const market = this.market (marketId);
            const parsed = this.parseWsOHLCV (data, market);
            const symbol = market['symbol'];
            let stored = this.safeValue (this.ohlcvs, symbol);
            if (stored === undefined) {
                const limit = this.safeInteger (this.options, 'OHLCVLimit', 1000);
                stored = new ArrayCacheByTimestamp (limit);
                this.ohlcvs[symbol] = stored;
            }
            stored.append (parsed);
            const messageHash = 'kline' + ':' + timeframe + ':' + symbol;
            client.resolve (stored, messageHash);
        }
    }

    parseWsOHLCV (ohlcv, market = undefined) {
        //
        // swap
        //   {
        //      start: 1652893140,
        //      end: 1652893200,
        //      open: 67.9,
        //      close: 67.84,
        //      high: 67.91,
        //      low: 67.84,
        //      volume: 56,
        //      turnover: 0.82528936,
        //      timestamp: '1652893152874413',
        //      confirm: false,
        //      cross_seq: 63544166
        //   }
        //
        // spot
        //
        //   {
        //      t: 1652893440000,
        //      s: 'LTCUSDT',
        //      sn: 'LTCUSDT',
        //      c: '67.92',
        //      h: '68.05',
        //      l: '67.92',
        //      o: '68.05',
        //      v: '9.71302'
        //   }
        //
        return [
            this.safeInteger2 (ohlcv, 'timestamp', 't'),
            this.safeNumber2 (ohlcv, 'open', 'o'),
            this.safeNumber2 (ohlcv, 'high', 'h'),
            this.safeNumber2 (ohlcv, 'low', 'l'),
            this.safeNumber2 (ohlcv, 'close', 'c'),
            this.safeNumber2 (ohlcv, 'volume', 'v'),
        ];
    }

    async watchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const messageHash = 'orderbook' + ':' + market['id'];
        const orderbook = await this.watchPublic (messageHash, params);
        return orderbook.limit (limit);
    }

    handleOrderBook (client, message) {
        //
        //     {
        //         "topic":"orderbook",
        //         "action":"partial",
        //         "symbol":"ltc-usdt",
        //         "data":{
        //             "bids":[
        //                 [104.29, 5.2264],
        //                 [103.86,1.3629],
        //                 [101.82,0.5942]
        //             ],
        //             "asks":[
        //                 [104.81,9.5531],
        //                 [105.54,0.6416],
        //                 [106.18,1.4141],
        //             ],
        //             "timestamp":"2022-04-12T08:17:05.932Z"
        //         },
        //         "time":1649751425
        //     }
        //
        const marketId = this.safeString (message, 'symbol');
        const channel = this.safeString (message, 'topic');
        const market = this.safeMarket (marketId);
        const symbol = market['symbol'];
        const data = this.safeValue (message, 'data');
        let timestamp = this.safeString (data, 'timestamp');
        timestamp = this.parse8601 (timestamp);
        const snapshot = this.parseOrderBook (data, symbol, timestamp);
        let orderbook = undefined;
        if (!(symbol in this.orderbooks)) {
            orderbook = this.orderBook (snapshot);
            this.orderbooks[symbol] = orderbook;
        } else {
            orderbook = this.orderbooks[symbol];
            orderbook.reset (snapshot);
        }
        const messageHash = channel + ':' + marketId;
        client.resolve (orderbook, messageHash);
    }

    async watchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const messageHash = 'trade' + ':' + market['id'];
        const trades = await this.watchPublic (messageHash, params);
        if (this.newUpdates) {
            limit = trades.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (trades, since, limit, 'timestamp', true);
    }

    handleTrades (client, message) {
        //
        //     {
        //         topic: 'trade',
        //         action: 'partial',
        //         symbol: 'btc-usdt',
        //         data: [
        //             {
        //                 size: 0.05145,
        //                 price: 41977.9,
        //                 side: 'buy',
        //                 timestamp: '2022-04-11T09:40:10.881Z'
        //             },
        //         ]
        //     }
        //
        const channel = this.safeString (message, 'topic');
        const marketId = this.safeString (message, 'symbol');
        const market = this.safeMarket (marketId);
        const symbol = market['symbol'];
        let stored = this.safeValue (this.trades, symbol);
        if (stored === undefined) {
            const limit = this.safeInteger (this.options, 'tradesLimit', 1000);
            stored = new ArrayCache (limit);
            this.trades[symbol] = stored;
        }
        const data = this.safeValue (message, 'data', []);
        const parsedTrades = this.parseTrades (data, market);
        for (let j = 0; j < parsedTrades.length; j++) {
            stored.append (parsedTrades[j]);
        }
        const messageHash = channel + ':' + marketId;
        client.resolve (stored, messageHash);
        client.resolve (stored, channel);
    }

    async watchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let messageHash = 'order';
        let market = undefined;
        if (symbol !== undefined) {
            market = this.market (symbol);
            symbol = market['symbol'];
            messageHash += ':' + market['id'];
        }
        const orders = await this.watchPrivate (messageHash, 'watchOrders', params);
        if (this.newUpdates) {
            limit = orders.getLimit (symbol, limit);
        }
        return this.filterBySymbolSinceLimit (orders, symbol, since, limit, true);
    }

    handleOrder (client, message, subscription = undefined) {
        //
        //     {
        //         topic: 'order',
        //         action: 'insert',
        //         user_id: 155328,
        //         symbol: 'ltc-usdt',
        //         data: {
        //             symbol: 'ltc-usdt',
        //             side: 'buy',
        //             size: 0.05,
        //             type: 'market',
        //             price: 0,
        //             fee_structure: { maker: 0.1, taker: 0.1 },
        //             fee_coin: 'ltc',
        //             id: 'ce38fd48-b336-400b-812b-60c636454231',
        //             created_by: 155328,
        //             filled: 0.05,
        //             method: 'market',
        //             created_at: '2022-04-11T14:09:00.760Z',
        //             updated_at: '2022-04-11T14:09:00.760Z',
        //             status: 'filled'
        //         },
        //         time: 1649686140
        //     }
        //
        const channel = this.safeString (message, 'topic');
        const marketId = this.safeString (message, 'symbol');
        const data = this.safeValue (message, 'data', {});
        // usually the first message is an empty array
        const dataLength = data.length;
        if (dataLength === 0) {
            return 0;
        }
        const parsed = this.parseOrder (data);
        if (this.orders === undefined) {
            const limit = this.safeInteger (this.options, 'ordersLimit', 1000);
            this.orders = new ArrayCacheBySymbolById (limit);
        }
        const orders = this.orders;
        orders.append (parsed);
        client.resolve (orders);
        // non-symbol specific
        client.resolve (orders, channel);
        const messageHash = channel + ':' + marketId;
        client.resolve (orders, messageHash);
    }

    async watchBalance (params = {}) {
        const messageHash = 'wallet';
        return await this.watchPrivate (messageHash, 'watchBalance', params);
    }

    handleBalance (client, message) {
        //
        //     {
        //         topic: 'wallet',
        //         action: 'partial',
        //         user_id: 155328,
        //         data: {
        //             eth_balance: 0,
        //             eth_available: 0,
        //             usdt_balance: 18.94344188,
        //             usdt_available: 18.94344188,
        //             ltc_balance: 0.00005,
        //             ltc_available: 0.00005,
        //         },
        //         time: 1649687396
        //     }
        //
        const messageHash = this.safeString (message, 'topic');
        const data = this.safeValue (message, 'data');
        const keys = Object.keys (data);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const parts = key.split ('_');
            const currencyId = this.safeString (parts, 0);
            const code = this.safeCurrencyCode (currencyId);
            const account = (code in this.balance) ? this.balance[code] : this.account ();
            const second = this.safeString (parts, 1);
            const freeOrTotal = (second === 'available') ? 'free' : 'total';
            account[freeOrTotal] = this.safeString (data, key);
            this.balance[code] = account;
        }
        this.balance = this.safeBalance (this.balance);
        client.resolve (this.balance, messageHash);
    }

    async watchSwapPublic (url, messageHash, reqParams = {}, params = {}) {
        const request = {
            'op': 'subscribe',
            'args': reqParams,
        };
        const message = this.extend (request, params);
        return await this.watch (url, messageHash, message, messageHash);
    }

    async watchSpotPublic (url, channel, messageHash, reqParams = {}, params = {}) {
        reqParams = this.extend (reqParams, {
            'binary': false,
        });
        const request = {
            'topic': channel,
            'event': 'sub',
            'params': reqParams,
        };
        const message = this.extend (request, params);
        return await this.watch (url, messageHash, message, messageHash);
    }

    async watchPrivate (messageHash, method, params = {}) {
        const options = this.safeValue (this.options, method, {});
        let expires = this.safeString (options, 'api-expires');
        if (expires === undefined) {
            const timeout = parseInt (this.timeout / 1000);
            expires = this.sum (this.seconds (), timeout);
            expires = expires.toString ();
            // we need to memoize these values to avoid generating a new url on each method execution
            // that would trigger a new connection on each received message
            this.options[method]['api-expires'] = expires;
        }
        this.checkRequiredCredentials ();
        const url = this.urls['api']['ws'];
        const auth = 'CONNECT' + '/stream' + expires;
        const signature = this.hmac (this.encode (auth), this.encode (this.secret));
        const authParams = {
            'api-key': this.apiKey,
            'api-signature': signature,
            'api-expires': expires,
        };
        const signedUrl = url + '?' + this.urlencode (authParams);
        const request = {
            'op': 'subscribe',
            'args': [ messageHash ],
        };
        const message = this.extend (request, params);
        return await this.watch (signedUrl, messageHash, message, messageHash);
    }

    handleErrorMessage (client, message) {
        //
        //   {
        //       success: false,
        //       ret_msg: 'error:invalid op',
        //       conn_id: '5e079fdd-9c7f-404d-9dbf-969d650838b5',
        //       request: { op: '', args: null }
        //   }
        //
        //   { code: '-10009', desc: 'Invalid period!' }
        //
        const error = this.safeInteger (message, 'error');
        try {
            if (error !== undefined) {
                const feedback = this.id + ' ' + this.json (message);
                this.throwExactlyMatchedException (this.exceptions['ws']['exact'], error, feedback);
            }
        } catch (e) {
            if (e instanceof AuthenticationError) {
                return false;
            }
        }
        return message;
    }

    handleMessage (client, message) {
        //
        //    {
        //        topic: 'realtimes',
        //        params: { symbol: 'BTCUSDT', binary: 'false', symbolName: 'BTCUSDT' },
        //        data: {
        //          t: 1652883737410,
        //          s: 'BTCUSDT',
        //          o: '30422.68',
        //          h: '30715',
        //          l: '29288.44',
        //          c: '29462.94',
        //          v: '4350.340495',
        //          qv: '130497543.0334267',
        //          m: '-0.0315'
        //        }
        //    }
        //    {
        //        topic: 'klineV2.1.LTCUSD',
        //        data: [
        //          {
        //            start: 1652893140,
        //            end: 1652893200,
        //            open: 67.9,
        //            close: 67.84,
        //            high: 67.91,
        //            low: 67.84,
        //            volume: 56,
        //            turnover: 0.82528936,
        //            timestamp: '1652893152874413',
        //            confirm: false,
        //            cross_seq: 63544166
        //          }
        //        ],
        //        timestamp_e6: 1652893152874413
        //    }
        //
        //    {
        //        topic: 'kline',
        //        event: 'sub',
        //        params: {
        //          symbol: 'LTCUSDT',
        //          binary: 'false',
        //          klineType: '1m',
        //          symbolName: 'LTCUSDT'
        //        },
        //        code: '0',
        //        msg: 'Success'
        //    }
        //
        //
        if (!this.handleErrorMessage (client, message)) {
            return;
        }
        const event = this.safeString (message, 'event');
        if (event === 'sub') {
            this.handleSubscriptionStatus (client, message);
            return;
        }
        const topic = this.safeString (message, 'topic');
        if (topic !== undefined && (topic.indexOf ('kline') >= 0 || topic.indexOf ('candle') >= 0)) {
            this.handleOHLCV (client, message);
            return;
        }
        if (topic !== undefined && (topic.indexOf ('realtimes') >= 0 || topic.indexOf ('instrument_info') >= 0)) {
            this.handleTicker (client, message);
            return;
        }
        const methods = {
            'realtimes': this.handleTicker,
            'trade': this.handleTrades,
            'orderbook': this.handleOrderBook,
            'order': this.handleOrder,
            'wallet': this.handleBalance,
        };
        const method = this.safeValue (methods, topic);
        if (method !== undefined) {
            method.call (this, client, message);
        }
    }

    ping (client) {
        const timestamp = this.milliseconds ();
        return { 'ping': timestamp.toString () };
    }

    handlePong (client, message) {
        client.lastPong = this.milliseconds ();
        return message;
    }

    handleSubscriptionStatus (client, message) {
        //
        //    {
        //        topic: 'kline',
        //        event: 'sub',
        //        params: {
        //          symbol: 'LTCUSDT',
        //          binary: 'false',
        //          klineType: '1m',
        //          symbolName: 'LTCUSDT'
        //        },
        //        code: '0',
        //        msg: 'Success'
        //    }
        return message;
    }
};
