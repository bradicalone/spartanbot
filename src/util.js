export function selectBestCombination(original_array, target_value, object_value_function) {
	if (!object_value_function)
		object_value_function = function(obj){ return obj }

	var best_match = []

	var total_up_array = function(my_array){
		var total = 0;

		for (var obj of my_array){
			total += parseFloat(object_value_function(obj))
		}

		return total
	}

	var stop_for_loop = false
	var recurse_combos = function(array_prefix, array_to_use) {
		for (var i = 0; i < array_to_use.length; i++) {
			if (stop_for_loop)
				break;

			// copy the array
			var result_arr = array_prefix.slice(0, array_prefix.length)
			result_arr.push(array_to_use[i])

			if (total_up_array(result_arr) > total_up_array(best_match) && total_up_array(result_arr) <= target_value)
				best_match = result_arr

			if (total_up_array(best_match) === target_value)
				stop_for_loop = true
			
			recurse_combos(result_arr, array_to_use.slice(i + 1));
		}
	}

	recurse_combos([], original_array);

	return best_match;
}