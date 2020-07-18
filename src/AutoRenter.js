import Exchange from '@oipwg/exchange-rate';
import uid from 'uid'


const NiceHash = "NiceHash"
const MiningRigRentals = "MiningRigRentals"

import { toNiceHashPrice } from "./util";
import { ERROR, NORMAL, WARNING, LOW_BALANCE, LOW_HASHRATE, CUTOFF, RECEIPT } from "./constants";

 // Formated Date prototype
 const timestamp = () => {
    let date = new Date()
    return date.getFullYear() + "-" +
       (date.getMonth() + 1) + "-" +
       date.getDate() + " " +
       date.getHours() + ":" +
       date.getMinutes() + ":" +
       date.getSeconds()
}   

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
        let token = options.token
        let pools = options.SpartanBot.returnPools(options.providerType)
        if (pools.length === 0) {
            options.emitter.emit('message', JSON.stringify({
                userId: options.userId,
                update: true,
                message: "You have no pools, go back to setup and add your provider and finish adding a pool to continue.",
                db: {autoRent: false}
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
       
        if (typeof id === 'undefined') id = pools[0].id  // If all pools have the same priority or if there is only one pool it returns that id

        let updatedPool;

        try {
            if ( token === "RVN" ) {
                let port = options.providerType === "MiningRigRentals" ? '6060' : '6161'
                updatedPool = await options.SpartanBot.updatePool(id, {
                    type: 'kawPOW',
                    name: 'RVN-2Miners-USA',
                    algo: 'KawPOW',
                    host: 'us-rvn.2miners.com',
                    port: port,
                    pass: 'x',
                    priority: 0,
                    profileName: 'Kawpow',
                    user: walletAddress,
                    providerType: options.providerType,
                    id: id
                });
            } else if ( token === "FLO" ) {
                updatedPool = await options.SpartanBot.updatePool(id, {
                    type: 'Scrypt',
                    name: 'MLG',
                    algo: 'Scrypt',
                    host: '35.224.24.139',
                    port: '7314',
                    pass: 'x',
                    priority: 0,
                    profileName: 'MLG',
                    user: walletAddress,
                    providerType: options.providerType,
                    id: id
                });
            }
      
            options.emitter.emit('message', JSON.stringify({
                userId: options.userId,
                message: `Updated address ${walletAddress} for profile:  ${updatedPool[0].name} `
            }))
            return updatedPool;
          } catch (e) {
            console.log('Error', e.message)
              options.emitter.emit('message', JSON.stringify({
                userId: options.userId,
                  message: e.message
              }))
            return {
              success: false,
              error: e
            };
          }
    }

	/**
	 * Preprocess Rent for MiningRigRental Providers
	 * @param {Object} options - The Options for the rental operation
	 * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
	 * @param {Number} options.duration - The duration (in seconds) that you wish to rent hashrate for
     * @param {String} options.algorithm - The algorithm to rent with
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
                options.providerType = "MiningRigRentals"
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
            rigs_to_rent = await _provider.getRigsToRent(hashrate, options.duration, options.algorithm)
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
            let profile = provider.returnActivePoolProfile() || await provider.getProfileID(options.algorithm);
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


	/**
	 * Rent an amount of hashrate for a period of time
	 * @param {Object} options - The Options for the rental operation
	 * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
	 * @param {Number} options.duration - The duration (IN SECONDS) that you wish to rent hashrate for
     * @param {Number} options.emitter - Per user to emit messages back to client
	 * @return {Promise<Object>} Returns a Promise that will resolve to an Object containing info about the rental made
	 */

    // Gets hit from within rent() in AutoRenter.js below
    async rentPreprocess(options) {
        let market = options.market
        options.emitter.emit('message', JSON.stringify({
            userId: options.userId,
            message: 'Rental market ' + market
        }));
        if (!market) {
            return {
              status: ERROR,
              badges: []
            };
          }
        let mrrProviders = [];
        let nhProviders = [];

        for (let provider of this.rental_providers) {
            if (provider.getInternalType() === NiceHash && market === NiceHash) {
                options.providerType = NiceHash
                await this.updatePoolAddress(options);
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
            badges.push((await prov.preprocessRent(options))); // Hits NiceHashProvider.js preprocessRent()
        }

        // return badges
        return {
            status: NORMAL,
            badges: badges,
            market: market
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

        if (!this.rental_providers || this.rental_providers.length === 0) {
            let msg = JSON.stringify({
                userId: inputOptions.userId,
                update: false,
                autoRent: false,
                message: 'Rent Cancelled, no rental providers found to rent from.'
            });
            inputOptions.emitter.emit('message', msg);
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
            console.log('BADGE PROVIDER AutoRenter.js line 553 ENDS HERE! CHANGE RETURN', badge.status)
            if (status === 'WARNING' || status === 'ERROR') {
                if(badge.status.type === 'LOW_BALANCE') {
                    inputOptions.emitter.emit('message', JSON.stringify({
                        userId: inputOptions.userId,
                            update: true,
                            message: 'Warning: Low balance in your account.'
                    }));
                }
            }
            if (badge.status.type === 'CUTOFF') {
                inputOptions.emitter.emit('message', JSON.stringify({
                    userId: inputOptions.userId,
                    update: true,
                    message: badge.status.message
                }));
            }
        
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
        console.log(timestamp(), ' AutoRenter.js line-698 returnData:', returnData);

        let ErrorMsg;
        if(returnData.rentals.length === 0){
            ErrorMsg = returnData.message
          } else {
            ErrorMsg = returnData.rentals[0].message
          }

          if (returnData.status === 'ERROR') {
            if (preprocess.market === MiningRigRentals) {
                let msg = {
                    userId: inputOptions.userId,
                    update: false,
                    autoRent: false,
                    mining: false,
                    message: `SelectedRigsTHs :  ${badges[0].selectedRigsTHs.toFixed(8)} \n`+
                    `Current balance: ${badges[0].balance}  BTC \n`+
                    `Duration: ${badges[0].duration} hours. \n`+
                    `${ErrorMsg}`,
                    badge: badges,
                    emitter: inputOptions.emitter,
                    timer: inputOptions.Timer,
                    name: inputOptions.name,
                    userOptions: inputOptions,
                    db: {
                        CostOfRentalBtc: Math.abs(0).toFixed(8),
                        duration: badges[0].duration
                    },
                    rentalId: []
                };
                inputOptions.emitter.emit('rented', msg);
                return;
            }
            if (preprocess.market === NiceHash) {
                let msg = {
                    userId: inputOptions.userId,
                    update: false,
                    autoRent: false,
                    mining: false,
                    message: `Cost found BTC:  ${0.000000} \n`+
                    `${badges[0].label}: ${Number(badges[0].totalHashes).toFixed(8)} \n`+
                    `Current balance: ${badges[0].balance} \n`+
                    `Duration: ${badges[0].duration} hours. \n`+
                    `${ErrorMsg} .`,
                    badge: badges,
                    emitter: inputOptions.emitter,
                    timer: inputOptions.Timer,
                    name: inputOptions.name,
                    userOptions: inputOptions,
                    db: {
                        CostOfRentalBtc: 0.000000,
                        duration: badges[0].duration
                    },
                    rentalId: []
                };
                inputOptions.emitter.emit('rented', msg);
                return;
            }
        } else {
            if(returnData.rentals[0].market === MiningRigRentals) {
                let getCostOfRental = (ids, transactions, rentalIds) => {
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
                        userId: inputOptions.userId,
                        update: false,
                        autoRent: true,
                        mining: true,
                        badge: badges,
                        emitter: inputOptions.emitter,
                        timer: inputOptions.Timer,
                        name: inputOptions.name,
                        userOptions: inputOptions,
                        db: {
                            CostOfRentalBtc: Math.abs(amount).toFixed(8),
                            duration: badges[0].duration
                        },
                        message: `Current cost of rental in BTC :  ${Math.abs(amount).toFixed(8)} \n`+
                        `SelectedRigsTHs :  ${badges[0].selectedRigsTHs.toFixed(8)} \n`+
                        `Current balance: ${badges[0].balance} BTC \n`+
                        `Duration: ${badges[0].duration} hours.`,
                        rigIds: ids,
                        rentalId: rentalIds || ''
                    };
                    inputOptions.emitter.emit('rented', msg);
                    return;
                };
    
                try {
                    let ids = [];
                    let rentalIds = [];
                    let successCount = 0;
                    let rentals = returnData.rentals;
                    let length = rentals.length;
    
                    for (let i = 0; i < length; i++) {
                        if (rentals[i].success === true) {
                            successCount++;
                            rentalIds.push(rentals[i].rentalId);
                            ids.push(rentals[i].id);
                        }
                    }
    
                    let params = {
                        start: 0,
                        limit: successCount * 2
                    };
                    let res = await preprocess.badges[0].provider.getTransactions(params);
                    let transactions = res.data.transactions;
                    return getCostOfRental(ids, transactions, rentalIds);
                } catch (e) {
                    console.log('Get Cost of rental AutoRener.js Line 765: ', e);
                }
            }
            if(returnData.rentals[0].market === NiceHash) {
                let msg = {
                    userId: inputOptions.userId,
                    update: false,
                    autoRent: true,
                    mining: true,
                    badge: badges,
                    emitter: inputOptions.emitter,
                    timer: inputOptions.Timer,
                    name: inputOptions.name,
                    userOptions: inputOptions,
                    db: {
                        CostOfRentalBtc: Number(returnData.rentals[0].status.cost).toFixed(8),
                        duration: badges[0].duration
                    },
                    message: `Current cost of rental in BTC :  ${Number(returnData.rentals[0].status.cost).toFixed(8)} \n`+
                    `${badges[0].label}: ${Number(badges[0].totalHashes).toFixed(8)} \n`+
                    `Available balance BTC: ${returnData.rentals[0].res.availableAmount} \n`+
                    `Duration: ${badges[0].duration} hours.`, 
                };
                inputOptions.emitter.emit('rented', msg);
                return;
            }
           
        }
        return returnData;
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
