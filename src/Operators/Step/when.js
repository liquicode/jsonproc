'use strict';
/*md

## Operators > Step > $when

Usage: `$when: { Check: query, Then: [ steps ], Else: [ steps ] }`

Runs one of two lists of steps, according to whether the state matches a query.

```js
{ $when: {
	Check: { total: { $gt: 100 } },
	Then: [ { $do: { discount: { $multiply: [ '$total', 0.1 ] } } } ],
	Else: [ { $do: { discount: 0 } } ],
} }
```

***`Check` is a query, not an expression.***
A query is what a MongoDB user reaches for first,
  and a query can already hold `$expr` when an expression is wanted,
  which is MongoDB's own answer to this same question.

`Else` is optional.
A check which fails with no `Else` simply advances past the step,
  and so does a branch which is present but empty.

***A query does not carry the run's variables.***
`Query()` takes no scope - see the non-goals in the process guide - so a `$$name` bound by the
  run is not visible inside `Check`, even within an `$expr`.
Compute the value into the state with `$do` first and check the field.

*/

module.exports = function ( jsonproc )
{
	// The jsongin engine this runtime evaluates against. It is aliased once, here, so that
	// every line below reads the way it did while the runtime lived inside jsongin itself.
	const jsongin = jsonproc.jsongin;

	// Readies a Check: refuses one which cannot run, and fixes $$NOW to the run's instant.
	const CHECK = require( '../../jsonproc/Check' )( jsonproc );


	let operator =
	{

		//---------------------------------------------------------------------
		Engine: jsongin,
		ArgTypes: 'o',

		//---------------------------------------------------------------------
		// ***The operator names a branch, it does not run one.*** Returning 'enter' leaves
		// the engine to push the branch onto the cursor, which is what makes a run inside a
		// branch storable: the position is data, not a call stack.
		//
		// Query() takes no scope, so the Scope is read for one thing only: the run's $$NOW,
		// which src/jsonproc/Check.js writes into the Check. A Check which is missing, or
		// which jsongin refuses, is refused there as BadProcess.
		Step: function ( State, Args, Scope )
		{
			let check = CHECK.Prepare( '$when', Args.Check, Scope );

			let matched = jsongin.Query( State, check );
			let branch = matched ? 'Then' : 'Else';

			// A branch which is not there, and an empty one, both mean the same thing: there
			// is nothing to run, so the process moves on.
			if ( jsongin.ShortType( Args[ branch ] ) !== 'a' ) { return { Action: 'next' }; }
			if ( Args[ branch ].length === 0 ) { return { Action: 'next' }; }

			return { Action: 'enter', Branch: branch };
		},

	};

	// Return the operator.
	return operator;
};
