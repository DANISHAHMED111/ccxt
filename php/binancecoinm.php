<?php

namespace ccxt;

// PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:
// https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code

use Exception; // a common import

class binancecoinm extends binance {

    public function describe() {
        return $this->deep_extend(parent::describe (), array(
            'id' => 'binancecoinm',
            'name' => 'Binance COIN-M',
            'urls' => array(
                'logo' => 'https://user-images.githubusercontent.com/1294454/117738721-668c8d80-b205-11eb-8c49-3fad84c4a07f.jpg',
            ),
            'options' => array(
                'defaultType' => 'delivery',
                'leverageBrackets' => null,
            ),
            'has' => array(
                'fetchPositions' => true,
                'fetchIsolatedPositions' => true,
                'fetchFundingRate' => true,
                'fetchFundingHistory' => true,
            ),
            // https://www.binance.com/en/fee/deliveryFee
            'fees' => array(
                'trading' => array(
                    'tierBased' => true,
                    'percentage' => true,
                    'taker' => $this->parse_number('0.000500'),
                    'maker' => $this->parse_number('0.000100'),
                    'tiers' => array(
                        'taker' => array(
                            array( $this->parse_number('0'), $this->parse_number('0.000500') ),
                            array( $this->parse_number('250'), $this->parse_number('0.000450') ),
                            array( $this->parse_number('2500'), $this->parse_number('0.000400') ),
                            array( $this->parse_number('7500'), $this->parse_number('0.000300') ),
                            array( $this->parse_number('22500'), $this->parse_number('0.000250') ),
                            array( $this->parse_number('50000'), $this->parse_number('0.000240') ),
                            array( $this->parse_number('100000'), $this->parse_number('0.000240') ),
                            array( $this->parse_number('200000'), $this->parse_number('0.000240') ),
                            array( $this->parse_number('400000'), $this->parse_number('0.000240') ),
                            array( $this->parse_number('750000'), $this->parse_number('0.000240') ),
                        ),
                        'maker' => array(
                            array( $this->parse_number('0'), $this->parse_number('0.000100') ),
                            array( $this->parse_number('250'), $this->parse_number('0.000080') ),
                            array( $this->parse_number('2500'), $this->parse_number('0.000050') ),
                            array( $this->parse_number('7500'), $this->parse_number('0.0000030') ),
                            array( $this->parse_number('22500'), $this->parse_number('0') ),
                            array( $this->parse_number('50000'), $this->parse_number('-0.000050') ),
                            array( $this->parse_number('100000'), $this->parse_number('-0.000060') ),
                            array( $this->parse_number('200000'), $this->parse_number('-0.000070') ),
                            array( $this->parse_number('400000'), $this->parse_number('-0.000080') ),
                            array( $this->parse_number('750000'), $this->parse_number('-0.000090') ),
                        ),
                    ),
                ),
            ),
        ));
    }

    public function fetch_trading_fees($params = array ()) {
        $this->load_markets();
        $marketSymbols = is_array($this->markets) ? array_keys($this->markets) : array();
        $fees = array();
        $accountInfo = $this->dapiPrivateGetAccount ($params);
        //
        // {
        //      "canDeposit" => true,
        //      "canTrade" => true,
        //      "canWithdraw" => true,
        //      "$feeTier" => 2,
        //      "updateTime" => 0
        //      ...
        //  }
        //
        $feeTier = $this->safe_integer($accountInfo, 'feeTier');
        $feeTiers = $this->fees['trading']['tiers'];
        $maker = $feeTiers['maker'][$feeTier][1];
        $taker = $feeTiers['taker'][$feeTier][1];
        for ($i = 0; $i < count($marketSymbols); $i++) {
            $symbol = $marketSymbols[$i];
            $fees[$symbol] = array(
                'info' => array(
                    'feeTier' => $feeTier,
                ),
                'symbol' => $symbol,
                'maker' => $maker,
                'taker' => $taker,
            );
        }
        return $fees;
    }

    public function transfer_in($code, $amount, $params = array ()) {
        // transfer from spot wallet to coinm futures wallet
        return $this->futuresTransfer ($code, $amount, 3, $params);
    }

    public function transfer_out($code, $amount, $params = array ()) {
        // transfer from coinm futures wallet to spot wallet
        return $this->futuresTransfer ($code, $amount, 4, $params);
    }

    public function fetch_funding_rate($symbol = null, $params = null) {
        $this->load_markets();
        $market = null;
        $request = array();
        if ($symbol !== null) {
            $market = $this->market($symbol);
            $request['symbol'] = $market['id'];
        }
        $response = $this->dapiPublicGetPremiumIndex (array_merge($request, $params));
        //
        //   {
        //     "$symbol" => "BTCUSD",
        //     "markPrice" => "45802.81129892",
        //     "indexPrice" => "45745.47701915",
        //     "estimatedSettlePrice" => "45133.91753671",
        //     "lastFundingRate" => "0.00063521",
        //     "interestRate" => "0.00010000",
        //     "nextFundingTime" => "1621267200000",
        //     "time" => "1621252344001"
        //  }
        //
        if (gettype($response) === 'array' && count(array_filter(array_keys($response), 'is_string')) == 0) {
            $result = array();
            $values = is_array($response) ? array_values($response) : array();
            for ($i = 0; $i < count($values); $i++) {
                $parsed = $this->parseFundingRate ($values[$i]);
                $result[] = $parsed;
            }
            return $result;
        } else {
            return $this->parseFundingRate ($response);
        }
    }

    public function load_leverage_brackets($reload = false, $params = array ()) {
        $this->load_markets();
        // by default cache the leverage $bracket
        // it contains useful stuff like the maintenance margin and initial margin for positions
        if (($this->options['leverageBrackets'] === null) || ($reload)) {
            $response = $this->dapiPrivateGetLeverageBracket ($params);
            $this->options['leverageBrackets'] = array();
            for ($i = 0; $i < count($response); $i++) {
                $entry = $response[$i];
                $marketId = $this->safe_string($entry, 'pair');
                $normalizedMarketId = $marketId . '_PERP';
                $symbol = $this->safe_symbol($normalizedMarketId);
                $brackets = $this->safe_value($entry, 'brackets');
                $result = array();
                for ($j = 0; $j < count($brackets); $j++) {
                    $bracket = $brackets[$j];
                    // we use floats here internally on purpose
                    $qtyFloor = $this->safe_float($bracket, 'qtyFloor');
                    $maintenanceMarginPercentage = $this->safe_string($bracket, 'maintMarginRatio');
                    $result[] = array( $qtyFloor, $maintenanceMarginPercentage );
                }
                $this->options['leverageBrackets'][$symbol] = $result;
            }
        }
        return $this->options['leverageBrackets'];
    }

    public function fetch_positions($symbols = null, $params = array ()) {
        $this->load_markets();
        $this->load_leverage_brackets();
        $account = $this->dapiPrivateGetAccount ($params);
        $result = $this->parseAccountPositions ($account);
        if ($symbols === null) {
            return $result;
        } else {
            return $this->filter_by_array($result, 'symbol', $symbols);
        }
    }

    public function fetch_isolated_positions($symbol = null, $params = array ()) {
        // only supported in usdm futures
        $this->load_markets();
        $this->load_leverage_brackets();
        $request = array();
        $market = null;
        if ($symbol !== null) {
            $market = $this->market($symbol);
            $request['symbol'] = $market['id'];
        }
        $response = $this->dapiPrivateGetPositionRisk (array_merge($request, $params));
        if ($symbol === null) {
            $result = array();
            for ($i = 0; $i < count($response); $i++) {
                $parsed = $this->parsePositionRisk ($response[$i], $market);
                if ($parsed['marginType'] === 'isolated') {
                    $result[] = $parsed;
                }
            }
            return $result;
        } else {
            return $this->parsePositionRisk ($this->safe_value($response, 0), $market);
        }
    }

    public function fetch_funding_history($symbol = null, $since = null, $limit = null, $params = null) {
        $this->load_markets();
        $market = null;
        // "TRANSFER"，"WELCOME_BONUS", "REALIZED_PNL"，"FUNDING_FEE", "COMMISSION" and "INSURANCE_CLEAR"
        $request = array(
            'incomeType' => 'FUNDING_FEE',
        );
        if ($symbol !== null) {
            $market = $this->market($symbol);
            $request['symbol'] = $market['id'];
        }
        if ($since !== null) {
            $request['startTime'] = $since;
        }
        if ($limit !== null) {
            $request['limit'] = $limit;
        }
        $response = $this->dapiPrivateGetIncome (array_merge($request, $params));
        return $this->parseIncomes ($response, $market, $since, $limit);
    }
}
