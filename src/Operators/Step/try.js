'use strict';
/*md

## Operators > Step > $try

Usage: `$try: { Do: [ steps ], Catch: [ steps ], As: 'path' }`

Runs a list of steps, and runs a second list instead of halting if one of them fails.

```js
{ $try: {
	Do: [ { $call: { Name: 'ChargeCard', With: { amount: '$total' }, Into: 'receipt' } } ],
	Catch: [ { $do: { paid: false, why: '$error.Message' } } ],
	As: 'error',
} }
```

`Do` is the list of steps to run.
`Catch` is the list to run instead if one of them fails.
`As` is optional, and names a field in the state where the error is written before `Catch`
  runs, as `{ Code, Message, Cursor }`.

***A `$try` catches a failure raised by running a step, and nothing else.***
An operator which refused, a [`$throw`](#$throw), and a call the host reported as failed
  through [`Resume()`](./Process.md) are all caught.
A fault in the process document is not:
  `BadProcess`, `BadRun`, `NoSuchStep`, `UnknownOperator`, `ResumeNotWaiting` and
  `StepLimitExceeded` halt the run whatever it is wrapped in.

That line is the difference between an error and a bug.
A process which mishandles a declined card is doing its job;
  a process with a misspelled operator name in it is broken, and a `$try` which swallowed that
  would turn every typo into a silently handled error.
`StepLimitExceeded` is on the list for a different reason:
  it is the caller's protection against a process which does not end,
  and a process must not be able to defeat it from the inside.

***A failure raised inside `Catch` is not caught by the same `Catch`.***
It is offered to the next `$try` outward, and halts the run if there is none.
Without that rule a handler which failed would hand itself its own failure forever.

***The handler sees the state as the failure left it.***
A step which changed the state and then failed did change it.
Rolling that back would mean holding a copy of the state at every step in case one were
  needed, which is a transaction and is not what this is.

***The field `As` names stays on the state after the handler runs.***
Unlike a loop's `As`, which is rewritten every pass and would otherwise leave the last element
  behind, an error is written once and deliberately.
Take it off with `{ $do: { error: '$$REMOVE' } }` when it is not wanted.

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

		// ***The declaration which makes this a handler.*** The runtime, on a failure, walks
		// out through the cursor looking for a step which guards the branch the failure came
		// from. Naming the two branches here rather than in the runtime is what keeps
		// src/jsongin/Process.js from knowing that this operator exists - the same way
		// Repeats keeps it from knowing about $while.
		Catches: { From: 'Do', Into: 'Catch' },

		//---------------------------------------------------------------------
		// ***The operator does nothing but enter its body.*** Catching is not something it
		// does; it is something the runtime does to it, by finding this step on the way out
		// of a failure. That is why there is no state to keep and nothing to undo, and why a
		// $try whose body succeeds costs one step and then behaves like any other branch -
		// the walk out of Do goes past the step, and Catch is never reached.
		Step: function ( State, Args, Scope, Position )
		{
			function bad_process( Message )
			{
				let error = new Error( Message );
				error.Code = 'BadProcess';
				return error;
			}

			if ( jsongin.ShortType( Args.Do ) !== 'a' )
			{
				throw bad_process( `$try requires a Do array of steps.` );
			}
			if ( Args.Do.length === 0 )
			{
				throw bad_process( `$try requires at least one step in Do. There is nothing to guard.` );
			}
			if ( jsongin.ShortType( Args.Catch ) !== 'a' )
			{
				throw bad_process( `$try requires a Catch array of steps.` );
			}
			if ( Args.Catch.length === 0 )
			{
				throw bad_process( `$try requires at least one step in Catch. A handler which does nothing catches nothing.` );
			}
			if ( ( typeof Args.As !== 'undefined' ) && ( jsongin.ShortType( Args.As ) !== 's' ) )
			{
				throw bad_process( `$try requires As to be a field name, not a [${jsongin.ShortType( Args.As )}].` );
			}

			return { Action: 'enter', Branch: 'Do' };
		},

	};

	// Return the operator.
	return operator;
};
