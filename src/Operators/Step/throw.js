'use strict';
/*md

## Operators > Step > $throw

Usage: `$throw: expression`

Fails the run on purpose.

```js
{ $throw: 'the cart is empty' }
{ $throw: { Code: 'CartEmpty', Message: { $concat: [ 'nothing to charge for ', '$customer' ] } } }
```

The expression is evaluated against the current state, and may produce either form:

| Produces | Becomes |
|---|---|
| a string | `{ Code: 'Thrown', Message: <the string> }` |
| a document | `{ Code, Message }`, with `Code` defaulting to `Thrown` |

The nearest enclosing [`$try`](#$try) catches it.
With no `$try` around it the run halts with `Status: 'failed'` and that error.

***`Thrown` is the default code so that a deliberate failure can be told from an engine one.***
A handler which cares can check it - `{ $when: { Check: { 'error.Code': 'CartEmpty' } } }` -
  which is why the error goes into the state rather than into a variable.

***A `$throw` may not name one of the engine's own codes.***
`BadProcess`, `BadRun`, `NoSuchStep`, `UnknownOperator`, `ResumeNotWaiting` and
  `StepLimitExceeded` are reserved, and naming one is itself a `BadProcess`.
Those are the codes a `$try` refuses to catch, so a process which could raise one would be
  able to reach past every handler around it and halt the run - which is the caller's decision
  to make and not the process's.

*/

module.exports = function ( jsonproc )
{
	// The jsongin engine this runtime evaluates against. It is aliased once, here, so that
	// every line below reads the way it did while the runtime lived inside jsongin itself.
	const jsongin = jsonproc.jsongin;


	// The codes which mean "this process, or this engine, is broken". Kept in step with
	// UNCATCHABLE in src/jsongin/Process.js, which is the list a $try refuses to catch.
	const RESERVED = [ 'BadProcess', 'BadRun', 'NoSuchStep', 'UnknownOperator', 'ResumeNotWaiting', 'StepLimitExceeded' ];

	let operator =
	{

		//---------------------------------------------------------------------
		Engine: jsongin,

		// Any value a jsongin document can hold, the same as $return. What a failure is called
		// is the process author's business, and the two forms below are read from the result.
		ArgTypes: 'bnsladoru',

		//---------------------------------------------------------------------
		// ***The operator throws, and the runtime decides how loudly.*** It does not know
		// whether a $try is above it and has no way to find out; it reports, and the walk out
		// through the cursor in Process.js either finds a handler or does not. That is the
		// standing rule of this engine, and it is why this operator is nine lines long.
		Step: function ( State, Args, Scope, Position )
		{
			let scope = Scope.ForDocument( State );
			let thrown = jsongin.Evaluate( State, Args, scope );

			let code = 'Thrown';
			let message = '';

			let st_thrown = jsongin.ShortType( thrown );
			if ( st_thrown === 'o' )
			{
				if ( jsongin.ShortType( thrown.Code ) === 's' ) { code = thrown.Code; }
				if ( jsongin.ShortType( thrown.Message ) === 's' ) { message = thrown.Message; }
			}
			else if ( st_thrown === 's' ) { message = thrown; }
			else if ( ( st_thrown !== 'u' ) && ( st_thrown !== 'l' ) ) { message = String( thrown ); }

			if ( RESERVED.includes( code ) === true )
			{
				let refused = new Error( `$throw may not name the reserved code [${code}]. Those are the codes a $try refuses to catch.` );
				refused.Code = 'BadProcess';
				throw refused;
			}

			let error = new Error( message );
			error.Code = code;
			throw error;
		},

	};

	// Return the operator.
	return operator;
};
