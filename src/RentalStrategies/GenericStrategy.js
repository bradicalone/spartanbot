import uid from 'uid'
import EventEmitter from 'eventemitter3'
import {TriggerRental, GENERIC} from "../constants";

class GenericStrategy {
	constructor(settings){
		this.type = GENERIC

		this.uid = settings.uid || uid()
		this.emitter = new EventEmitter()

	}
	// <= Get hit from SpartanBot.js => strat.onRentalTrigger(this.rent.bind(this));
	onRentalTrigger(rentalFunction){
		this.emitter.on(TriggerRental, rentalFunction) // <= Gets hit from ManualRentStrategy.js 
	}

	setUID(id) {
		this.uid = id
	}

	getUID(){
		return this.uid
	}

	getInternalType() {
		return this.type
	}

	static getType(){
		return GENERIC
	}

	serialize(){
		return {
			type: this.type,
			uid: this.uid
		}
	}
}

export default GenericStrategy
