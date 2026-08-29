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
A ***run*** is a JSON value describing how far that work has got.

`jsonproc` is a pure function from one run to the next.
***It holds nothing between calls.***
That is what makes two runs independent of each other, what lets a run be written down and
  picked up an hour later somewhere else, and what keeps the whole thing testable without a
  clock or a server.

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

// $call does not call. The host does the work and hands the answer back.
run = jsonproc.Execute( checkout, jsonproc.Resume( checkout, run, { paid: true } ) );
run.Result         // returns { paid: true }
```

***The process is passed alongside the run, never carried inside it.***
A run carries only the process's `Name`, as a stamp: it cannot rebuild the process and is not
  meant to. It is there so that stepping a stored run against the wrong process fails at the
  first call instead of computing a wrong answer quietly.


The Four Functions
---------------------------------------------------------------------

| Function | Does |
|---|---|
| [`Start( Process, Input )`](/docs/guides/jsonproc/Process.md) | Begins a run, with `Input` as its state. |
| [`Step( Process, Run )`](/docs/guides/jsonproc/Process.md) | Runs one step and returns a new run. Stepping a halted run is a no-op. |
| [`Execute( Process, Run, MaxSteps )`](/docs/guides/jsonproc/Process.md) | Steps until the run is no longer ready. `MaxSteps` defaults to 1000. |
| [`Resume( Process, Run, Result, Error )`](/docs/guides/jsonproc/Process.md) | Hands a waiting run the result of the call it suspended on, or the failure of it. |

***Nothing here throws.***
A failure is a run with `Status` `'failed'` and an `Error` on it, because the point of the
  design is that a run is a value which can be stored and looked at later — and an error which
  vanished into a throw could not be.

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
| `$when`    | `{ $when: { Check: criteria, Then: [ steps ], Else: [ steps ] } }` |
| `$while`   | `{ $while: { Check: criteria, Do: [ steps ] } }` |
| `$forEach` | `{ $forEach: { In: expression, As: 'path', Do: [ steps ] } }` |
| `$try`     | `{ $try: { Do: [ steps ], Catch: [ steps ], As: 'path' } }` |
| `$throw`   | `{ $throw: expression }` |
| `$call`    | `{ $call: { Name: 'name', With: { ... }, Into: 'path' } }` |
| `$return`  | `{ $return: expression }` |

Each step is ***one document with one step operator***, the way a pipeline stage is.
An operator taking more than one argument ***nests*** them, which is what MongoDB does
  everywhere — `$lookup`, `$bucket`, `$let` — and what keeps "one key, one operator" true.

See [Step Operators](/docs/guides/jsonproc/Step-Operators.md).


Built On jsongin
---------------------------------------------------------------------

`jsonproc` evaluates nothing itself.
Every expression a step computes, every criteria a step tests, and every scope a step is
  evaluated against belongs to [`@liquicode/jsongin`](http://jsongin.liquicode.com), which is at
  parity with MongoDB and is measured against it.

- ***`'$field'` reads the state document.*** The state is `$$CURRENT` and `$$ROOT`.
- ***`'$$name'` reads a variable binding.*** `$let`, `$map`, `$filter` and `$reduce` behave
  inside a step exactly as they do anywhere.
- ***A `Check` is a query***, so `{ total: { $gt: 100 } }` means what it means everywhere else.

Only the step sequencing, the branching, the run value, the suspension and the error
  propagation are `jsonproc`'s own.
That division is why a process language could be built at all without giving up the family's
  method: what an expression means still has an authority, and only what a step does is decided
  here.

The engine is a ***setting*** rather than a fixed import, because an engine carries its
  operator registries:

```js
const jsongin = require( '@liquicode/jsongin' ).NewJsongin();
const runtime = require( '@liquicode/jsonproc' ).NewJsonproc( { jsongin: jsongin } );

runtime.jsongin === jsongin
```


Features
---------------------------------------------------------------------

- A Process is Data:
	- A process is a JSON document, so it can be stored in a database, sent across a wire,
	  generated by another function, kept in a configuration file, and reviewed in a diff.
	- A run is a JSON value, so a half-finished job survives a restart.
	- `Format()` and `Parse()` carry a run through storage exactly, dates included.

- The Host Does the Work:
	- `$call` does not call anything. It suspends the run and names what it wants.
	- The host performs the work however it likes — synchronously, over a queue, next Tuesday —
	  and hands the answer back through `Resume()`.
	- Several runs can be outstanding at once, because no two runs share anything.

- Correct by Invariant:
	- Eight invariants, checked on every step of every fixture by `npm run process-check`.
	- Storage is transparent, stepping is deterministic, `Execute` equals repeated `Step`, runs
	  are independent, `Step` is total, the input run is never modified, a runaway loop is
	  failed rather than hung, and a failure is caught only where it should be.
	- See [Testing](/docs/guides/Testing.md).

- Developer Features:
	- One runtime dependency, and it is `@liquicode/jsongin`.
	- 100% pure javascript, on the server and in the browser.
	- Single minified file (~<%- Context.Bundle.Kb %>k, ~<%- Context.Bundle.CompressedKb %>k compressed) for web deployment.
	- Extend `jsonproc` with step operators of your own; the registry is not private.
	  See [Operator Authoring](/docs/guides/Operator-Authoring.md).


What Is Not Built
---------------------------------------------------------------------

These are ***standing non-goals***, not a work list:

- ***`async` inside `src/`.*** A step is a pure function of the run it is handed.
- ***Closures and user-defined procedures.***
- ***A continuation object beyond the run value itself.***
- ***A caller scope carried into `Query()`***, which is why a `$when` check cannot see a
  `$$name`.
- ***A parallel step operator.*** A branch of one would be a second live cursor, and a run
  being ***one*** position in one document is the property the loops, the exception handling
  and the storage all rest on. A host which wants parallelism starts a run for each independent
  piece and hands the results back through one `$call`; see *Fanning Out* in
  [Step Operators](/docs/guides/jsonproc/Step-Operators.md).


License
---------------------------------------------------------------------

[MIT](/docs/external/license.md)
