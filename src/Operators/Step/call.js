'use strict';
/*md

## Operators > Step > $call

Usage: `$call: { Name: 'name', With: { field: expression, ... }, Into: 'path' }`

Suspends the run so that the host can do something the engine cannot.

```js
{ $call: { Name: 'ChargeCard', With: { amount: '$total' }, Into: 'receipt' } }
```

***`$call` does not call.***
The step produces a run with `Status: 'waiting'` and a `Waiting` descriptor naming what is
  wanted, and there it stops.
The engine performs no I/O, has no dependency, and contains no `async`.
The host reads the descriptor, does the work, does the awaiting, and hands the answer back
  with `Resume()`.

`With` is evaluated as an expression document against the current state, so the descriptor the
  host receives holds values rather than expressions.
`Into` names a path in the state where the result is written, and is optional:
  a call whose result is not wanted omits it.

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
		// ***With is evaluated here rather than when the host reads it***, so that the
		// descriptor is a value like everything else on the run. A run stored while it waits
		// and resumed a day later hands the host the amount computed at the moment the step
		// ran, not the one an expression would compute against a state which has moved on.
		Step: function ( State, Args, Scope )
		{
			if ( jsongin.ShortType( Args.Name ) !== 's' )
			{
				throw new Error( `$call requires a Name.` );
			}

			let scope = Scope.ForDocument( State );

			let with_values = {};
			if ( typeof Args.With !== 'undefined' )
			{
				with_values = jsongin.Evaluate( State, Args.With, scope );
			}

			let waiting = {
				Name: Args.Name,
				With: with_values,
			};
			if ( jsongin.ShortType( Args.Into ) === 's' ) { waiting.Into = Args.Into; }

			return { Action: 'wait', Waiting: waiting };
		},

	};

	// Return the operator.
	return operator;
};
