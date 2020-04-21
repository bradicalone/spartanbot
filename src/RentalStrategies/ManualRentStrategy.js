import GenericStrategy from './GenericStrategy'
import {TriggerRental, ManualRent} from "../constants";

class ManualRentStrategy extends GenericStrategy {
	constructor(settings){
		super(settings);

		this.type = ManualRent
		this.startup()
	}

	static getType(){
		return ManualRent
	}

	startup(){
		this.emitter.on(ManualRent, (options, rentSelector) => { // 2nd
			this.emitter.emit(TriggerRental, options, rentSelector) // => GenerticStrategy.js 3rd, => SpartanBot.js rent()
		})
	}

	manualRent(options, rentSelector) {
		this.emitter.emit(ManualRent, options, rentSelector) // => Hits emitter.on in startup() above  1st 
	}

}

export default ManualRentStrategy
