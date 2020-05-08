import Exchange from '@oipwg/exchange-rate';
import uid from 'uid'
const events = require('events');
const emitter = new events()


const NiceHash = "NiceHash"
const MiningRigRentals = "MiningRigRentals"

import { toNiceHashPrice } from "./util";
import { ERROR, NORMAL, WARNING, LOW_BALANCE, LOW_HASHRATE, CUTOFF, RECEIPT } from "./constants";
const wss = require(process.cwd() + '/backend/routes/socket').wss;

wss.on('connection', (ws) => {
    emitter.on('message', (msg) => {
        ws.send(msg)
    })
});

/**
 * Manages Rentals of Miners from multiple API's
 */
class AutoRenter {
	/**
	 * [constructor description]
	 * @param  {Object} settings - The Options for the AutoRenter
	 * @param  {Array.<RentalProvider>} settings.rental_providers - The Rental Providers that you wish to use to rent miners.
	 * @return {Boolean}
	 */
    constructor(settings) {
        this.settings = settings
        this.rental_providers = settings.rental_providers
        this.exchange = new Exchange();
    }
    async updatePoolAddress(options) {
        let id;
        let walletAddress = options.address
        let pools = options.SpartanBot.returnPools('MiningRigRentals')
        if (pools.length === 0) {
            emitter.emit('message', JSON.stringify({
              update: true,
              message: `You have no pools, go back to setup and add your provider and finish adding a pool to continue.`,
              autoRent: false
            }));
            return {
              success: false,
              message: `Check messages for error.`,
            }
        }
        let _priority = pools[0].priority

        for (let pool of pools) {
            let priority = pool.priority

            if (priority > _priority) {
                _priority = priority
                id = pool.id
            }
        }
        // If all pools have the same priority or if there is only one pool it returns that id
        if (typeof id === 'undefined') id = pools[0].id
        try {
            let updatedPool = await options.SpartanBot.updatePool(id, {
                user: walletAddress
            })
            return updatedPool
        } catch (e) {
            return { success: false, error: e }
        }
    }

	/**
	 * Preprocess Rent for MiningRigRental Providers
	 * @param {Object} options - The Options for the rental operation
	 * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
	 * @param {Number} options.duration - The duration (in seconds) that you wish to rent hashrate for
	 * @returns {Promise<Object|Array.<Object>>}
	 */
    async mrrRentPreprocess(options) {
        // Switch hashrate to MH/s due to MRR accepts it that way
        let hashrate = options.hashrate * 1000000; //ToDo: make sure providers profileIDs aren't the same
        //get available rigs based on hashpower and duration

        let _provider;

        let mrr_providers = [];

        for (let provider of this.rental_providers) {
            if (provider.getInternalType() === "MiningRigRentals") {
                _provider = provider;
                mrr_providers.push(provider);
            }
        }

        if (!_provider) return {
            status: 'ERROR',
            success: false,
            message: 'No MRR Providers'
        };
        let addressSuccess;

        let addressUpdate = await this.updatePoolAddress(options)

        for (let update of addressUpdate) {
            addressSuccess = update.message.success
        }

        if (!addressSuccess) {
            return {
                status: 'ERROR',
                success: false,
                message: "Failed to get update new wallet address",
                error: addressUpdate.error
            };
        }

        let rigs_to_rent = [];
        try {
            rigs_to_rent = await _provider.getRigsToRent(hashrate, options.duration)
        } catch (err) {
            return { status: ERROR, market: MiningRigRentals, message: 'failed to fetch rigs from API', err }
        }

        //divvy up providers and create Provider object
        let providers = [], totalBalance = 0;
        for (let provider of mrr_providers) {
            //get the balance of each provider
            let balance
            try {
                balance = await provider.getBalance()
            } catch (err) {
                throw new Error(`Failed to get MRR balance: ${err}`)
            }
            if (isNaN(balance) && !balance.success) {
                return { status: ERROR, success: false, message: "Failed to get balance from API", error: balance }
            }

            totalBalance += balance
            //get the profile id needed to rent for each provider
            let profile = provider.returnActivePoolProfile() || await provider.getProfileID();
            providers.push({
                balance,
                profile,
                rigs_to_rent: [],
                uid: provider.getUID(),
                provider
            })
        }

        let hashrate_found = _provider.getTotalHashPower(rigs_to_rent)
        let cost_found = _provider.getRentalCost(rigs_to_rent)

        let hashratePerc = options.hashrate * .10
        let hashrateMin = options.hashrate - hashratePerc

        // console.log("total hashpower: ", hashpower_found)
        // console.log("total cost: ", cost_found)

        // ToDo: Consider not splitting the work up evenly and fill each to his balance first come first serve
        //load up work equally between providers. 1 and 1 and 1 and 1, etc
        let iterator = 0; //iterator is the index of the provider while, 'i' is the index of the rigs
        let len = providers.length
        for (let i = 0; i < rigs_to_rent.length; i++) {
            if (i === len || iterator === len) {
                iterator = 0
            }
            providers[iterator].rigs_to_rent.push(rigs_to_rent[i])
            iterator += 1
        }

        //remove from each provider rigs (s)he cannot afford
        let extra_rigs = []
        for (let p of providers) {
            let rental_cost = _provider.getRentalCost(p.rigs_to_rent);

            if (p.balance < rental_cost) {
                while (p.balance < rental_cost && p.rigs_to_rent.length > 0) {
                    // console.log(`balance: ${p.balance}\nRental cost: ${rental_cost}\nOver Under: ${p.balance-rental_cost}\nAmount substracted -${p.rigs_to_rent[0].btc_price}\nLeft Over: ${rental_cost-p.rigs_to_rent[0].btc_price}`)
                    let tmpRig;
                    [tmpRig] = p.rigs_to_rent.splice(0, 1)
                    extra_rigs.push(tmpRig)

                    rental_cost = _provider.getRentalCost(p.rigs_to_rent)
                }
            }
        }

        //add up any additional rigs that a provider may have room for
        for (let p of providers) {
            let rental_cost = _provider.getRentalCost(p.rigs_to_rent);
            if (p.balance > rental_cost) {
                for (let i = extra_rigs.length - 1; i >= 0; i--) {
                    if ((extra_rigs[i].btc_price + rental_cost) <= p.balance) {
                        let tmpRig;
                        [tmpRig] = extra_rigs.splice(i, 1);
                        p.rigs_to_rent.push(tmpRig)
                        rental_cost = _provider.getRentalCost(p.rigs_to_rent);
                    }
                }
            }
        }

        let providerBadges = []
        for (let p of providers) {
            let status = { status: NORMAL }

            p.provider.setActivePoolProfile(p.profile)
            for (let rig of p.rigs_to_rent) {
                rig.rental_info.profile = p.profile
            }

            let price = 0,
                //   limit = 0,
                selectedRigsTHs = 0,
                last10AvgCostMrrScrypt = 0,
                selectedRigsRentalCost = 0,
                duration = options.duration;
            last10AvgCostMrrScrypt += p.provider.getRentalCost(p.rigs_to_rent); // amount
            selectedRigsTHs += p.provider.getTotalHashPower(p.rigs_to_rent) / 1000 / 1000; // limit
            price = toNiceHashPrice(last10AvgCostMrrScrypt, selectedRigsTHs, duration)
            selectedRigsRentalCost += selectedRigsTHs * 1000 * last10AvgCostMrrScrypt / (24 * duration)
            let market = MiningRigRentals
            let balance = p.balance

            if (cost_found > balance) {
                status.status = WARNING
                status.type = LOW_BALANCE
                if (hashrate_found < hashrateMin) {
                    status.warning = LOW_HASHRATE
                    status.message = `Can only find ${((hashrate_found / options.hashrate) * 100).toFixed(2)}% of the hashrate desired`
                }
            } else if (p.rigs_to_rent.length === 0) {
                status.status = ERROR
                status.type = "NO_RIGS_FOUND"
            }

            providerBadges.push({
                market,
                status,
                last10AvgCostMrrScrypt,
                duration,
                selectedRigsTHs,
                selectedRigsRentalCost,
                balance,
                query: {
                    hashrate_found,
                    cost_found,
                    duration: options.duration
                },
                uid: p.uid,
                rigs: p.rigs_to_rent,
                provider: p.provider
            })
        }
        if (providerBadges.length === 1) {
            return { success: true, badges: providerBadges[0] }
        } else {
            return { success: true, badges: providerBadges }
        }
    }

    async updateDailyBudget(options, MarketPrice) {
        let priceUSD = await options.PriceBtcUsd();
        const PriceBtcUsd = priceUSD.data.rates.USD;
        const NetworkhashrateFlo = options.NetworkHashRate;
        const MarketPriceMrrScrypt = MarketPrice * 1000 / 24; // convert to TH/s devided by 24 => 1000/24

        const Duration = options.duration;
        const Percent = options.Xpercent / 100;
        const Margin = options.targetMargin / 100;
        const ProfitReinvestmentRate = options.profitReinvestment / 100;
        console.log('NetworkhashrateFlo: ', NetworkhashrateFlo, 'MarketPriceMrrScrypt: ', MarketPriceMrrScrypt, 'Duration: ', Duration, 'Percent: ', Percent, 'PriceBtcUsd: ', PriceBtcUsd, 'Margin: ', Margin, 'ProfitReinvestmentRate: ', ProfitReinvestmentRate);
        let EstRentalBudgetPerCycleUSD = NetworkhashrateFlo * MarketPriceMrrScrypt * Duration * (-Percent / (-1 + Percent)) * PriceBtcUsd * (Margin * ProfitReinvestmentRate + 1);
        console.log('EstRentalBudgetPerCycleUSD:', EstRentalBudgetPerCycleUSD);
        let msg = {
            update: true,
            client: EstRentalBudgetPerCycleUSD.toFixed(2),
            db: 'dailyBudget',
            dailyBudget: EstRentalBudgetPerCycleUSD.toFixed(2)
        };
        
        options.emitter.emit('rented', msg);
    }

	/**
     * Compare MiningRigRentals and NiceHash market to find which market to rent with
     * @param {Object} options - The Options for the rental operation
     * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
     * @param {Number} options.duration - The duration (IN HOURS) that you wish to rent hashrate for
     * @return {Promise<String>} Returns a Promise that will resolve to a string for which market to rent with
     */
  
    async compareMarkets(options) {
        const niceHashDuration = 24;
        const minNiceHashAmount = 0.005;
        const token = options.token;
        const BittrexWithdrawalFee = 0.0005;
        const BittrexMinMultiplier = 4;
        const BittrexMinWithdrawal = BittrexWithdrawalFee * BittrexMinMultiplier;
        const MinPercent = 0.35;
        let MRR = {};
        let niceHash = {};

        let roundNumber = num => {
            return num + .0001;
            return +(Math.round(num + "e+2") + "e-2"); // Rounds up the thousands .0019 => 002
        };

        let getNiceHashAmount = hashrateNH => {
            // hashrate is based on if current hashrate is below the threshold NiceHash allows of .01
            let hashrate = hashrateNH < 0.01 ? .01 : hashrateNH;
            let amount = (niceHashDuration * hashrate * niceHash.marketPriceNhScryptBtcThSD / 24).toFixed(11);
            return {
                amount,
                hashrate
            };
        };

        try {
            for (let provider of this.rental_providers) {
                console.log('provider.getInternalType()', provider.getInternalType());

                if (provider.getInternalType() === MiningRigRentals) {
                    // Switch hashrate to MH/s due to MRR accepts it that way
                    // let hashrate = options.hashrate * 1000000
                    let response = await provider.getAlgo('scrypt', 'BTC');
                    console.log('response: autorenter.js 281', response); // Returns amount in GH/s

                    MRR.success = true;
                    MRR.marketPriceMrrScryptBtcThSD = response.data.suggested_price.amount;
                    this.updateDailyBudget(options, MRR.marketPriceMrrScryptBtcThSD)
                }

                if (provider.getInternalType() === NiceHash) {
                    let orderBook = await provider.getOrderBook();
                    let orders = orderBook.stats.USA.orders;
                    let length = orders.length;
                    let lowestPrice = orders[0].price;

                    for (let i = 0; i < length; i++) {
                        if (orders[i].rigsCount > 0) {
                            if (orders[i].price < lowestPrice) {
                                lowestPrice = orders[i].price;
                            }
                        }
                    }

                    niceHash.success = true;
                    niceHash.marketPriceNhScryptBtcThSD = lowestPrice;
                }
            }

            let niceHashCalculation = async () => {
                let lowestPriceGHs = niceHash.marketPriceNhScryptBtcThSD / 1000;
                options.amount = getNiceHashAmount(options.hashrate).amount;
                options.limit = getNiceHashAmount(options.hashrate).hashrate;
                options.price = niceHash.marketPriceNhScryptBtcThSD; // options.duration = 24

                // Checks if the new renting hashrate price is lower than the min amount NiceHash accepts of 0.005
                if (lowestPriceGHs < minNiceHashAmount) {
                    const MinPercentFromMinAmount = 24 * .005 / (24 * .005 + options.difficulty * Math.pow(2, 32) / 40 / 1000000000000 * niceHash.marketPriceNhScryptBtcThSD * 24);
                    let getNewHashrate = await options.newRent(token, MinPercentFromMinAmount);
                    let hashrateRoundedUp = roundNumber(getNewHashrate.Rent);
                    let newAmount = getNiceHashAmount(hashrateRoundedUp).amount;

                    options.amount = newAmount;
                    let msg = JSON.stringify({
                        message: "Your current percent of ".concat(options.Xpercent, "% increased to ").concat((MinPercentFromMinAmount * 100.1).toFixed(2), "% ") + "in order to rent with NiceHash's min. Amount of 0.005",
                        Xpercent: (MinPercentFromMinAmount * 100.1).toFixed(2)
                    });
                    emitter.emit('message', msg);
                }

                console.log('Amount: autorent.js line 353', options.amount);
                return 'NiceHash';
            };

            //1st Check
            const MinPercentFromBittrexMinWithdrawal = BittrexMinWithdrawal / (BittrexMinWithdrawal + options.NetworkHashRate * MRR.marketPriceMrrScryptBtcThSD * options.duration);
            
            console.log('MinPercentFromBittrexMinWithdrawal, options.Xpercent:', MinPercentFromBittrexMinWithdrawal, options.Xpercent)
            if (options.Xpercent < MinPercentFromBittrexMinWithdrawal) {
                let msg = JSON.stringify({
                    update: true,
                    message: "In order to mine with the given token of ".concat(options.Xpercent, " must increase your pecent to ").concat((MinPercentFromBittrexMinWithdrawal * 100.1).toFixed(2), "% , ") + "and try renting again.",
                    autoRent: false
                });
                emitter.emit('message', msg);
                return false;
            } 

            // Whitchever market is cheaper return that market
            // 2nd Check
            if (MRR.success && niceHash.success) {
                let niceHashPriceGHs = niceHash.marketPriceNhScryptBtcThSD / 1000;

                if (MRR.marketPriceMrrScryptBtcThSD < niceHashPriceGHs) {
                    let msg = JSON.stringify({
                        info: "from MiningRigRentals"
                    });
                    emitter.emit('message', msg);
                    return 'MiningRigRentals';
                } else {
                    return niceHashCalculation();
                }
            } 

            // If user only chooses one market to begin with return that market
            const market = MRR.success ? 'MiningRigRentals' : niceHashCalculation();
            emitter.emit('message', JSON.stringify({
                market: market
            }));
            return market;
        } catch (e) {
            console.log('compareMarkets function error : ', e);
            return "compareMarkets function error : ', ".concat(e);
        }
    }

	/**
	 * Rent an amount of hashrate for a period of time
	 * @param {Object} options - The Options for the rental operation
	 * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
	 * @param {Number} options.duration - The duration (IN SECONDS) that you wish to rent hashrate for
	 * @return {Promise<Object>} Returns a Promise that will resolve to an Object containing info about the rental made
	 */

    // Gets hit from within rent() in AutoRenter.js below
    async rentPreprocess(options) {
        let market = await this.compareMarkets(options)

        if (market === false) {
            return {
              status: ERROR,
              badges: []
            };
          }
        let mrrProviders = [];
        let nhProviders = [];

        for (let provider of this.rental_providers) {

            console.log('provider.getInternalType():', provider.getInternalType())
            if (provider.getInternalType() === NiceHash && market === NiceHash) {
                nhProviders.push(provider);
            }

            if (provider.getInternalType() === MiningRigRentals && market === MiningRigRentals) {
                mrrProviders.push(provider);
            }
        }

        let badges = [];

        if (mrrProviders.length >= 1) {
            let mrrPreprocess = await this.mrrRentPreprocess(options);

            if (!mrrPreprocess.success) {
                return mrrPreprocess;
            } else {
                if (Array.isArray(mrrPreprocess.badges)) {
                    for (let badge of mrrPreprocess.badges) {
                        badges.push(badge);
                    }
                } else {
                    badges.push(mrrPreprocess.badges);
                }
            }
        }

        for (let prov of nhProviders) {
            //   badges.push((await prov.preprocessRent(options.hashrate, options.duration))); // Hits NiceHashProvider.js preprocessRent()
            badges.push((await prov.preprocessRent(options))); // Hits NiceHashProvider.js preprocessRent()
        }

        // return badges
        return {
            status: NORMAL,
            badges: badges
          };
    }

    /**
    * Selects the best rental options from the returned preprocess function
    * @param {Object} preprocess - the returned object from manualRentPreprocess()
    * @param {Object} options - options passed down into manualRent func (hashrate, duration)
    * @returns {Promise<{Object}>}
    * WAS rentSelector() {} - REMOVED
    */


	/**
	 * Manual rent based an amount of hashrate for a period of time
	 * @param {Object} options - The Options for the rental operation
	 * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
	 * @param {Number} options.duration - The duration (IN HOURS) that you wish to rent hashrate for
	 * @param {Function} [options.rentSelector] - This function runs to let the user decide which rent option to go for. If no func is passed, will attempt to pick best possible rent opt.
	 * @return {Promise<Object>} Returns a Promise that will resolve to an Object containing info about the rental made
	 */

    // Gets hit from SpartanBot.js rent()
    async rent(options) {
        let inputOptions = options.options
        console.log('options: AutoRenter.js 466')

        if (!this.rental_providers || this.rental_providers.length === 0) {
            let msg = {
                update: false,
                message: 'Rent Cancelled, no rental providers found to rent from.',
                autoRent: false
            };
            inputOptions.emitter.emit('rented', msg);
        }

        let preprocess;

        try {
            preprocess = await this.rentPreprocess(inputOptions); // => rentPreprocess() from above
        } catch (err) {
            return {
                status: ERROR,
                success: false,
                message: "Failed to get prepurchase_info",
                error: err
            };
        }

        if (preprocess.status === ERROR) {
            return {
                status: ERROR,
                success: false,
                message: 'Error in rent preprocess',
                preprocess
            };
        }

        if (preprocess.badges === []) {
            return {
                status: ERROR,
                success: false,
                message: 'Preprocess found no available renting options',
                preprocess
            };
        } //confirm/select

        let badges = preprocess.badges; //rent

        //rent
        let rentals = [];

        for (let badge of badges) {
            let status = badge.status.status
            console.log('BADGE PROVIDER AutoRenter.js line 606 ENDS HERE! CHANGE RETURN', badge)
            if (status === 'WARNING') {
                if(badge.status.type === 'LOW_BALANCE') {
                    return  emitter.emit('message', JSON.stringify({
                            update: true,
                            message: 'Warning: Low balance in your account'
                    }));
                }
            }
            //Rent
            let rentalReturn = await badge.provider.rent(badge); //RentalProvider.js rent()

            for (let rental of rentalReturn) {
                rentals.push(rental);
            }
        }

        let status = NORMAL;
        let message = 'Rent Successful';
        let successfulRentals = 0;
        let unsuccessfulRentals = 0;

        for (let rental of rentals) {
            if (rental.success) {
                successfulRentals++;
            } else unsuccessfulRentals++;
        }

        if (unsuccessfulRentals > 0 && successfulRentals > 0) {
            status = WARNING;
            message = 'Not all rentals were successful';
        }

        if (unsuccessfulRentals >= 0 && successfulRentals === 0) {
            status = ERROR;
            message = 'Failed to rent';
        }

        let amount = 0;
        let limit = 0;
        let duration = 0;
        let limits = [];
        let durations = [];

        for (let rental of rentals) {
            if (rental.success) {
                if (rental.cutoff) {
                    this.cutoffRental(rental.id, rental.uid, options.duration);
                    limits.push(rental.limit);
                    limit += rental.limit;
                    duration += rental.status.desiredDuration;
                    durations.push(rental.status.desiredDuration);
                    amount += rental.status.cutoffCost;
                } else {
                    limits.push(rental.limit);
                    limit += rental.limit;
                    duration += options.duration;
                    durations.push(options.duration);
                    amount += rental.amount;
                }
            }
        }


        let returnData = {
            status,
            message,
            rentals,
            type: RECEIPT
        };
        console.log('AUTORENTER.JS line 665 returnData:', returnData)
        if (returnData.status === 'ERROR') {
            let msg = {
                update: false,
                message: returnData.message,
                autoRent: false
            };
            inputOptions.emitter.emit('rented', msg);

        } else {
            let getCostOfRental = (ids, transactions) => {
                let ids_length = ids.length;
                let transaction_length = transactions.length;
                let amount = 0;

                for (let i = 0; i < ids_length; i++) {
                    let id = ids[i];

                    for (let j = 0; j < transaction_length; j++) {
                        if (id === transactions[j].rig) {
                            amount += Number(transactions[j].amount);
                        }
                    }
                }
                
                let msg = {
                    update: true,
                    message: `Current cost of rental in BTC : ${Math.abs(amount).toFixed(8)}`,
                    db: 'CostOfRentalBtc',
                    CostOfRentalBtc: Math.abs(amount).toFixed(8)
                };
                inputOptions.emitter.emit('rented', msg);
                return msg
            };

      
                try {
                    let ids = [];
                    let successCount = 0;
                    let rentals = returnData.rentals;
                    let length = rentals.length;
                    console.log('length:', length);

                    for (let i = 0; i < length; i++) {
                        if (rentals[i].success === true) {
                            successCount++;
                            ids.push(rentals[i].id);
                        }
                    }

                    let params = {
                        start: 0,
                        limit: successCount * 2
                    };
                    let res = await preprocess.badges[0].provider.getTransactions(params);
                    let transactions = res.data.transactions;
                    return getCostOfRental(ids, transactions);
                } catch (e) {
                    console.log('ERROR SETTIMEOUT: ', e);
                }
                setTimeout(async () => {
                    console.log('SETTIME OUT RAN AFTER 20 MINUTES')
                    let msg = {
                        update: false,
                        message: `Current cost of rental in BTC : TESTING 20 MINUTES`,
                        db: 'CostOfRentalBtc',
                        CostOfRentalBtc: 100000000
                    };
                    inputOptions.emitter.emit('rented', msg);
                }, 20 * 60 * 1000);
            
        }
        return returnData
    }

	/**
	 * Cutoff a NiceHash rental at a desired time
	 * @param {string|number} id - id of the rental
	 * @param {string|number} uid - the uid of the rental provider
	 * @param {number} duration - the amount of time to let the rental run
	 * @returns {void}
	 */
    cutoffRental(id, uid, duration) {
        console.log("Cutoff rental, GO!")
        let cutoffTime = Date.now() + duration * 60 * 60 * 1000
        let check = async () => {
            console.log("checking time")
            if (Date.now() >= cutoffTime) {
                let _provider
                for (let provider of this.rental_providers) {
                    if (provider.getUID() === uid) {
                        _provider = provider
                        break
                    }
                }
                let cancel = await _provider.cancelRental(id)
                if (cancel.success) {
                    //ToDo: Write to log
                    if (!this.cancellations) {
                        this.cancellations = []
                    }
                    console.log(`Cancelled Order ${id}`, cancel)
                    this.cancellations.push(cancel)
                } else {
                    if (cancel.errorType === 'NETWORK') {
                        //ToDo: Write to log
                        console.log("network error", cancel)
                        setTimeout(check, 60 * 1000)
                    }
                    if (cancel.errorType === 'NICEHSAH') {
                        //ToDo: Write to log
                        console.log(`Failed to cancel order: ${id}`, cancel)
                        if (!this.cancellations) {
                            this.cancellations = []
                        }
                        this.cancellations.push(cancel)
                    }
                }
            } else {
                setTimeout(check, 60 * 1000)
            }
        }
        setTimeout(check, 60 * 1000)
    }
}

export default AutoRenter
