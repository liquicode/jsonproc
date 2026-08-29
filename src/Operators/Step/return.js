'use strict';
/*md

## Operators > Step > $return

Usage: `$return: expression`

Halts the run, and names what it produced.

```js
{ $return: '$receipt' }
{ $return: { paid: '$total', when: '$$NOW' } }
```

The expression is evaluated against the current state.
The run comes back with `Status: 'done'` and the value in `Result`.

***Running off the end of the top level `Steps` does the same thing as `{ $return: '$$ROOT' }`.***
A process which computes and never says so still hands back the work it did.

***An expression which produces nothing leaves the run with no `Result` at all***,
  rather than with a `Result` of `undefined`.
That is a storage rule and not a nicety:
  a field set to `undefined` does not survive being written down and read back,
  and a run which cannot be stored is not a run.

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

		// Any value a jsongin document can hold. A halt is allowed to produce a number, a
		// string, a document, or nothing at all - there is no argument shape to enforce.
		ArgTypes: 'bnsladoru',

		//---------------------------------------------------------------------
		Step: function ( State, Args, Scope )
		{
			let scope = Scope.ForDocument( State );
			let value = jsongin.Evaluate( State, Args, scope );
			return { Action: 'halt', Result: value };
		},

	};

	// Return the operator.
	return operator;
};
