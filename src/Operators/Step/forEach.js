'use strict';
/*md

## Operators > Step > $forEach

Usage: `$forEach: { In: expression, As: 'path', Index: 'path', Do: [ steps ] }`

Runs a list of steps once for each element of an array.

```js
{ $forEach: {
	In: '$orders',
	As: 'order',
	Index: 'position',
	Do: [ { $do: { total: { $add: [ '$total', '$order.amount' ] } } } ],
} }
```

`In` is an expression which must produce an array.
`As` names a field in the state where each element is written before its pass runs.
`Index` is optional, and names a field where the element's position is written alongside it.
`Do` is the list of steps to run for each element.

***The element is written into the state, not bound as a `$$name`.***
That is the whole reason the loop is usable:
  `Check` in a `$when` or a `$while` is a query, and `Query()` takes no scope,
  so a `$$name` would be invisible to exactly the test a loop body most often wants to make.
Written into the state it is reachable both ways -
  as `'$order'` in an expression and as `{ order: ... }` in a query.

***`As` and `Index` name fields the loop owns.***
They are removed from the state when the loop ends, so a process which ran a loop does not
  carry its last element around afterward.
A loop which ran no passes removes nothing, because it wrote nothing.

***A pass is several steps, and the iteration lives in the cursor.***
The cursor's branch element is `[ 'Do', 3 ]` while the fourth pass is running.
Nothing about where the loop has got to is kept in the state, which is what lets a run be
  stored in the middle of a pass and resumed - a `$call` inside `Do` works exactly as it does
  anywhere else.

***`In` is evaluated again before each pass.***
A body which appends to the array is a work list which grows,
  and a body which shortens it ends the loop early.
This is deliberate and it is the reason `Execute()` has a budget:
  a body which appends forever fails with `StepLimitExceeded` rather than running forever.

***A loop with no body is a bad process***, the same as it is for `$while`.

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

		// See the note in while.js. This is what makes the runtime hand control back to the
		// step when a pass of its body ends, rather than walking past it.
		Repeats: true,

		//---------------------------------------------------------------------
		// ***The runtime says which pass just ended; the operator does not work it out.***
		// Position.Reentry is the branch element the cursor climbed out of - [ 'Do', 3 ] - or
		// null when the step has been reached rather than returned to.
		//
		// Inferring it from the state instead would mean reading the Index field and treating
		// a value there as proof of a pass already run, which would start the loop in the
		// middle whenever the input document happened to carry a field of that name. The
		// runtime knows the answer for certain, so it is asked.
		Step: function ( State, Args, Scope, Position )
		{
			// Faults in the process document rather than in the state, reported as such.
			// See the same helper and the same reasoning in while.js.
			function bad_process( Message )
			{
				let error = new Error( Message );
				error.Code = 'BadProcess';
				return error;
			}

			if ( jsongin.ShortType( Args.As ) !== 's' )
			{
				throw bad_process( `$forEach requires an As field name.` );
			}
			if ( jsongin.ShortType( Args.Do ) !== 'a' )
			{
				throw bad_process( `$forEach requires a Do array of steps.` );
			}
			if ( Args.Do.length === 0 )
			{
				throw bad_process( `$forEach requires at least one step in Do. A loop with an empty body does nothing.` );
			}
			if ( ( typeof Args.Index !== 'undefined' ) && ( jsongin.ShortType( Args.Index ) !== 's' ) )
			{
				throw bad_process( `$forEach requires Index to be a field name, not a [${jsongin.ShortType( Args.Index )}].` );
			}

			let scope = Scope.ForDocument( State );
			let items = jsongin.Evaluate( State, Args.In, scope );
			if ( jsongin.ShortType( items ) !== 'a' )
			{
				throw new Error( `$forEach requires In to produce an array, not a [${jsongin.ShortType( items )}].` );
			}

			// Which pass to run next. A first arrival starts at zero; a return carries the
			// pass which just ended in the second element of its branch.
			let next = 0;
			let returning = ( jsongin.ShortType( Position.Reentry ) === 'a' );
			if ( returning === true ) { next = Position.Reentry[ 1 ] + 1; }

			if ( next >= items.length )
			{
				// The loop is over. Its two fields are taken off the state, but only if it
				// ever put them there - a loop over an empty array leaves the state alone,
				// including a field which happened to share the name.
				if ( returning === false ) { return { Action: 'next' }; }

				let cleaned = jsongin.SafeClone( State );
				jsongin.DeleteValue( cleaned, Args.As );
				if ( jsongin.ShortType( Args.Index ) === 's' ) { jsongin.DeleteValue( cleaned, Args.Index ); }
				return { Action: 'next', State: cleaned };
			}

			// The element is cloned on the way in, so that a body which changes it does not
			// reach back into the array the loop is walking.
			let state = jsongin.SafeClone( State );
			jsongin.SetValue( state, Args.As, jsongin.SafeClone( items[ next ] ) );
			if ( jsongin.ShortType( Args.Index ) === 's' ) { jsongin.SetValue( state, Args.Index, next ); }

			return { Action: 'enter', Branch: 'Do', Iteration: next, State: state };
		},

	};

	// Return the operator.
	return operator;
};
