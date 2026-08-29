'use strict';
/*md

## Operators > Step > $do

Usage: `$do: { field: expression, ... }`

Changes the state of a running process.
Each field is computed from the current state and written to it, leaving the other fields in place.

```js
{ $do: { total: { $add: [ '$sub', '$tax' ] } } }
{ $do: { discount: 0 } }
```

***This is the aggregation `$set` stage, not the update operator of the same name.***
The distinction is the whole reason the operator exists.
The stage family computes, so `{ $add: [ '$sub', '$tax' ] }` is arithmetic;
  the update family stores, so the same document written through `Update()` is kept as a literal.
A process must compute, so `$do` is the stage.

The cost of that choice is worth stating plainly:
  `$inc`, `$mul` and `$push` have no stage equivalent,
  so a counter is incremented by writing `{ $do: { n: { $add: [ '$n', 1 ] } } }`.
MongoDB made the same trade in its update-with-pipeline form.

***An expression which produces nothing removes the field***, exactly as it does in `$addFields`.
Writing `'$$REMOVE'` takes a field off the state.

*/

module.exports = function ( jsonproc )
{
	// The jsongin engine this runtime evaluates against. It is aliased once, here, so that
	// every line below reads the way it did while the runtime lived inside jsongin itself.
	const jsongin = jsonproc.jsongin;


	let operator =
	{

		//---------------------------------------------------------------------
		Engine: jsongin,
		ArgTypes: 'o',

		//---------------------------------------------------------------------
		// ***The implementation is the $addFields stage itself, not a copy of it.***
		// The documentation above claims $do has the semantics of the aggregation stage; the
		// way to keep that claim true is to run the stage rather than to reimplement what it
		// does. $$REMOVE, the clone before the write, and the rule that every expression sees
		// the state as it was at the top of the step all come along for free.
		Step: function ( State, Args, Scope )
		{
			let stage = jsongin.StageOperators.$addFields;
			let results = stage.ApplyFields( [ State ], Args, '$do', Scope );
			return { Action: 'next', State: results[ 0 ] };
		},

	};

	// Return the operator.
	return operator;
};
