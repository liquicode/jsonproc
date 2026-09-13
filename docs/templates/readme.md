# <%- Context.Package.name %>

> Home: [<%- Context.Package.homepage %>](<%- Context.Package.homepage %>)
>
> Version: <%- Context.Package.version %>

### A Process Runtime for JSON Documents


<!-- Note: the links below are root-absolute, beginning with /docs/.
     GitHub resolves a leading slash from the repository root, so these reach
     docs/guides/... there. The docsify site runs with an alias that rewrites
     /docs/(.*) to /$1, so the same links route within the site. This keeps one
     source of truth for a file published to both the repo root and docs/external. -->


Quick Reference
---------------------------------------------------------------------

- [Library Guide](/docs/guides/Library-Guide.md)
- [The Process Runtime](/docs/guides/jsonproc/Process.md)
- [Step Operators](/docs/guides/jsonproc/Step-Operators.md)
- [Operator Authoring](/docs/guides/Operator-Authoring.md)
- [Project History](/docs/external/history.md)


Installation Guides
---------------------------------------------------------------------

- [NodeJS Usage](/docs/guides/Usage-NodeJS.md)
- [Browser Usage](/docs/guides/Usage-Browser.md)

```bash
npm install --save @liquicode/jsonproc
```

```js
const jsonproc = require( '@liquicode/jsonproc' );
```


Overview
---------------------------------------------------------------------

A ***process*** is a JSON document describing work.
A ***run*** is a JSON value recording how far that work has got.

`jsonproc` takes a process and a run and returns the next run.
***It keeps nothing between calls***, so a run can be stored and continued later, somewhere else.

```js
const checkout = {
	Name: 'Checkout',
	Steps: [
		{ $do: { total: { $add: [ '$sub', '$tax' ] } } },
		{ $call: { Name: 'ChargeCard', With: { amount: '$total' }, Into: 'receipt' } },
		{ $return: '$receipt' },
	],
};

let run = jsonproc.Execute( checkout, jsonproc.Start( checkout, { sub: 100, tax: 8 } ) );
run.Status         // returns 'waiting'
run.Waiting.With   // returns { amount: 108 }

// $call does not call anything. Your code does the work and passes the answer back.
run = jsonproc.Execute( checkout, jsonproc.Resume( checkout, run, { paid: true } ) );
run.Result         // returns { paid: true }
```

***Pass the process with every call.*** The run records only the process's `Name`, and a call
  with a process of a different name fails.


The Four Functions
---------------------------------------------------------------------

| Function | Does |
|---|---|
| [`Start( Process, Input )`](/docs/guides/jsonproc/Process.md) | Begins a run, with a copy of `Input` as its state. |
| [`Step( Process, Run )`](/docs/guides/jsonproc/Process.md) | Runs one step and returns a new run. A run which is not `ready` comes back unchanged. |
| [`Execute( Process, Run, MaxSteps )`](/docs/guides/jsonproc/Process.md) | Steps until the run is not `ready`. Fails the run after `MaxSteps` steps, 1000 by default. |
| [`Resume( Process, Run, Result, Error )`](/docs/guides/jsonproc/Process.md) | Gives a `waiting` run the result of its `$call`, or reports that the call failed. |

***None of these functions throws.***
A failure is a run with `Status: 'failed'` and an `Error` you can inspect.

```js
const broken = { Name: 'Broken', Steps: [ { $nosuch: {} } ] };

let failed = jsonproc.Step( broken, jsonproc.Start( broken, {} ) );
failed.Status        // returns 'failed'
failed.Error.Code    // returns 'UnknownOperator'
```


The Step Operators
---------------------------------------------------------------------

| Operator | Usage |
|---|---|
| `$do`      | `{ $do: { field: expression, ... } }` |
| `$when`    | `{ $when: { Check: query, Then: [ steps ], Else: [ steps ] } }` |
| `$while`   | `{ $while: { Check: query, Do: [ steps ] } }` |
| `$forEach` | `{ $forEach: { In: expression, As: 'path', Do: [ steps ] } }` |
| `$try`     | `{ $try: { Do: [ steps ], Catch: [ steps ], As: 'path' } }` |
| `$throw`   | `{ $throw: expression }` |
| `$call`    | `{ $call: { Name: 'name', With: { ... }, Into: 'path' } }` |
| `$return`  | `{ $return: expression }` |

Each step is ***one document with one step operator***, like a pipeline stage.

See [Step Operators](/docs/guides/jsonproc/Step-Operators.md).


Built On jsongin
---------------------------------------------------------------------

Every expression and query in a step is evaluated by
  [`@liquicode/jsongin`](http://jsongin.liquicode.com), and follows MongoDB.

- ***`'$field'` reads the state.*** The state is `$$CURRENT` and `$$ROOT`.
- ***`'$$name'` reads a variable.*** `$let`, `$map`, `$filter` and `$reduce` work as they do
  anywhere in jsongin.
- ***A `Check` is a query***, so `{ total: { $gt: 100 } }` means what it means in `Query()`.

To use a jsongin engine with operators of your own, pass it as a setting:

```js
const jsongin = require( '@liquicode/jsongin' ).NewJsongin();
const runtime = require( '@liquicode/jsonproc' ).NewJsonproc( { jsongin: jsongin } );

runtime.jsongin === jsongin
```


Features
---------------------------------------------------------------------

- A Process is Data:
	- A process is a JSON document, so it can be stored, sent, generated and reviewed like any
	  other data.
	- A run is a JSON value, so an unfinished run survives a restart.
	- `Format()` and `Parse()` with `TypedValues` store a run exactly, dates included.

- Your Code Does the Work:
	- `$call` suspends the run and describes what it wants.
	- Your code does the work however and whenever it likes, and passes the answer to `Resume()`.
	- Many runs can be outstanding at once, because runs share nothing.

- Checked by Invariants:
	- `npm run process-check` checks rules such as "storage is transparent" and "`Step` never
	  throws" at every step of a set of fixture processes.
	- See [Testing](/docs/guides/Testing.md).

- Developer Features:
	- One runtime dependency: `@liquicode/jsongin`.
	- Pure Javascript, on the server and in the browser.
	- Single minified file (~<%- Context.Bundle.Kb %>k, ~<%- Context.Bundle.CompressedKb %>k compressed) for web deployment.
	- Add step operators of your own.
	  See [Operator Authoring](/docs/guides/Operator-Authoring.md).


Not Planned
---------------------------------------------------------------------

- ***`async` in the runtime.*** Your code does the awaiting.
- ***Closures and user-defined procedures.***
- ***A continuation object*** other than the run itself.
- ***Variables inside a query***, so a `Check` cannot see a `$$name`.
- ***A parallel step operator.*** Start a separate run for each piece of parallel work and hand
  the results back through one `$call`; see *Fanning Out* in
  [Step Operators](/docs/guides/jsonproc/Step-Operators.md).


License
---------------------------------------------------------------------

[MIT](/docs/external/license.md)
