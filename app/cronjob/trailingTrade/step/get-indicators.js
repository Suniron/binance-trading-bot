/* eslint-disable prefer-destructuring */
const _ = require('lodash');
const moment = require('moment');
const { cache } = require('../../../helpers');
const { getLastBuyPrice } = require('../../trailingTradeHelper/common');

/**
 * Get symbol information, buy/sell indicators
 *
 * @param {*} logger
 * @param {*} rawData
 */
const execute = async (logger, rawData) => {
  const data = rawData;

  const {
    symbol,
    symbolConfiguration: {
      buy: {
        triggerPercentage: buyTriggerPercentage,
        limitPercentage: buyLimitPercentage
      },
      sell: {
        triggerPercentage: sellTriggerPercentage,
        limitPercentage: sellLimitPercentage
      }
    },
    baseAssetBalance: { total: baseAssetTotalBalance },
    openOrders
  } = data;

  const cachedIndicator =
    JSON.parse(
      await cache.hget('trailing-trade-symbols', `${symbol}-indicator-data`)
    ) || {};

  if (_.isEmpty(cachedIndicator)) {
    logger.info('Indicator data is not retrieved, wait for cache.');
    data.saveToCache = false;
    return data;
  }

  const cachedLatestCandle =
    JSON.parse(
      await cache.hget('trailing-trade-symbols', `${symbol}-latest-candle`)
    ) || {};

  if (_.isEmpty(cachedLatestCandle)) {
    logger.info('Last candle is not retrieved, wait for cache.');
    data.saveToCache = false;
    return data;
  }

  // Set last candle
  data.lastCandle = cachedLatestCandle;
  // Merge indicator data
  data.indicators = {
    ...data.indicators,
    ...cachedIndicator
  };

  // Cast string to number
  const lowestPrice = data.indicators.lowestPrice;
  const currentPrice = parseFloat(cachedLatestCandle.close);
  const buyTriggerPrice = lowestPrice * buyTriggerPercentage;
  const buyDifference = (1 - currentPrice / buyTriggerPrice) * -100;
  const buyLimitPrice = currentPrice * buyLimitPercentage;

  // Get last buy price
  const lastBuyPrice = await getLastBuyPrice(logger, symbol);
  const sellTriggerPrice =
    lastBuyPrice > 0 ? lastBuyPrice * sellTriggerPercentage : null;
  const sellDifference =
    lastBuyPrice > 0 ? (1 - sellTriggerPrice / currentPrice) * 100 : null;
  const sellLimitPrice = currentPrice * sellLimitPercentage;

  // Estimate value
  const baseAssetEstimatedValue = baseAssetTotalBalance * currentPrice;

  const sellCurrentProfit =
    lastBuyPrice > 0
      ? (currentPrice - lastBuyPrice) * baseAssetTotalBalance
      : null;

  const sellCurrentProfitPercentage =
    lastBuyPrice > 0 ? (1 - lastBuyPrice / currentPrice) * 100 : null;

  // Reorganise open orders
  const newOpenOrders = openOrders.map(order => {
    const newOrder = order;
    newOrder.currentPrice = currentPrice;
    newOrder.updatedAt = moment(order.time).utc();

    if (order.type !== 'STOP_LOSS_LIMIT') {
      return newOrder;
    }

    if (order.side.toLowerCase() === 'buy') {
      newOrder.limitPrice = buyLimitPrice;
      newOrder.limitPercentage = buyLimitPercentage;
      newOrder.differenceToExecute =
        (1 - parseFloat(order.stopPrice / currentPrice)) * 100;

      newOrder.differenceToCancel =
        (1 - parseFloat(order.stopPrice / buyLimitPrice)) * 100;
    }

    if (order.side.toLowerCase() === 'sell') {
      newOrder.limitPrice = sellLimitPrice;
      newOrder.limitPercentage = sellLimitPercentage;
      newOrder.differenceToExecute =
        (1 - parseFloat(order.stopPrice / currentPrice)) * 100;
      newOrder.differenceToCancel =
        (1 - parseFloat(order.stopPrice / sellLimitPrice)) * 100;

      newOrder.minimumProfit = null;
      newOrder.minimumProfitPercentage = null;
      if (lastBuyPrice > 0) {
        newOrder.minimumProfit =
          (parseFloat(order.price) - lastBuyPrice) * parseFloat(order.origQty);
        newOrder.minimumProfitPercentage =
          (1 - lastBuyPrice / parseFloat(order.price)) * 100;
      }
    }
    return newOrder;
  });

  // Populate data
  data.baseAssetBalance.estimatedValue = baseAssetEstimatedValue;

  data.buy = {
    currentPrice,
    limitPrice: buyLimitPrice,
    lowestPrice,
    triggerPrice: buyTriggerPrice,
    difference: buyDifference,
    openOrders: newOpenOrders?.filter(o => o.side.toLowerCase() === 'buy'),
    processMesage: '',
    updatedAt: moment().utc()
  };

  data.sell = {
    currentPrice,
    limitPrice: sellLimitPrice,
    lastBuyPrice,
    triggerPrice: sellTriggerPrice,
    difference: sellDifference,
    currentProfit: sellCurrentProfit,
    currentProfitPercentage: sellCurrentProfitPercentage,
    openOrders: newOpenOrders?.filter(o => o.side.toLowerCase() === 'sell'),
    processMessage: '',
    updatedAt: moment().utc()
  };

  return data;
};

module.exports = { execute };