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
		// The Scope is declared and not used, because Query() takes no scope. It stays in the
		// signature so that every step operator has the same one, and so that the day a query
		// can carry a scope this file is where it starts.
		Step: function ( State, Args, Scope )
		{
			if ( jsongin.ShortType( Args.Check ) !== 'o' )
			{
				throw new Error( `$when requires a Check query.` );
			}

			let matched = jsongin.Query( State, Args.Check );
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
