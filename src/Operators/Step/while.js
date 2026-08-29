'use strict';
/*md

## Operators > Step > $while

Usage: `$while: { Check: query, Do: [ steps ] }`

Runs a list of steps over and over, for as long as the state matches a query.

```js
{ $while: {
	Check: { remaining: { $gt: 0 } },
	Do: [
		{ $do: { remaining: { $subtract: [ '$remaining', 1 ] } } },
		{ $do: { done: { $add: [ '$done', 1 ] } } },
	],
} }
```

***The check is made before each pass, so a loop may run no times at all.***
A `Check` which does not match when the step is first reached advances past it,
  the same way a `$when` with no matching branch does.

***`Check` is a query, and it does not carry the run's variables.***
This is the same rule `$when` follows, for the same reason:
  `Query()` takes no scope, so a `$$name` bound by the run is not visible inside `Check`.
Compute the value into the state with `$do` first and check the field.

***One pass of the loop is several steps, not one.***
The loop is re-entered through the cursor, so a run stopped in the middle of a pass is an
  ordinary run which can be stored and picked up later.
That is what lets a `$call` sit inside a loop body.

***A loop with no body is a bad process.***
`{ $while: { Check: <anything>, Do: [] } }` cannot make progress and cannot end,
  so it fails at the step rather than quietly not looping.
This is the one case where an empty branch is an error:
  a missing `Then` means there is nothing to do, while a missing `Do` means there is nothing
  that could ever change the answer to `Check`.

***A loop which does not end is stopped by the budget, not by this operator.***
`Execute()` fails a run with `StepLimitExceeded` after `MaxSteps` steps, 1000 by default.
`Step()` needs no budget, because one step cannot loop.

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

		// ***The declaration which makes this a loop rather than a branch.*** The runtime
		// walks past an ordinary step once a branch of it has ended; a step which repeats is
		// asked again instead. See repeats_at in src/jsongin/Process.js.
		Repeats: true,

		//---------------------------------------------------------------------
		// ***There is no iteration state to keep, which is why $while is the simpler loop.***
		// The operator asks the same question every time it is reached and answers it from
		// the state alone, so being re-entered is not different from being reached, and the
		// Reentry the runtime offers is not read.
		//
		// The Scope is declared and not used, for the reason given in when.js: Query() takes
		// no scope, and every step operator has the same signature.
		Step: function ( State, Args, Scope, Position )
		{
			// ***These are faults in the process document, not in the state it is running
			// over***, so they are reported as BadProcess rather than StepFailed. None of
			// them depends on what the run has computed: a process which fails one of them
			// fails it the first time the step is reached, every time, on any input.
			function bad_process( Message )
			{
				let error = new Error( Message );
				error.Code = 'BadProcess';
				return error;
			}

			if ( jsongin.ShortType( Args.Check ) !== 'o' )
			{
				throw bad_process( `$while requires a Check query.` );
			}
			if ( jsongin.ShortType( Args.Do ) !== 'a' )
			{
				throw bad_process( `$while requires a Do array of steps.` );
			}

			// A body which cannot run is a loop which cannot end. Refused here rather than
			// left to the step budget, so that the failure names the mistake.
			if ( Args.Do.length === 0 )
			{
				throw bad_process( `$while requires at least one step in Do. A loop with an empty body cannot end.` );
			}

			let matched = jsongin.Query( State, Args.Check );
			if ( matched === false ) { return { Action: 'next' }; }

			return { Action: 'enter', Branch: 'Do' };
		},

	};

	// Return the operator.
	return operator;
};
