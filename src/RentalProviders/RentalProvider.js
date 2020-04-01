import uid from 'uid'
import {serializePool} from "../util";

const NiceHash = "NiceHash"
const MiningRigRentals = "MiningRigRentals"
/**
 * A Single Rental Provider API wrapper (to standardize between multiple providers)
 */
class RentalProvider {
	/**
	 * Create a new Rental Provider
	 * @param  {Object} settings - Settings for the RentalProvider
	 * @param {String} settings.api_key - The API Key for the Rental Provider
	 * @param {String} [settings.api_id] - The API ID for the Rental Provider
	 * @param {String} [settings.api_secret] - The API Secret for the Rental Provider
	 * @param {String} [settings.name] - Alias/arbitrary name for the provider
	 * @param {Array.<Object>} [settings.pools] - Array of pools (pool profiles for MRR)
	 * @param {String} [settings.uid] - The unique identifier for this Rental Provider
	 * @return {RentalProvider}
	 */
	constructor(settings = {}){
		this.uid = settings.uid || uid()
		this.api_key = settings.api_key
		this.api_id = settings.api_id
		this.api_secret = settings.api_secret
		this.name = settings.name || this.uid
		this.pools = []
		this.activePool = undefined
		this.poolProfiles = []
		this.activePoolProfile = undefined
		this.activeRigs = []
	}

	/**
	 * Get the "type" of this RentalProvider
	 * @return {String} Returns "RentalProvider"
	 * @static
	 */
	static getType(){
		return "RentalProvider"
	}

	/**
	 * Non static method to get type
	 * @returns {String}
	 */
	getInternalType() {
		return this._getInternalType()
	}

	setUID(id) {
		this.uid = id
	}

	getUID(){
		return this.uid
	}

	setName(name) {
		this.name = name
	}

	getName() {
		return this.name
	}

	/**
	 * Test to make sure the API key and secret are correct
	 * @return {Promise} Returns a Promise that will resolve upon success, and reject on failure
	 */
	async testAuthorization(){
		return await this._testAuthorization()
	}

	/**
	 * Create pool and adds it to local variable this.pools
	 * @param {Object} options
	 * @param {string} options.algo - Algorithm ('scrypt', 'x11', etc)
	 * @param {string} options.host - Pool host, the part after stratum+tcp://
	 * @param {number} options.port - Pool port, the part after the : in most pool host strings
	 * @param {string} options.user - Your workname
	 * @param {string} [options.pass='x'] - Worker password
	 * @param {string|number} [options.location=0] - NiceHash var only: 0 for Europe (NiceHash), 1 for USA (WestHash) ;
	 * @param {string} options.name - MRR var only: Name to identify the pool with
	 * @param {number} options.priority - MRR var only: 0-4
	 * @param {string} [options.notes] - Additional notes to help identify the pool for you
	 * @param {number} [options.id] - Local ID (NOT MRR/NiceHash/Provider ID). If using spartanbot.createPool() no need to pass this in
	 * @async
	 * @return {Promise}
	 */
	async createPool(options) {
		if (!options.id) {
			options.id = uid()
		}

		if (this.getInternalType() === "NiceHash") {
			options = serializePool(options, "NiceHash")
			return this._createPool(options)
		}
		if (this.getInternalType() === "MiningRigRentals") {
			options = serializePool(options, "MiningRigRentals")
			try {
				return await this._createPool(options);
			} catch (err) {
				throw new Error(err)
			}
		}
	}

	/**
	 * Delete pool
	 * @param {(number|string)} id - Pool id
	 * @async
	 * @return {Promise<Object>}
	 */
	async deletePool(id) {
		try {
			return await this._deletePool(id)
		} catch (err) {
			throw new Error(`failed to delete pool ${err}`)
		}
	}

	/**
	 * Get pools
	 * @param {Array.<number>} [ids] - an array of pool ids
 	 */
	async getPools(ids) {
		if (typeof ids === 'number' && !Array.isArray(ids)) {
			try {
				return await this.getPool(id)
			} catch (err) {
				throw new Error(err)
			}
		}
		try {
			return await this._getPools(ids)
		} catch (err) {
			throw new Error(`Failed to get pools: ${err}`)
		}
	}

	/**
	 * Get pool by id
	 * @param {string|number} id - ID of the pool you want to fetch
	 */
	async getPool(id) {
		if (typeof id !== 'number' || typeof id !== 'string') {
			throw new Error('Cannot get pool: id must be of type number or string')
		}
		try {
			return await this._getPools(id)
		} catch (err) {
			throw new Error(`Failed to fetch pool: ${err}`)
		}
	}

	/**
	 * Add pools to local variable this.pools
	 * @param pools
	 */
	addPools(pools) {
		this._addPools(pools)
	}

	/**
	 * Set pools to local variable this.pools (rewrite the variable)
	 * @param pools
	 */
	setPools(pools) {
		this.pools = pools
	}

	/**
	 * Fetch this.pools
	 * @returns {Array<Object>}
	 */
	returnPools() {
		return this.pools
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
	async updatePool(id, options) {
		try {
			return await this._updatePool(id, options)
		} catch (err) {
			throw new Error(`Failed to update pool on RentalProvider.js: ${err}`)
		}
	}

	/**
	 * Set pool id to be the active pool ID for a provider (pool profile id for MRR)
	 * @param {number|string} id - pool id (pool profile id for MRR)
	 */
	setActivePool(id) {
		this._setActivePool(id)
	}

	/**
	 * Get pool id (pool profile id for MRR)
	 * @returns {number}
	 */
	returnActivePool() {
		return this._returnActivePool()
	}

	/**
	 * Get current balance
 	 * @param {string} [coin] - coin to fetch the balance for
	 * @returns {Promise<number>}
	 */
	async getBalance(coin) {
		let balance
		try {
			balance = await this._getBalance();
		} catch (err) {
			throw new Error(`Error fetching balance \n ${err}`)
		}
		if (typeof balance !== 'number')
			return parseFloat(balance)
		return balance
	}

	/**
	 * Fetch balance for all available coins
	 * @returns {Promise<Object>}
	 */
	async getBalances() {
		try {
			return await this._getBalances();
		} catch (err) {
			throw new Error(`Error fetching balances \n ${err}`)
		}
	}

	/**
	 * Add rig(s) to the existing array of active rigs IDs
	 * @param {Object|Array.<Object>} rigIDs - ID of an active rig
	 * @returns {Object} - returns an object with a success failure if the passed in arg is not an Object or an Array
	 */
	addActiveRigs(rigIDs) {
		if (Array.isArray(rigIDs)) {
			for (let id of rigIDs) {
				this.activeRigs.push(id)
			}
		} else if (typeof rigIDs === 'object' && rigIDs !== null) {
			this.activeRigs.push(rigIDs)
		} else {
			return {success: false, message: 'Rigs must be an object or an array'}
		}
		return {success: true, message: 'successfully added rigs', activeRigs: this.activeRigs}
	}

	/**
	 * Returns the active rigs set already in the local vaiable 'this.activeRigs'
	 * @returns {Array}
	 */
	returnActiveRigs() {
		return this.activeRigs
	}

	/**
	 * setActiveRigs overwrites the local variable array. Use only on construct.
	 * @param {Object|Array.<Object>} rigs - A rig object or an array of rig objects (note: rig/rental interchangeable)
	 * @returns {{success: boolean, message: string}} - Returns an object if the passed in arg is not correct type
	 */
	setActiveRigs(rigs) {
		if (Array.isArray(rigs)) {
			this.activeRigs = rigs
		} else if (typeof rigs === 'object' && rigs !== null) {
			this.activeRigs = [rigs]
		} else {
			return {success: false, message: 'Rigs must be an object or an array'}
		}
	}

	/**
	 * Fetch active rigs - calls the child class' _fetchActiveRigs function
	 * @returns {Promise<Array.<number>>} - returns an array of rig ids
	 */
	async getActiveRigs() {
		try {
			return await this._getActiveRigs()
		} catch (err) {
			throw new Error(err)
		}
	}

	/**
	 * Fetches active rigs and stores them in the local variable this.activeRigs
	 * @returns {Promise<boolean>} - returns true if store successful, false if not
	 */
	async fetchAndSetActiveRigs() {
		let rigs;
		try {
			rigs = await this.getActiveRigs()
			this.setActiveRigs(rigs)
		} catch (err) {
			throw new Error('Failed to set Current Rentals \n ${err')
		}
		return this.activeRigs === rigs;
	}

	/**
	 * Manual rent parent function that calls the private manualRent funcs of the extended classes
	 * @param {Object} options - see return value from AutoRenter -> manualRentPreprocess
	 * @returns {Promise<Object>}
	 */
	
	// Hit from AutoRenter.js rent() 
	async rent(options) {
		let rental
		if (options.market === MiningRigRentals) {
			let rigs_to_rent = []
			for (let rig of options.rigs) {
				rigs_to_rent.push(rig.rental_info)
			}
			rental =  await this._rent(rigs_to_rent)
		}
		if (options.market === NiceHash) {
			rental = await this._rent(options)
		}

		if (!Array.isArray(rental))
			rental = [rental]
		return rental
	}

	/**
	 * Cancel a rental
	 * @param {string|number} id - id of the rental order
	 * @returns {Promise<Object>}
	 */
	async cancelRental(id) {
		return await this._cancelRental(id)
	}

	/**
	 * Get back a "Serialized" state of the Provider
	 * @return {Object} Returns a JSON object that contains the current rental provider state
	 */
	serialize(){
		return {
			type: this.getInternalType(),
			api_key: this.api_key,
			api_id: this.api_id,
			api_secret: this.api_secret,
			uid: this.uid,
			pools: this.pools,
			activePool: this.activePool,
			poolProfiles: this.poolProfiles,
			activePoolProfile: this.activePoolProfile,
			activeRigs: this.activeRigs,
			name: this.name
		}
	}
}

export default RentalProvider
