import RentalProvider from './RentalProvider'
import MiningRigRentals from 'miningrigrentals-api-v2'
import {selectBestCombination, serializePool, toNiceHashPrice} from "../util";
import {NORMAL, ERROR} from "../constants";

/**
 * A Rental Provider for MiningRigRentals
 */
class MRRProvider extends RentalProvider {
	/**
	 * Create a new MRR Provider
	 * @param  {Object} settings - Settings for the RentalProvider
	 * @param {String} settings.api_key - The API Key for the Rental Provider
	 * @param {String} settings.api_secret - The API Secret for the Rental Provider
	 * @param {String} settings.name - Alias/arbitrary name for the provider
	 * @param {String} [settings.uid] - The unique identifier for this Rental Provider
	 * @return {MRRProvider}
	 */
	constructor(settings){
		super(settings)

		this.api_key = settings.api_key || settings.key;
		this.api_secret = settings.api_secret || settings.secret

		this.api = new MiningRigRentals({key: this.api_key, secret: this.api_secret})
	}

	/**
	 * Get the "type" of this RentalProvider
	 * @return {String} Returns "MiningRigRentals"
	 * @static
	 */
	static getType(){
		return "MiningRigRentals"
	}

	/**
	 * Non static method to get type
	 * @return {String} returns "MiningRigRentals"
	 */
	getInternalType() {
		return "MiningRigRentals"
	}

	/**
	 * Test to make sure the API key and secret are correct
	 * @return {Promise<Boolean>} Returns a Promise that will resolve upon success, and reject on failure
	 */
	async _testAuthorization(){
		try {
			let profile = await this.api.whoami();
			return !!(profile.success && profile.data && profile.data.authed);
		} catch (err) {
			throw new Error(err)
		}
	}

	/**
	 * Fetch active rigs (rentals) (called by parent class RentalProvider)
	 * @returns {Promise<Array.<number>>} - returns an array of rig IDs
	 * @private
	 */
	async _getActiveRigs() {
		try {
			let response = await this.api.getRentals()
			if (response.success) {
				let data = response.data;
				if (data) {
					let rentals = data.rentals
					let rigs = []
					for (let rental of rentals) {
						if (rental.rig && rental.rig.id)
							rigs.push(Number(rental.rig.id))
					}
					return rigs
				}
			}
		} catch (err) {
			throw new Error(`Could not fetch rentals \n ${err}`)
		}
	}

	/**
	 * Get MiningRigRentals Profile ID (needed to rent rigs)
	 * @returns {Promise<number>} - the id of the first data object
	 */
	async getProfileID() {
		if (this.returnActivePoolProfile())
			return this.returnActivePoolProfile()

		let profile;
		try {
			profile = await this.api.getPoolProfiles();
		} catch (err) {
			throw new Error(`error getting profile data: ${err}`)
		}
		if (profile.success) {
			//ToDo: be able to pick a pool profile to use
			if (profile.data.length === 0) {
				throw new Error(`No profile data. Consider creating a pool/profile`)
			} else {
				return profile.data[0].id
			}
		} else {
			throw new Error(`Error getting profile data. Invalid nonce most likely: ${JSON.stringify(profile, null, 4)}`)
		}
	}

	/**
	 * Create a pool and add it to local variable
	 * @param {Object} options
	 * @param {string} options.type - Pool algo, eg: sha256, scrypt, x11, etc
	 * @param {string} options.name - Name to identify the pool with
	 * @param {string} options.host - Pool host, the part after stratum+tcp://
	 * @param {number} options.port - Pool port, the part after the : in most pool host strings
	 * @param {string} options.user - Your workname
	 * @param {number} [options.id] - Local ID (NOT MRR ID)
	 * @param {string} [options.pass='x'] - Worker password
	 * @param {string} [options.notes] - Additional notes to help identify the pool for you
	 * @async
	 * @returns {Promise<Object>}
	 */
	async _createPool(options) {
		let pool = {};
		try {
			let res = await this.api.createPool(options)
			if (res.success) {
				pool = res.data
			}
		} catch (err) {
			throw new Error(`Failed to create pool: ${err}`)
		}
		pool = {
			mrrID: pool.id,
			type: options.type,
			name: options.name,
			host: options.host,
			port: options.port,
			id: options.id,
			user: options.user,
			pass: options.pass,
			providerUID: this.getUID(),
			market: this.getInternalType()}
		this._addPools(pool)
		return pool
	}

	/**
	 * Delete pool from local variable, this.pools, and from the MRR website
	 * @param id
	 * @returns {Promise<Object>}
	 * @private
	 */
	async _deletePool(id) {
		let poolID = id;
		let index;
		for (let i = 0; i < this.pools.length; i++) {
			if (this.pools[i].id === id || this.pools[i].mrrID === id) {
				poolID = this.pools[i].mrrID ? this.pools[i].mrrID : this.pools[i].id
				index = i
			}
		}

		let res;
		try {
			res =  await this.api.deletePools(poolID)
		} catch (err) {
			throw new Error(`Failed to delete pool: ${err}`)
		}
		if (res.success)
			this.pools.splice(index, 1)
		return res
	}

	/**
	 * Update a pool
	 * @param {(number|Array.<number>)} poolIDs - IDs of the pools you wish to update
	 * @param {string|number} id - pool id
	 * @param {Object} [options]
	 * @param {string} [options.type] - Pool algo, eg: sha256, scrypt, x11, etc
	 * @param {string} [options.name] - Name to identify the pool with
	 * @param {string} [options.host] - Pool host, the part after stratum+tcp://
	 * @param {number} [options.port] - Pool port, the part after the : in most pool host strings
	 * @param {string} [options.user] - Your workname
	 * @param {string} [options.pass] - Worker password
	 * @param {string} [options.notes] - Additional notes to help identify the pool for you
	 * @async
	 * @returns {Promise<Object>}
	 */
	async _updatePool(id, options) {
		for (let pool of this.pools) {
			if (pool.id === id)
				if (pool.mrrID)
					id = pool.mrrID
 		}
		let res;
		try {
			res = await this.api.updatePools(id, options)
		} catch (err) {
			throw new Error(`Failed to update pool at MRRProvider.js: ${err}`)
		}
		if (res.success) {
			for (let pool of this.pools) {
				if (pool.id === id || pool.mrrID === id) {
					for (let opt in pool) {
						for (let _opt in options) {
							if (opt === _opt) {
								pool[opt] = options[_opt]
							}
						}
					}
				}
			}
			return res
		} else {
			return res
		}
	}

	/**
	 * Get all pools, a single pool by ID, or multiple pools by their IDs
	 * @param {(number|Array.<number>)} [ids] - can be a single pool id or multiple pool ids. If no ids are passed, will fetch all pools
	 * @return {Promise<Object>} - returns the data and not a success object
	 */
	async _getPools(ids) {
		if (!ids) {
			let res;
			try {
				res = await this.api.getPools()
			} catch (err) {
				throw new Error(`Could not fetch pools \n ${err}`)
			}
			if (res.success) {
				return res.data
			} else {
				throw new Error(`Success: false. ${res.data}`)
			}
		} else {
			let res
			try {
				res =  await this.api.getPoolsByID(ids)
			} catch (err) {
				throw new Error(`Could not fetch pools \n ${err}`)
			}
			if (res.success) {
				return res.data
			} else {
				throw new Error(`Success: false. ${res.data}`)
			}
		}
	}

	_addPools(pools) {
		if (Array.isArray(pools)) {
			for (let pool of pools) {
				let match = false
				for (let p of this.pools) {
					if (p.id === pool.id || p.mrrID === pool.mrrID)
						match = true
				}
				if (!match)
					this.pools.push(serializePool(pool, this.getInternalType()))
			}
		} else {
			let match = false
			for (let p of this.pools) {
				if (p.id === pools.id || p.mrrID === pools.mrrID)
					match = true
			}
			if (!match)
				this.pools.push(serializePool(pools, this.getInternalType()))
		}
	}

	/**
	 * Add a pool to the profile
	 * @param {Object} options
	 * @param {number} options.profileID - The profile id you want to add the pool to
	 * @param {number} options.poolid - Pool ID to add -- see /account/pool
	 * @param {number} options.priority - 0-4
	 * @param {string} options.algo - Name of algorithm
	 * @param {string} options.name - Pool name (doesn't change the pool name... just an MRR requirement)
	 * @async
	 * @returns {Promise<Object>}
	 * @example
	 * //return example
	 * {
	 *   success: true,
     *   data: { id: '23136', success: true, message: 'Updated' }
	 * }
	 */
	async addPoolToProfile(options) {
		let newOptions = {}
		for (let opt in options) {
			if (opt === 'type')
				newOptions['algo'] = options[opt]

			if (opt === 'mrrID')
				newOptions.poolid = options[opt]
			else if (opt === 'id')
				newOptions.poolid = options[opt]

			newOptions[opt] = options[opt]
		}
		try {
			return await this.api.addPoolToProfile(newOptions)
		} catch (err) {
			throw new Error(`Failed to add pool to profile: ${err}`)
		}
	}

	/**
	 * Update or replace a pool to a profile... **Poor MRR Documentation
	 * @param {Object} options
	 * @param {number} options.profileID - Pool Profile ID
	 * @param {number} options.poolid - Pool ID
	 * @param {number} options.priority - 0-4
	 * @param {string} options.algo - Name of algorithm
	 * @param {string} options.name - Pool name (doesn't change the pool name... just an MRR requirement)
	 * @async
	 * @returns {Promise<Object>}
	 */
	async updatePoolOnProfile(options) {
		let res;
		try {
			res = await this.api.updatePoolOnProfile(options)
		} catch (err) {
			throw new Error(`Failed to update pool on profile: ${options.profileID}`)
		}
		return res
	}

	/**
	 * Creates a pool and adds it to a newly created pool profile
	 * @param {Object} options
	 * @param {string} options.profileName - Name of the profile
	 * @param {string} options.algo - Algorithm ('scrypt', 'x11', etc)
	 * @param {string} options.name - Name to identify the pool with
	 * @param {string} options.host - Pool host, the part after stratum+tcp://
	 * @param {number} options.port - Pool port, the part after the : in most pool host strings
	 * @param {string} options.user - Your workname
	 * @param {number} options.priority - 0-4
	 * @param {string} [options.pass] - Worker password
	 * @param {string} [options.notes] - Additional notes to help identify the pool for you
	 * @returns {Promise<Object>} - returns an object with the profileID and poolid on success
	 */
	async createPoolAndProfile(options) {
		let poolProfile;
		try {
			let response = await this.api.createPoolProfile(options.profileName, options.algo)
			if (response.success) {
				poolProfile = response.data.id
			}
		} catch (err) {
			throw new Error(`Could not create Pool Profile \n ${err}`)
		}
		let pool;
		let poolParams = {};
		for (let opt in options) {
			if (opt === 'profileName') {
				poolParams.name = options[opt]
			} else if (opt === 'algo') {
				poolParams.type = options[opt]
			} else {
				poolParams[opt] = options[opt]
			}
		}
		try {
			let response = await this.api.createPool(poolParams)
			if (response.success) {
				pool = response.data.id
			}
		} catch (err) {
			throw new Error(`Could not create pool \n ${err}`)
		}

		this.addPools({...poolParams, id: pool})

		let addPoolToProfileOptions = {
			profileID: poolProfile,
			poolid: pool,
			priority: options.priority,
			algo: options.algo,
			name: options.name
		};

		let success;
		try {
			let response = await this.api.addPoolToProfile(addPoolToProfileOptions)
			if (response.success) {
				success = response.data
			}
		} catch (err) {
			throw new Error(`Failed to add pool: ${pool} to profile: ${poolProfile} \n ${err}`)
		}
		let returnObject
		if (success.success) {
			returnObject = {
				profileID: success.id,
				poolid: pool,
				success: true,
				message: success.message
			}
		} else {
			returnObject = success
		}
		return {success: returnObject, pool: {...poolParams, id: pool}}
	}

	/**
	 * Create a pool profile
	 * @param {string} name - Name of the profile
	 * @param {string} algo - Algo of the profile -> see /info/algos
	 * @async
	 * @returns {Promise<Object>}
	 */
	async createPoolProfile(name, algo) {
		let res;
		try {
			res =  await this.api.createPoolProfile(name, algo)
		} catch (err) {
			throw new Error(`Failed to create pool profile: ${err}`)
		}
		if (res.success)
			this.setActivePoolProfile(res.data.id)
		return res
	}

	/**
	 * Delete a specific pool profile from MRR and locally at this.poolProfiles
	 * @param {number} id - Pool Profile ID
	 * @async
	 * @returns {Promise<Object>}
	 */
	async deletePoolProfile(id) {
		let res;
		try {
			res = await this.api.deletePoolProfile(id)
		} catch (err) {
			throw new Error(`Failed to delete pool profile: ${err}`)
		}
		if (res.success) {
			for (let i in this.poolProfiles) {
				if (this.poolProfiles[i].id === id)
					this.poolProfiles.splice(i, 1)
			}
		}
		return res
	}

	/**
	 * Set a pool to active
	 * pool profile id
	 */
	_setActivePool(profileID) {
		this.activePool = profileID
	}

	/**
	 * Return active pool
	 */
	_returnActivePool() {
		return this.activePool
	}

	/**
	 * Set a pool profile to active
	 * pool profile id
	 */
	setActivePoolProfile(profileID) {
		this.activePoolProfile = profileID
	}

	/**
	 * Return active pool profile
	 */
	returnActivePoolProfile() {
		return this.activePoolProfile
	}

	/**
	 * Set pool profiles to local variable, this.poolProfiles
	 * @param {Array.<Object>} profiles - an array of objects with the name and if of the pool profile
	 */
	setPoolProfiles(profiles) {
		this.poolProfiles = profiles
	}

	/**
	 * Add one or more pool profiles
	 * @param {(Object|Array.<Object>)} profiles - An object that contains MRR pool profile data: must have an id
	 */
	addPoolProfiles(profiles) {
		if (Array.isArray(profiles)) {
			for (let p of profiles) {
				let match = false;
				for (let profiles of this.poolProfiles) {
					if (profiles.id === p.id) {
						match = true;
					}
				}
				if (!match) {
					this.poolProfiles.push(p)
				}
			}
		} else {
			let match = false;
			for (let p of this.poolProfiles) {
				if (profiles.id === p.id) {
					match = true;
				}
			}
			if (!match) {
				this.poolProfiles.push(profiles)
			}
		}
	}

	/**
	 * Return the pool profiles stored locally
	 */
	returnPoolProfiles() {
		return this.poolProfiles
	}

	/**
	 * Get all pool profiles, a single pool profile by ID, or multiple pool profiles by their IDs
	 * @param {(number|Array.<number>)} [ids] - can be a single pool id or multiple pool ids. If no ids are passed, will fetch all pools
	 * @returns {Promise<Object>}
	 */
	async getPoolProfiles(ids) {
		if (!ids) {
			try {
				return await this.api.getPoolProfiles()
			} catch (err) {
				throw new Error(`Could not fetch pools \n ${err}`)
			}
		} else {
			try {
				return await this.api.getPoolProfile(ids)
			} catch (err) {
				throw new Error(`Could not fetch pools \n ${err}`)
			}
		}
	}

   /**
   * List/search transaction history
   * @param {Object} [options]
   * @param {number} [options.start=0] - Start number (for pagination)
   * @param {number} [options.limit=100] - Limit number (for pagination)
   * @param {string} [options.algo] - Algo to filter -- see /info/algos
   * @param {string} [options.type] - Type to filter -- one of [credit,payout,referral,deposit,payment,credit/refund,debit/refund,rental fee]
   * @param {number} [options.rig] - Filter to specific rig by ID
   * @param {number} [options.rental] - Filter to specific rental by ID
   * @param {string} [options.txid] - Filter to specific txid
   * @async
   * @returns {Promise<Object>}
   */

	async getTransactions(options){
		return await this.api.getTransactions(options)
	}

	/**
	 * Get the confirmed account balance for a specific coin (defaults to BTC)
	 * @param {string} [coin='BTC'] - The coin you wish to get a balance for [BTC, LTC, ETH, DASH]
	 * @returns {Promise<(number|Object)>} - will return an object if success is false ex. {success: false}
	 */
	async _getBalance(coin) {
		try {
			let response = await this.api.getAccountBalance()
			if (response.success) {
				if (coin) {
					return Number(response.data[coin.toUpperCase()].confirmed)
				} else {
					return Number(response.data['BTC'].confirmed)
				}
			} else {
				return {success: false}
			}
		} catch (err) {
			throw new Error(`Could not fetch account balance \n ${err}`)
		}
	}

	/**
	 * Get Back balances for all coins, confirmed and unconfirmed
	 * @returns {Promise<Object>}
	 */
	async _getBalances() {
		try {
			let response = await this.api.getAccountBalance()
			if (response.success) {
				return response.data
			} else {
				return {success: false}
			}
		}
		 catch (err) {
			throw new Error(`Could not fetch account balance \n ${err}`)
		}
	}

	/**
	 * Get the total cost to rent multiple rigs
	 * @param {Array.<Object>} rigs_to_rent - See MRRProvider.getRigsToRent()
	 * @returns {number}
	 */
	getRentalCost(rigs_to_rent) {
		let cost = 0
		for (let rig of rigs_to_rent) {
			//ToDo: make the crypto-currency dynamic
			cost += rig.btc_price
		}
		return cost
	}

	/**
	 * Get the total hashpower of an array of rigs to rent in megahash (mh)
	 * @param {Array.<Object>} rigs_to_rent - See MRRProvider.getRigsToRent()
	 * @returns {number}
	 */
	getTotalHashPower(rigs_to_rent) {
		let hashpower = 0
		for (let rig of rigs_to_rent) {
			hashpower += rig.hashrate
		}
		return hashpower
	}

	/**
	 * Rent rigs
	 * @param {Array.<Object>} rigs_to_rent - An array of rigs to rent (see AutoRenter.manualRentPreprocess)
	 * @returns {Promise<Object>}>}
	 */
	async _rent(rigs_to_rent) {
		//rent rigs
		let rentalConfirmation = {};
		for (let rig of rigs_to_rent) {
			try {
				let rental = await this.api.createRental(rig)
				rentalConfirmation[rig.rig] = rental
			} catch (err) {
				rentalConfirmation[rig.rig] = {success: false, message: `Error renting rig`, error: err, status: ERROR}
			}
		}

		let rented_rigs = []

		for (let rig in rentalConfirmation){
			if (rentalConfirmation[rig].success){
				let rentalObject = {}
				rentalObject.market = "MiningRigRentals"
				rentalObject.success = true
				rentalObject.paid = parseFloat(rentalConfirmation[rig].data.price.paid);
				rentalObject.limit = rentalConfirmation[rig].data.hashrate.advertised.hash;
				rentalObject.limitAdvertised = rentalConfirmation[rig].data.price_converted.advertised;
				rentalObject.id = rig
				rentalObject.status = {status: NORMAL}
				rentalObject.uid = this.getUID()
				rentalObject.mrrData = rentalConfirmation[rig].data
				rented_rigs.push(rentalObject)
			} else {
				rented_rigs.push({success: false, ...rentalConfirmation[rig], status: {status: ERROR}, rig})
			}
		}

		return rented_rigs
	}
	 /**
   * Get statistics for an algo (suggested price, unit information, current rented hash/etc)
   * @param {string} algo - the name of the algorithm you wish to search by. Ex: 'scrypt'
   * @param {string} [currency='BTC'] - Currency to use for price info. Options: BTC, ETH, LTC, DASH
   * @async
   * @returns {Promise<Object>}
   */

	async getAlgo(algo, currency) {
		return await this.api.getAlgo(algo, currency)
	}
	/**
	 * Get the rigs needed to fulfill rental requirements
	 * @param {number | string} hashrate - in megahertz(mh)
	 * @param {number} duration - in hours
	 * @returns {Promise<Array.<Object>>}
	 */
	async getRigsToRent(hashrate, duration) {
		if (typeof hashrate !== 'number')
			hashrate = parseFloat(hashrate)
		let balance;
		try {
			balance = await this.getBalance()
		} catch (err) {
			throw new Error(`Could not fetch balance from MRR API: ${err} `)
		}
		//get profileID
		let profileID
		try {
			profileID =  await this.getProfileID()
		} catch (err) {
			throw new Error(`Could not fetch profile ID: ${err}`)
		}

		let rigOpts = {
			type: 'scrypt',
			minhours: {
				max: duration
			}
		}
		let rigsRequest;
		try {
			rigsRequest = await this.api.getRigs(rigOpts)
		} catch (err) {
			throw new Error(`Could not fetch rig list \n ${err}`)
		}
		let available_rigs = [];
		if (rigsRequest.success && rigsRequest.data) {
			if (rigsRequest.data.records.length === 0) {
				throw new Error(`No rigs found`)
			}
			let newRPIrigs = [], allOtherRigs = [];
			for (let rig of rigsRequest.data.records) {
				if (rig.rpi === 'new') {
					newRPIrigs.push(rig)
				} else {allOtherRigs.push(rig)}
			}

			//ToDo: Sort by price/rpi
			allOtherRigs.sort((a,b) => {
				return (b.rpi - a.rpi)
			});
			available_rigs = newRPIrigs.concat(allOtherRigs)
		}

		if (hashrate >= 2000 && available_rigs.length < 15) {
			const calculateHashpower = (rigs) => {
				let total = 0;
				for (let rig of rigs) {
					total += rig.hashrate
				}
				return total
			}
			let filteredRigs = [];
			for (let rig of available_rigs) {
				if (parseFloat(rig.price.BTC.hour < 1e-6))
					continue
				filteredRigs.push({
					rental_info: {
						rig: parseInt(rig.id),
						length: duration,
						profile: parseInt(profileID)
					},
					hashrate: parseFloat(rig.hashrate.last_30min.hash),
					btc_price: parseFloat(rig.price.BTC.hour) * duration
				})
			}
			if (calculateHashpower(filteredRigs) > hashrate) {
				return selectBestCombination(filteredRigs, hashrate, rig => rig.hashrate)
			}
		}

		let rigs_to_rent = [], hashpower = 0, totalCost = 0;
		for (let rig of available_rigs) {
			if (parseFloat(rig.price.BTC.hour < 1e-6))
				continue
			let btc_price = parseFloat(rig.price.BTC.hour) * duration
			let rig_hashrate = parseFloat(rig.hashrate.last_30min.hash)

			if ((hashpower + rig_hashrate) <= hashrate && rig_hashrate > 0 && (totalCost += btc_price <= balance)) {
				hashpower += rig_hashrate
				rigs_to_rent.push({
					rental_info: {
						rig: parseInt(rig.id),
						length: duration,
						profile: parseInt(profileID)
					},
					hashrate: rig_hashrate,
					btc_price
				})
			}
		}
		return rigs_to_rent
	}
}

export default MRRProvider
