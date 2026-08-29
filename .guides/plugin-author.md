# Plugin / Step Operator Author Guide

`jsonproc` is extended by writing ***step operators*** and registering them into a runtime
  instance.

The full guide lives with the published documentation:

- [`docs/guides/Operator-Authoring.md`](../docs/guides/Operator-Authoring.md)

That document covers the step contract, the four actions an outcome can name, the scope rules,
  how to report problems through `OpLog` / `OpError`, and how registration works.

For the query, expression, update, stage and accumulator operators a step ***computes*** with,
  see jsongin's own guide instead. Those belong to the engine, not to this runtime.


## The Short Version

A step operator module exports a factory which takes the runtime and returns an operator object:

```js
module.exports = function ( jsonproc )
{
	const jsongin = jsonproc.jsongin;

	return {
		Engine: jsonproc,
		Step: function ( State, Args, Scope, Position )
		{
			return { Action: 'next' };
		},
	};
};
```

Register it on an instance:

```js
const jsonproc = require( '@liquicode/jsonproc' ).NewJsonproc();
jsonproc.StepOperators.$myStep = require( './myStep' )( jsonproc );
```

There is one registry, and it is a plain object on the instance: `StepOperators`.

An outcome names an `Action`: `next`, `enter`, `wait`, or `halt`. Anything else fails the run.
An operator which loops also declares `Repeats: true`, which is what makes the runtime land back
  on the step when a pass of its body ends instead of walking past it. `$while` and `$forEach`
  are the only two.


## If You Are Contributing an Operator Back

- One operator per file, under `src/Operators/Step/`.
- Register it in `src/jsonproc.js`.
- Add an `/*md` block at the top of the file describing its usage. `npm run check-docs` fails a
  file which has none.
- Give it a section in `docs/guides/jsonproc/Step-Operators.md`, with an `<a id="$name">` anchor.
- Add tests to `test/Unit Tests/100) Process Runtime Tests.js`, and add a fixture to
  `build/process-check.js` so the eight invariants are applied to it too. See
  [`docs/guides/Testing.md`](../docs/guides/Testing.md).
