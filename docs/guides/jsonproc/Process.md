# @liquicode/jsonproc


# The Process Runtime

A ***process*** is a JSON document describing work.
A ***run*** is a JSON value recording how far that work has got.
Each function takes a process and a run and returns a new run. The runtime keeps nothing
  between calls.

```js
// docs-check: skip
let run = jsonproc.Start( Process, Input );
run = jsonproc.Step( Process, run );
run = jsonproc.Execute( Process, run, MaxSteps );
run = jsonproc.Resume( Process, run, Result );
run = jsonproc.Resume( Process, run, undefined, Error );
```

***Pass the process with every call.*** The run does not contain it.
Keep track of which process a stored run belongs to.
The run records the process's `Name`, and a call with a process of a different name fails with
  `BadRun`.

Expressions and queries inside a step are jsongin's
  [`Evaluate()`](http://jsongin.liquicode.com/#/guides/jsongin/Evaluate.md) and
  [`Query()`](http://jsongin.liquicode.com/#/guides/jsongin/Query.md), and follow MongoDB.
The steps, branches, runs, suspension and error handling are jsonproc's own.


## A Process

```js
const checkout = {
	Name: 'Checkout',
	Steps: [
		{ $do: { total: { $add: [ '$sub', '$tax' ] } } },
		{
			$when: {
				Check: { total: { $gt: 100 } },
				Then: [ { $do: { discount: { $multiply: [ '$total', 0.1 ] } } } ],
				Else: [ { $do: { discount: 0 } } ],
			},
		},
		{ $call: { Name: 'ChargeCard', With: { amount: { $subtract: [ '$total', '$discount' ] } }, Into: 'receipt' } },
		{ $return: '$receipt' },
	],
};
```

A process is a document with a `Steps` array. `Name` is optional.

Each step is ***one document with one step operator***, like a pipeline stage.
An operator with several arguments takes them as one nested document.
Argument names are PascalCase.

See [Step Operators](./Step-Operators.md) for what each one does.


## A Run

```js
let run = jsonproc.Start( checkout, { sub: 100, tax: 8 } );

run.Process		// returns 'Checkout'
run.Status		// returns 'ready'
run.Cursor		// returns [ 0 ]
run.State		// returns { sub: 100, tax: 8 }
```

`Start()` copies `Input` into `State`, so the process never writes to your document.
`Input` may be left out, which starts with an empty state. Any value other than a document fails
  with `BadRun`.

| Field | Meaning |
|---|---|
| `Process` | The `Name` of the process, or `null` for a process with no name. |
| `Status`  | `ready` - the next step can run. `waiting` - suspended on a `$call`. `done` - finished. `failed` - stopped with an `Error`. |
| `Cursor`  | The position of the ***next*** step. `[ 1, 'Then', 0 ]` is the first step of the `Then` branch of step 1. Inside a loop the branch is a pair, so `[ 1, [ 'Do', 3 ], 0 ]` is the first step of the fourth pass. An empty cursor means the process is over. |
| `State`   | The document the process is working on. |
| `Scope`   | The variables, in the stored form [`Scope.ToJSON()`](http://jsongin.liquicode.com/#/guides/jsongin/Scope.md) writes. |
| `Waiting` | Only when `Status` is `waiting`: `{ Name, With, Into }`. |
| `Result`  | Only when `Status` is `done` ***and there is a value***. |
| `Error`   | Only when `Status` is `failed`: `{ Code, Message, Cursor }`. |
| `Reentry` | Only when the cursor has just returned to a loop. The branch element it left, which tells the loop which pass ended. |

A run is plain data with no methods.
An optional field is left off rather than set to `undefined`, so the run survives
  [`Format()`](http://jsongin.liquicode.com/#/guides/jsongin/Format.md) and
  [`Parse()`](http://jsongin.liquicode.com/#/guides/jsongin/Parse.md).


## Running One

`Execute()` steps until the run is no longer `ready`.

```js
run = jsonproc.Execute( checkout, run );

run.Status			// returns 'waiting'
run.Waiting.Name	// returns 'ChargeCard'
run.Waiting.With	// returns { amount: 97.2 }
run.Waiting.Into	// returns 'receipt'
```

***`$call` does not call anything.***
The runtime performs no I/O and has no `async`.
Your code reads `Waiting`, does the work, and passes the answer to `Resume()`.

```js
run = jsonproc.Resume( checkout, run, { confirmation: 'abc123' } );
run.Status		// returns 'ready'

run = jsonproc.Execute( checkout, run );
run.Status		// returns 'done'
run.Result		// returns { confirmation: 'abc123' }
```

To report that the work failed, pass `undefined` as the result and the failure as the fourth
  argument:

```js
let failing = jsonproc.Execute( checkout, jsonproc.Start( checkout, { sub: 100, tax: 8 } ) );
failing = jsonproc.Resume( checkout, failing, undefined, new Error( 'the card was declined' ) );

failing.Status			// returns 'failed'
failing.Error.Code		// returns 'StepFailed'
failing.Error.Message	// returns 'the card was declined'
failing.Error.Cursor	// returns [ 2 ]
```

The failure may be an `Error`, a string, or a document `{ Code, Message }` to choose the code.
A fourth argument of `undefined` or `null` means the work succeeded.
The host may not report a [code which is never caught](#failure): `{ Code: 'BadProcess' }`
  arrives as `StepFailed`, with its message kept, so a `$try` can still catch it.
`Resume()` on a run which is not `waiting` fails with `ResumeNotWaiting`.


## How a Step Reads Its Data

- ***`'$field'` reads the state.*** The state is `$$CURRENT` and `$$ROOT`.
- ***`'$$name'` reads a variable.*** `$let`, `$map`, `$filter` and `$reduce` work inside a step
  as they do anywhere in jsongin.
- ***`$$NOW` is fixed for the whole run.*** `Start()` reads the clock once, and a run resumed an
  hour later still has that instant.

```js
const stamped = { Name: 'Stamped', Steps: [ { $do: { at: '$$NOW' } } ] };
let stamped_run = jsonproc.Start( stamped, {} );

let started_at = stamped_run.Scope.Variables.NOW.getTime();
stamped_run = jsonproc.Execute( stamped, stamped_run );

let stamped_matches = ( stamped_run.State.at.getTime() === started_at );
stamped_matches		// returns true
```

> ***`$$NOW` in a `Check` is the run's instant too.***
  A `Check` is a query, and a query takes no variables, so jsonproc writes the run's instant
  into the `Check` wherever `$$NOW` appears inside `$expr`.


## Stepping

`Step( Process, Run )` runs exactly one step and returns a new run.
The run you pass in is never changed.
A run whose `Status` is not `ready` comes back as an unchanged copy.

```js
const branching = {
	Name: 'Branching',
	Steps: [
		{ $when: { Check: { n: { $gt: 5 } }, Then: [ { $do: { big: true } } ] } },
		{ $do: { seen: true } },
	],
};

let entered = jsonproc.Step( branching, jsonproc.Start( branching, { n: 9 } ) );
entered.Cursor		// returns [ 0, 'Then', 0 ]

let inside = jsonproc.Step( branching, entered );
inside.Cursor		// returns [ 1 ]
```

When a branch ends, the cursor moves to the step after the one which owns the branch.
A loop is the exception: the cursor returns to [`$while`](./Step-Operators.md#$while) or
  [`$forEach`](./Step-Operators.md#$forEach), which decides whether to run another pass.
Because the whole position is in the cursor, a run stopped in the middle of a loop can be stored
  and resumed like any other.

***Running off the end of the top level `Steps` is the same as `{ $return: '$$ROOT' }`.***

```js
let fell_off = jsonproc.Execute( branching, jsonproc.Start( branching, { n: 9 } ) );
fell_off.Status		// returns 'done'
fell_off.Result		// returns { n: 9, big: true, seen: true }
```

`Execute( Process, Run, MaxSteps )` stops a run which takes more than `MaxSteps` steps and fails
  it with `StepLimitExceeded`.
`MaxSteps` is 1000 when it is not a number.

```js
let out_of_budget = jsonproc.Execute( branching, jsonproc.Start( branching, { n: 9 } ), 2 );
out_of_budget.Status		// returns 'failed'
out_of_budget.Error.Code	// returns 'StepLimitExceeded'
```


## Failure

***None of the four functions throws.***
A failure is a run with `Status: 'failed'` and an `Error` of `{ Code, Message, Cursor }`.
The run keeps the state it had reached, so you can see what happened before the failure.

***A failure's code says whether a [`$try`](./Step-Operators.md#$try) may catch it.***

- ***A mistake in the process, or in how it is being run, is never caught.*** A step missing an
  argument is wrong on every input, so a `$try` which caught it would report every run as a
  handled failure and nobody would learn the process is broken. The run stops instead.
- ***A failure of the work is caught.*** A declined card, a field the data does not have, or a
  failed call is what a `$try` is for, and its `Catch` steps decide what happens next.

Never caught:

| Code | Raised when |
|---|---|
| `BadProcess` | the process is not a document with a `Steps` array; a step is not a document with exactly one key; a step's argument is the wrong type; a step is missing an argument or has a malformed one, such as a `$when` with no `Check`, a `Check` jsongin refuses, or a `$call` with no `Name` |
| `BadRun` | the run is not shaped as a run, belongs to a process with a different `Name`, or `Start()` was given an `Input` which is not a document |
| `NoSuchStep` | the cursor addresses a step which is not there |
| `UnknownOperator` | a step names an operator which is not registered |
| `ResumeNotWaiting` | `Resume()` was called on a run which is not waiting |
| `StepLimitExceeded` | `Execute()` reached `MaxSteps` |

Caught by a `$try`:

| Code | Raised when |
|---|---|
| `StepFailed` | an expression or query threw while the step ran, such as a `$forEach` whose `In` is not an array; or the host reported a failed call without a code, or with one of the codes above |
| `Thrown` | a [`$throw`](./Step-Operators.md#$throw) with no code |

A `$throw`, or a host's failed call, may also use a code of its own, and a `$try` catches it.

```js
const wrong = { Name: 'Wrong', Steps: [ { $nosuchthing: 1 } ] };
let refused = jsonproc.Step( wrong, jsonproc.Start( wrong, {} ) );

refused.Status			// returns 'failed'
refused.Error.Code		// returns 'UnknownOperator'
refused.State			// returns {}
```

***A failure inside a [`$try`](./Step-Operators.md#$try) runs its `Catch` steps instead of
  stopping the run.***

```js
const guarded_run = {
	Name: 'GuardedRun',
	Steps: [
		{
			$try: {
				Do: [ { $throw: 'no good' } ],
				Catch: [ { $do: { recovered: true } } ],
				As: 'error',
			},
		},
	],
};

let recovered = jsonproc.Execute( guarded_run, jsonproc.Start( guarded_run, {} ) );
recovered.Status				// returns 'done'
recovered.State.recovered		// returns true
```

`BadProcess`, `BadRun`, `NoSuchStep`, `UnknownOperator`, `ResumeNotWaiting` and
  `StepLimitExceeded` are never caught.
See [`$try`](./Step-Operators.md#$try).


## Storage

A run can be written down with `Format()` and read back with `Parse()`.
***Use the `TypedValues` option for both.***
Without it, a date, `$$NOW` included, comes back as a string, and a regular expression comes
  back as an empty document.

```js
const options = { TypedValues: true };

let live = jsonproc.Start( checkout, { sub: 100, tax: 8 } );
let reloaded = jsongin.Parse( jsongin.Format( live, options ), options );

let same = ( jsongin.Format( jsonproc.Step( checkout, reloaded ), options )
	=== jsongin.Format( jsonproc.Step( checkout, live ), options ) );
same		// returns true
```

Store the run and the name of its process.
Keep the process document wherever you keep your code.


## The Invariants

`npm run process-check` drives a set of fixture processes through the runtime and checks these
  rules at every step:

| | |
|---|---|
| 1 | ***Storage is transparent.*** Stepping a stored run gives what stepping the live one gives. |
| 2 | ***Stepping is deterministic.*** The same run stepped twice gives the same result. |
| 3 | ***`Execute()` equals repeated `Step()`.*** |
| 4 | ***Runs are independent.*** Two runs stepped alternately never affect each other. |
| 5 | ***`Step()` is total.*** It always returns a run and never throws. |
| 6 | ***The input run is never modified.*** Every function returns a new value. |
| 7 | ***A runaway loop fails.*** `Execute()` always returns. |
| 8 | ***A failure is caught only where it should be.*** A `$try` catches a failure raised by running a step, and nothing else. |

```
npm run process-check
```

See [Testing](../Testing.md).


## What Is Not Built

These are not planned:

- ***`async` in the runtime.*** Your code does the awaiting.
- ***Closures and user-defined procedures.***
- ***A continuation object*** other than the run itself.
- ***Variables inside a query.*** A `Check` cannot see a `$$name`; see above.
- ***A parallel step operator.*** Start a separate run for each piece of parallel work, and hand
  the results back through one [`$call`](./Step-Operators.md#$call).
  See [Fanning Out](./Step-Operators.md#fanning-out).


## See Also

- [Step Operators](./Step-Operators.md)
- [Testing](../Testing.md)
- [Scope](http://jsongin.liquicode.com/#/guides/jsongin/Scope.md)
- [`Evaluate()`](http://jsongin.liquicode.com/#/guides/jsongin/Evaluate.md)
- [`Query()`](http://jsongin.liquicode.com/#/guides/jsongin/Query.md)
- [`Format()`](http://jsongin.liquicode.com/#/guides/jsongin/Format.md)
- [`Parse()`](http://jsongin.liquicode.com/#/guides/jsongin/Parse.md)
