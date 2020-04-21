import MRRProvider from '../src/RentalProviders/MRRProvider';
import { config } from 'dotenv'
config()

const apikey = {
	api_key: process.env.MRR_API_KEY,
	api_secret: process.env.MRR_API_SECRET
};


describe("MRRProvider", () => {
	it('should authorize MRR API access | testAuthorization', async () => {
		let mrr = new MRRProvider(apikey);
		let success = await mrr.testAuthorization();
		expect(success).toBeTruthy()
	});
	it('should get my profile ID | getProfileID', async () => {
		let mrr = new MRRProvider(apikey);
		let profileID = await mrr.getProfileID();
		expect(typeof profileID === 'string').toBeTruthy()
	});
	it('get default account balance (BTC) | _getBalance', async () => {
		let mrr = new MRRProvider(apikey);
		let balance = await mrr._getBalance();
		expect(typeof balance === 'number').toBeTruthy()
	});
	it('get account balance for another coin| _getBalance', async () => {
		let mrr = new MRRProvider(apikey);
		let balance = await mrr._getBalance('ltc');
		expect(typeof balance === 'number').toBeTruthy()
	});
	it('get all balances | _getBalances', async () => {
		let mrr = new MRRProvider(apikey);
		let balance = await mrr._getBalances();
		expect(balance.success === undefined).toBeTruthy()
	});
	it('should fetch qualified rigs| getRigsToRent', async () =>{
		let mrr = new MRRProvider(apikey);
		let hashMh = 10000, duration = 5;
		let rigs = await mrr.getRigsToRent(hashMh, duration);
		// console.log(rigs)

		let hashpower = 0;
		for (let rig of rigs) {
			hashpower += rig.hashrate
		}
		// console.log(hashpower)
		let enoughHash= false
		if (hashpower <= hashMh) {
			enoughHash = true
		}
		expect(enoughHash).toBeTruthy()

	});
	it.skip('rent rigs', async () => {
		let mrr = new MRRProvider(apikey);
		let rentOptions = {
			hashrate: 1000,
			duration: 4,
			confirm: confirmFn
		}
		let rentalConfirmation = await mrr.rent(rentOptions);
		console.log(rentalConfirmation)
		let success;
		if (rentalConfirmation.info === 'Rental Cancelled') {
			success = true
		} else if (rentalConfirmation.success) {
			success = true
		} else {
			success = false
		}
		expect(success).toBeTruthy()
		// console.log('rental confirmation: ', rentalConfirmation)
	}, 250 * 1000);
	it.skip('rent rigs with insufficient balance (set manually) | rent', async () => {
		//must set balance manually in rent function to test
		let mrr = new MRRProvider(apikey);
		let response = await mrr.rent({
			hashrate: 5000,
			duration: 5,
			confirm: confirmFn
		})
		// console.log(response)
	});
	it('create pool and add it to profile | createPoolAndProfile', async () => {
		let mrr = new MRRProvider(apikey);
		let options = {
			profileName: 'test',
			algo: 'test',
			name: 'test',
			host: 'test',
			port: 8080,
			user: 'test',
			priority: 0,
			notes: 'test'
		};
		let response = await mrr.createPoolAndProfile(options)
		expect(response.success).toBeTruthy()

		let profileID = response.success.profileID
		let poolID = response.pool.id
		await mrr.deletePoolProfile(profileID)
		await mrr.deletePool(poolID)
	}, 250 * 1000);
	it('get all pools | getPools', async () => {
		let mrr = new MRRProvider(apikey);
		let response = await mrr.getPools()
		// console.log(response)
		expect(Array.isArray(response)).toBeTruthy()
	});
	it('get pools by ID| getPools', async () => {
		let mrr = new MRRProvider(apikey);
		let pools = await mrr.getPools()
		let poolIDs = []
		if (pools.length > 0) {
			for (let pool of pools) {
				poolIDs.push(pool.id)
			}
			let response = await mrr.getPools(poolIDs)
			expect(response.length === pools.length)
		}
	});
	it('get all pool profiles | getPoolProviders', async () => {
		let mrr = new MRRProvider(apikey);
		let response = await mrr.getPoolProfiles()
		// console.log(response)
		expect(response.success).toBeTruthy()
	});
	it('add active rentals to local variable', async () => {
		let mrr = new MRRProvider(apikey);
		let rigs = await mrr.fetchAndSetActiveRigs()
		expect(await mrr.getActiveRigs() === rigs)
	})
})

let confirmFn = async (data) => {
	return true
	// setTimeout( () => {
	// 	Promise.resolve(true)
	// }, 2000)
}
