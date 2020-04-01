import Exchange from 'oip-exchange-rate';
import uid from 'uid'

const NiceHash = "NiceHash"
const MiningRigRentals = "MiningRigRentals"

import {toNiceHashPrice} from "./util";
import {ERROR, NORMAL, WARNING, LOW_BALANCE, LOW_HASHRATE, CUTOFF, RECEIPT} from "./constants";

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

	/**
	 * Preprocess Rent for MiningRigRental Providers
	 * @param {Object} options - The Options for the rental operation
	 * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
	 * @param {Number} options.duration - The duration (in seconds) that you wish to rent hashrate for
	 * @returns {Promise<Object|Array.<Object>>}
	 */
	async mrrRentPreprocess(options) {
		//ToDo: make sure providers profileIDs aren't the same
		//get available rigs based on hashpower and duration
		let _provider;
		let mrr_providers = []
		for (let provider of this.rental_providers) {
			if (provider.getInternalType() === "MiningRigRentals") {
				_provider = provider
				mrr_providers.push(provider)
			}
		}
		if (!_provider)
			return {status: ERROR, success: false, message: 'No MRR Providers'}

		let rigs_to_rent = [];
		try {
			rigs_to_rent = await _provider.getRigsToRent(options.hashrate, options.duration)
		} catch (err) {
			return {status: ERROR, market: MiningRigRentals, message: 'failed to fetch rigs from API', err}
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
				return {status: ERROR, success: false, message: "Failed to get balance from API", error: balance}
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
			let status = {status: NORMAL}

			p.provider.setActivePoolProfile(p.profile)
			for (let rig of p.rigs_to_rent) {
				rig.rental_info.profile = p.profile
			}

			let price = 0, limit = 0, amount = 0, duration = options.duration;
			amount += p.provider.getRentalCost(p.rigs_to_rent)
			limit += (p.provider.getTotalHashPower(p.rigs_to_rent) / 1000 / 1000)
			price = toNiceHashPrice(amount, limit, duration)
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
				amount,
				totalHashesTH: limit * 60 * 60 * duration,
				hashesDesiredTH: (options.hashrate / 1000 / 1000) * 60 * 60 * options.duration,
				duration,
				limit,
				price,
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
			return {success: true, badges: providerBadges[0]}
		} else {
			return {success: true, badges: providerBadges}
		}
	}

	/**
	 * Rent an amount of hashrate for a period of time
	 * @param {Object} options - The Options for the rental operation
	 * @param {Number} options.hashrate - The amount of Hashrate you wish to rent
	 * @param {Number} options.duration - The duration (IN SECONDS) that you wish to rent hashrate for
	 * @return {Promise<Object>} Returns a Promise that will resolve to an Object containing info about the rental made
	 */
	async rentPreprocess(options) {
		let mrrProviders = []
		let nhProviders = []

		for (let provider of this.rental_providers) {
			if (provider.getInternalType() === NiceHash) {
				nhProviders.push(provider)
			}
			if (provider.getInternalType() === MiningRigRentals) {
				mrrProviders.push(provider)
			}
		}

		let badges = []

		if (mrrProviders.length >= 1) {
			let mrrPreprocess = await this.mrrRentPreprocess(options)
			if (!mrrPreprocess.success) {
				return mrrPreprocess
			} else {
				if (Array.isArray(mrrPreprocess.badges)) {
					for (let badge of mrrPreprocess.badges) {
						badges.push(badge)
					}
				} else {
					badges.push(mrrPreprocess.badges)
				}
			}

		}

		for (let prov of nhProviders) {
			badges.push(await prov.preprocessRent(options.hashrate, options.duration)) // Hits NiceHashProvider.js preprocessRent()
		}

		let usable_badges = []
		let error_badges = []

		for (let badge of badges) {
			switch (badge.status.status) {
				case NORMAL:
					usable_badges.push(badge)
					break
				case WARNING:
					if (badge.status.type === CUTOFF) {
						//if cutoff, make a copy of it to be used as a cutoff
						let cutoffBadge = {...badge}
						cutoffBadge.cutoff = true
						usable_badges.push(cutoffBadge)
						//the original badge, mark as an extension and push that
						badge.extension = true
						usable_badges.push(badge)
					} else {
						if (badge.status.type === LOW_BALANCE)
							badge.low_balance = true
						//these will be your LOW_BALANCE badges
						usable_badges.push(badge)
					}
					break
				case ERROR:
					error_badges.push(badge)
					break
			}
		}

		if (usable_badges.length === 0 && error_badges > 0) {
			return {status: ERROR, badges: error_badges}
		} else {
			//give each badge a unique id other than the provider id (uid)
			let normalBadges = 0
			let warningBadges = 0
			for (let badge of usable_badges) {
				if (badge.status.status === NORMAL)
					normalBadges++
				if (badge.status.status === WARNING)
					warningBadges++
				badge.id = uid()
			}
			if (warningBadges > 0 )
				return {status: WARNING, badges: usable_badges}
			return {status: NORMAL, badges: usable_badges}
		}
	}

	/**
	 * Selects the best rental options from the returned preprocess function
	 * @param {Object} preprocess - the returned object from manualRentPreprocess()
	 * @param {Object} options - options passed down into manualRent func (hashrate, duration)
	 * @returns {Promise<{Object}>}
	 */
	async rentSelector(preprocess, options) {
		let badges = preprocess.badges
		const totalHashesDesired = (options.hashrate / 1000 / 1000) * 60 * 60 * options.duration

		let normal_badges = []
		let warning_badges = []
		for (let badge of badges) {
			if (badge.status.status === NORMAL) {
				normal_badges.push(badge)
			} else if (badge.status.status === WARNING) {
				warning_badges.push(badge)
			}
		}

		// console.log('normal badges: ', normal_badges)
		// console.log('warning badges: ', warning_badges)

		const limitTH = options.hashrate / 1000 / 1000


		if (normal_badges.length > 0) {
			let best_badge = {}
			let amount = 1000000
			for (let badge of normal_badges) {
				if (badge.amount < amount) {
					amount = badge.amount
					best_badge = badge
				}
			}

			let limit10Perc = limitTH * 0.10
			let minLimit = limitTH - limit10Perc
			if (best_badge.limit > minLimit)
				return best_badge

			let selected_badges = [best_badge]
			let hashes = 0
			if (best_badge.totalHashes < totalHashesDesired) {
				hashes += best_badge.totalHashes
				for (let badge of normal_badges) {
					if ((badge.totalHashes + hashes) <= totalHashesDesired) {
						selected_badges.push(badge)
						hashes += badge.totalHashes
					}
				}
			}
			if (hashes < totalHashesDesired) {
				for (let badge of warning_badges) {
					if ((badge.totalHashes + hashes) <= totalHashesDesired) {
						selected_badges.push(badge)
						hashes += badge.totalHashes
					}
				}
			}

			if (selected_badges.length > 0)
				return selected_badges
		}

		if (warning_badges.length > 0) {
			let cutoffs = []
			let low_balances = []
			for (let badge of warning_badges) {
				if (badge.status.type === LOW_BALANCE) {
					low_balances.push(badge)
				} else if (badge.type === CUTOFF) {
					cutoffs.push(badge)
				}
			}

			let selected_badges = []
			let hashes = 0;

			for (let badge of low_balances) {
				if ((badge.totalHashesTH + hashes) <= totalHashesDesired) {
					hashes += badge.limit
					selected_badges.push(badge)
				}
			}

			return selected_badges
		}
	}

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
		if (!this.rental_providers || this.rental_providers.length === 0) {
			return {
				status: ERROR,
				success: false,
				type: "NO_RENTAL_PROVIDERS",
				message: "Rent Cancelled, no RentalProviders found to rent from"
			}
		}

		//preprocess
		let preprocess;
		try {
			preprocess = await this.rentPreprocess(options)
		} catch (err) {
			return {status: ERROR, success: false, message: `Failed to get prepurchase_info`, error: err}
		}

		if (preprocess.status === ERROR) {
			return {status: ERROR, success: false, message: 'Error in rent preprocess', preprocess}
		}

		if (preprocess.badges === []) {
			return {status: ERROR, success: false, message: 'Preprocess found no available renting options', preprocess}
		}

		//confirm/select
		let badges = preprocess.badges
		if (options.rentSelector) {
			let selector = await options.rentSelector(preprocess, options)
			if (!selector.confirm) {
				return {success: false, message: selector.message, status: WARNING}
			}
			badges = selector.badges
		} else {
			badges = await this.rentSelector(preprocess, options)
		}


		if (!badges || (Array.isArray(badges) && badges.length === 0)) {
			return {status: 'ERROR', message: 'No rent options found after rentSelector fn'}
		}
		// return {status: 'WARNING', message: "TESTING"}

		//rent
		let rentals = []
		if (!Array.isArray(badges))
			badges = [badges]
		for (let badge of badges) {
			let rentalReturn = await badge.provider.rent(badge)  //RentalProvider.js rent() 
			for (let rental of rentalReturn) {
				rentals.push(rental)
			}
		}
		let status = NORMAL
		let message = 'Rent Successful'
		let successfulRentals = 0
		let unsuccessfulRentals = 0
		for (let rental of rentals) {
			if (rental.success) {
				successfulRentals++
			} else unsuccessfulRentals++
		}
		if (unsuccessfulRentals > 0 && successfulRentals > 0) {
			status = WARNING
			message = 'Not all rentals were successful'
		}
		if (unsuccessfulRentals >= 0 && successfulRentals === 0) {
			status = ERROR
			message = 'Failed to rent'
		}

		let amount = 0
		let limit = 0
		let duration = 0

		let limits = []
		let durations = []
		for (let rental of rentals) {
			if (rental.success) {
				if (rental.cutoff) {
					this.cutoffRental(rental.id, rental.uid, options.duration)
					limits.push(rental.limit)
					limit += rental.limit
					duration += rental.status.desiredDuration
					durations.push(rental.status.desiredDuration)
					amount += rental.status.cutoffCost
				} else {
					limits.push(rental.limit)
					limit += rental.limit
					duration += options.duration
					durations.push(options.duration)
					amount += rental.amount
				}
			}
		}

		let weights = []
		let weightedSum = 0
		for (let i = 0; i < limits.length; i++) {
			weights.push(limits[i] * durations[i])
		}
		for (let weight of weights) {
			weightedSum += weight
		}
		let weightedLimit = weightedSum / duration

		//receipt
		return {
			status,
			message,
			total_cost: amount,
			average_hashrate_rented: weightedLimit,
			average_duration: duration / rentals.length,
			average_price: toNiceHashPrice(amount, weightedLimit, duration / rentals.length),
			hashrateTH_desired: options.hashrate / 1000 / 1000,
			duration_desired: options.duration,
			rentals,
			type: RECEIPT,
		}
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
