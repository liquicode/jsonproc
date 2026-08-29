# @liquicode/jsonproc


# Step Operators

The steps of a process, read by the [process runtime](./Process.md).
A process is a document with a `Steps` array, and each step is one document with one step
  operator in it.

| **Step**                   | **Usage**                                                          |
|----------------------------|--------------------------------------------------------------------|
| [`$do`](#$do)              | `{ $do: { field: expression, ... } }`                              |
| [`$when`](#$when)          | `{ $when: { Check: query, Then: [ steps ], Else: [ steps ] } }`    |
| [`$while`](#$while)        | `{ $while: { Check: query, Do: [ steps ] } }`                      |
| [`$forEach`](#$forEach)    | `{ $forEach: { In: expression, As: 'path', Do: [ steps ] } }`      |
| [`$try`](#$try)            | `{ $try: { Do: [ steps ], Catch: [ steps ], As: 'path' } }`        |
| [`$throw`](#$throw)        | `{ $throw: expression }`                                           |
| [`$call`](#$call)          | `{ $call: { Name: 'name', With: { ... }, Into: 'path' } }`         |
| [`$return`](#$return)      | `{ $return: expression }`                                          |

***These are jsonproc operators, not MongoDB ones.***
MongoDB has no process language, so there is nothing to be at parity with here and nothing for
  jsongin's `build/api-coverage.js` to count.
Their argument names are PascalCase for the same reason.


<a id="$do"></a>$do
---------------------------------------------------------------------

Usage: `$do: { field: expression, ... }`

Changes the state of a running process.
Each field is computed from the current state and written to it, leaving the other fields in
  place.

```js
const totals = {
	Name: 'Totals',
	Steps: [
		{ $do: { total: { $add: [ '$sub', '$tax' ] } } },
		{ $do: { rounded: { $round: [ '$total', 0 ] } } },
	],
};

let run = jsonproc.Execute( totals, jsonproc.Start( totals, { sub: 100, tax: 8.4 } ) );
run.State		// returns { sub: 100, tax: 8.4, total: 108.4, rounded: 108 }
```

***This is the aggregation `$set` stage, not the update operator of the same name***, and the
  difference is the reason the operator exists at all.
The stage family ***computes***; the update family ***stores***.
The same document handed to [`Update()`](http://jsongin.liquicode.com/#/guides/jsongin/Update.md) keeps `{ $add: [ ... ] }` as a literal
  value, which is correct MongoDB behavior for classic update syntax and useless to a process.

```js
let computed = jsongin.Aggregate( [ { sub: 100, tax: 8 } ], [ { $set: { total: { $add: [ '$sub', '$tax' ] } } } ] );
computed		// returns [ { sub: 100, tax: 8, total: 108 } ]

let stored = jsongin.Update( { sub: 100, tax: 8 }, { $set: { total: { $add: [ '$sub', '$tax' ] } } } );
stored.total	// returns { $add: [ '$sub', '$tax' ] }
```

***The cost of that choice, stated plainly:***
`$inc`, `$mul`, `$push` and `$pop` have no stage equivalent, so a counter is incremented by
  writing the arithmetic out.
MongoDB made the same trade in its own update-with-pipeline form.

```js
const counter = { Name: 'Counter', Steps: [ { $do: { n: { $add: [ '$n', 1 ] } } } ] };
let counted = jsonproc.Execute( counter, jsonproc.Start( counter, { n: 41 } ) );
counted.State.n		// returns 42
```

***An expression which produces nothing removes the field***, exactly as it does in
  [`$addFields`](http://jsongin.liquicode.com/#/guides/jsongin/Stage-Operators.md?id=addfields).

```js
const dropping = { Name: 'Dropping', Steps: [ { $do: { secret: '$$REMOVE' } } ] };
let dropped = jsonproc.Execute( dropping, jsonproc.Start( dropping, { keep: 1, secret: 2 } ) );
dropped.State		// returns { keep: 1 }
```

Every expression in one `$do` sees the state as it was at the top of the step, which is what
  the aggregation stage does.


<a id="$when"></a>$when
---------------------------------------------------------------------

Usage: `$when: { Check: query, Then: [ steps ], Else: [ steps ] }`

Runs one of two lists of steps, according to whether the state matches a query.

```js
const sized = {
	Name: 'Sized',
	Steps: [
		{
			$when: {
				Check: { n: { $gt: 100 } },
				Then: [ { $do: { size: 'large' } } ],
				Else: [ { $do: { size: 'small' } } ],
			},
		},
	],
};

let large = jsonproc.Execute( sized, jsonproc.Start( sized, { n: 500 } ) );
large.State.size		// returns 'large'

let small = jsonproc.Execute( sized, jsonproc.Start( sized, { n: 5 } ) );
small.State.size		// returns 'small'
```

***`Check` is a query, not an expression.***
A query is what a MongoDB user reaches for first, [`Query()`](http://jsongin.liquicode.com/#/guides/jsongin/Query.md) is at parity, and a
  query can already hold `$expr` when an expression is wanted - which is MongoDB's own answer
  to this same question.

```js
const compared = {
	Name: 'Compared',
	Steps: [ { $when: { Check: { $expr: { $gt: [ '$a', '$b' ] } }, Then: [ { $do: { bigger: 'a' } } ], Else: [ { $do: { bigger: 'b' } } ] } } ],
};

let comparison = jsonproc.Execute( compared, jsonproc.Start( compared, { a: 9, b: 2 } ) );
comparison.State.bigger		// returns 'a'
```

`Else` is optional.
A check which fails with no `Else` advances past the step, and so does a branch which is
  present but empty.

Branches ***nest***, and the cursor records where in them the run is - `[ 0, 'Then', 1 ]` is
  the second step of the `Then` branch of step 0.
That is what makes a run suspended inside a branch storable: the position is data, not a call
  stack.

***A query does not carry the run's variables.***
[`Query()`](http://jsongin.liquicode.com/#/guides/jsongin/Query.md) takes no scope, so a `$$name` the run bound is not visible inside
  `Check`, not even within an `$expr`.
Compute the value into the state with `$do` first, and check the field.


<a id="$while"></a>$while
---------------------------------------------------------------------

Usage: `$while: { Check: query, Do: [ steps ] }`

Runs a list of steps over and over, for as long as the state matches a query.

```js
const counting = {
	Name: 'Counting',
	Steps: [
		{
			$while: {
				Check: { remaining: { $gt: 0 } },
				Do: [
					{ $do: { remaining: { $subtract: [ '$remaining', 1 ] } } },
					{ $do: { done: { $add: [ '$done', 1 ] } } },
				],
			},
		},
	],
};

let counted = jsonproc.Execute( counting, jsonproc.Start( counting, { remaining: 3, done: 0 } ) );
counted.State		// returns { remaining: 0, done: 3 }
```

***The check is made before each pass, so a loop may run no times at all.***

```js
const never = {
	Name: 'Never',
	Steps: [
		{ $while: { Check: { go: true }, Do: [ { $do: { spun: true } } ] } },
		{ $do: { after: true } },
	],
};

let skipped = jsonproc.Execute( never, jsonproc.Start( never, { go: false } ) );
skipped.State		// returns { go: false, after: true }
```

***One pass is several steps, not one.***
The loop is re-entered through the cursor: entering the body pushes `[ 0, 'Do', 0 ]`, and the
  end of the body returns to `[ 0 ]` rather than moving past it, which is the one way a loop
  differs from a branch.
A run stopped in the middle of a pass is an ordinary run which can be stored and picked up
  later, which is what lets a [`$call`](#$call) sit inside a loop body.

***A loop with no body is a bad process.***
It could not make progress and could not end, so it fails at the step rather than quietly not
  looping.
This is the one place where an empty branch is an error: a missing `Then` means there is
  nothing to do, while a missing `Do` means there is nothing which could ever change the
  answer to `Check`.

```js
const spinning = { Name: 'Spinning', Steps: [ { $while: { Check: { go: true }, Do: [] } } ] };

let refused = jsonproc.Execute( spinning, jsonproc.Start( spinning, { go: true } ) );
refused.Status			// returns 'failed'
refused.Error.Code		// returns 'BadProcess'
```

***A loop which does not end is stopped by the budget, not by this operator.***
[`Execute()`](./Process.md) fails a run with `StepLimitExceeded` after `MaxSteps` steps,
  1000 by default.
[`Step()`](./Process.md) needs no budget, because one step cannot loop.

```js
const forever = {
	Name: 'Forever',
	Steps: [ { $while: { Check: { go: true }, Do: [ { $do: { spins: { $add: [ '$spins', 1 ] } } } ] } } ],
};

let stopped = jsonproc.Execute( forever, jsonproc.Start( forever, { go: true, spins: 0 } ), 25 );
stopped.Status			// returns 'failed'
stopped.Error.Code		// returns 'StepLimitExceeded'
```

***`Check` does not carry the run's variables***, the same rule [`$when`](#$when) follows and for
  the same reason.


<a id="$forEach"></a>$forEach
---------------------------------------------------------------------

Usage: `$forEach: { In: expression, As: 'path', Index: 'path', Do: [ steps ] }`

Runs a list of steps once for each element of an array.

| **Argument** | **Meaning**                                                              |
|--------------|--------------------------------------------------------------------------|
| `In`         | An expression which must produce an array.                               |
| `As`         | Names a field in the state where each element is written.                |
| `Index`      | Optional. Names a field where the element's position is written.         |
| `Do`         | The steps to run for each element.                                       |

```js
const summing = {
	Name: 'Summing',
	Steps: [
		{ $do: { total: 0 } },
		{
			$forEach: {
				In: '$items',
				As: 'item',
				Do: [ { $do: { total: { $add: [ '$total', '$item' ] } } } ],
			},
		},
	],
};

let summed = jsonproc.Execute( summing, jsonproc.Start( summing, { items: [ 1, 2, 3, 4 ] } ) );
summed.State		// returns { items: [ 1, 2, 3, 4 ], total: 10 }
```

***The element is written into the state, not bound as a `$$name`.***
That is the whole reason the loop is usable.
`Check` in a [`$when`](#$when) or a [`$while`](#$while) is a query, and [`Query()`](http://jsongin.liquicode.com/#/guides/jsongin/Query.md)
  takes no scope, so a `$$name` would be invisible to exactly the test a loop body most often
  wants to make.
Written into the state it is reachable both ways - as `'$item'` in an expression and as
  `{ item: ... }` in a query.

```js
const classifying = {
	Name: 'Classifying',
	Steps: [
		{ $do: { big: 0, small: 0 } },
		{
			$forEach: {
				In: '$values', As: 'value',
				Do: [ {
					$when: {
						Check: { value: { $gt: 10 } },
						Then: [ { $do: { big: { $add: [ '$big', 1 ] } } } ],
						Else: [ { $do: { small: { $add: [ '$small', 1 ] } } } ],
					},
				} ],
			},
		},
	],
};

let classified = jsonproc.Execute( classifying, jsonproc.Start( classifying, { values: [ 5, 50, 7 ] } ) );
classified.State.big		// returns 1
classified.State.small		// returns 2
```

`Index` is optional, and names a field which is written alongside the element.

```js
const positions = {
	Name: 'Positions',
	Steps: [
		{ $do: { seen: [] } },
		{
			$forEach: {
				In: '$items', As: 'item', Index: 'at',
				Do: [ { $do: { seen: { $concatArrays: [ '$seen', [ '$at' ] ] } } } ],
			},
		},
	],
};

let placed = jsonproc.Execute( positions, jsonproc.Start( positions, { items: [ 'a', 'b', 'c' ] } ) );
placed.State.seen		// returns [ 0, 1, 2 ]
```

***`As` and `Index` name fields the loop owns***, and they are removed from the state when the
  loop ends, so a process which ran a loop does not carry its last element around afterward.
A loop which ran no passes removes nothing, because it wrote nothing.

```js
let tidied = jsonproc.Execute( summing, jsonproc.Start( summing, { items: [ 1, 2 ] } ) );
Object.keys( tidied.State ).includes( 'item' )		// returns false
```

***The iteration lives in the cursor, not in the state.***
The branch element is `[ 'Do', 3 ]` while the fourth pass is running, which is why a plain
  branch writes `'Then'` and a loop writes a pair.
Nothing about where the loop has got to is kept in the document it is working on, which is
  what lets a run be stored in the middle of a pass and resumed.

```js
let entered = jsonproc.Step( summing, jsonproc.Step( summing, jsonproc.Start( summing, { items: [ 1, 2 ] } ) ) );
entered.Cursor		// returns [ 1, [ 'Do', 0 ], 0 ]
```

***`In` is evaluated again before each pass.***
A body which appends to the array is a work list which grows, and a body which shortens it
  ends the loop early.
This is deliberate, and it is one more reason [`Execute()`](./Process.md) has a budget:
  a body which appends forever fails with `StepLimitExceeded` rather than running forever.

***A loop with no body is a bad process***, the same as it is for [`$while`](#$while).
So is a missing `As`, or an `Index` which is not a field name.
An `In` which does not produce an array is a `StepFailed` instead, because that one depends on
  what the run has computed rather than on how the process was written.


<a id="$try"></a>$try
---------------------------------------------------------------------

Usage: `$try: { Do: [ steps ], Catch: [ steps ], As: 'path' }`

Runs a list of steps, and runs a second list instead of halting if one of them fails.

| **Argument** | **Meaning**                                                              |
|--------------|--------------------------------------------------------------------------|
| `Do`         | The steps to run.                                                        |
| `Catch`      | The steps to run instead if one of them fails.                           |
| `As`         | Optional. Names a field where the error is written before `Catch` runs.  |

```js
const guarded = {
	Name: 'Guarded',
	Steps: [
		{
			$try: {
				Do: [ { $throw: { Code: 'CartEmpty', Message: 'nothing to charge for' } } ],
				Catch: [ { $do: { paid: false, why: '$error.Message' } } ],
				As: 'error',
			},
		},
		{ $do: { finished: true } },
	],
};

let handled = jsonproc.Execute( guarded, jsonproc.Start( guarded, {} ) );
handled.Status			// returns 'done'
handled.State.why		// returns 'nothing to charge for'
handled.State.finished	// returns true
```

***The error goes into the state, not into a variable***, for the reason a loop's element does:
  a [`$when`](#$when) in the handler is a query, and [`Query()`](http://jsongin.liquicode.com/#/guides/jsongin/Query.md) takes no scope.
Written into the state, the handler can route on it.

```js
const routed = {
	Name: 'Routed',
	Steps: [
		{
			$try: {
				Do: [ { $throw: { Code: 'CartEmpty', Message: 'no items' } } ],
				Catch: [ {
					$when: {
						Check: { 'error.Code': 'CartEmpty' },
						Then: [ { $do: { why: 'empty cart' } } ],
						Else: [ { $do: { why: 'something else' } } ],
					},
				} ],
				As: 'error',
			},
		},
	],
};

let sorted = jsonproc.Execute( routed, jsonproc.Start( routed, {} ) );
sorted.State.why		// returns 'empty cart'
```

***A `$try` catches a failure raised by running a step, and nothing else.***
An operator which refused, a [`$throw`](#$throw), and a call the host reported as failed
  through [`Resume()`](./Process.md) are all caught.
***A fault in the process document is not.***

| Never caught | |
|---|---|
| `BadProcess` | `BadRun` |
| `NoSuchStep` | `UnknownOperator` |
| `ResumeNotWaiting` | `StepLimitExceeded` |

That line is the difference between an error and a bug.
A process which mishandles a declined card is doing its job;
  a process with a misspelled operator name in it is broken, and a `$try` which swallowed that
  would turn every typo into a silently handled error.

```js
const typo = {
	Name: 'Typo',
	Steps: [ { $try: { Do: [ { $nosuchthing: 1 } ], Catch: [ { $do: { caught: true } } ], As: 'error' } } ],
};

let unswallowed = jsonproc.Execute( typo, jsonproc.Start( typo, {} ) );
unswallowed.Status			// returns 'failed'
unswallowed.Error.Code		// returns 'UnknownOperator'
```

`StepLimitExceeded` is on the list for a different reason.
It is the caller's protection against a process which does not end, and a process must not be
  able to defeat it from the inside.

***A failure raised inside `Catch` is not caught by the same `Catch`.***
It is offered to the next `$try` outward, and halts the run if there is none.
Without that rule a handler which failed would hand itself its own failure forever.

```js
const rethrown = {
	Name: 'Rethrown',
	Steps: [ { $try: { Do: [ { $throw: 'first' } ], Catch: [ { $throw: 'second' } ], As: 'error' } } ],
};

let escaped = jsonproc.Execute( rethrown, jsonproc.Start( rethrown, {} ) );
escaped.Status				// returns 'failed'
escaped.Error.Message		// returns 'second'
```

***The handler sees the state as the failure left it.***
A step which changed the state and then failed did change it.
Rolling that back would mean holding a copy of the state at every step in case one were
  needed, which is a transaction and is not what this is.
The same follows for a loop abandoned part way: it never reaches its own tidying up, so the
  field its `As` named is still on the state when the handler runs.

***The field `As` names stays after the handler runs.***
Unlike a loop's `As`, which is rewritten every pass and would otherwise leave the last element
  behind, an error is written once and deliberately.
Take it off with `{ $do: { error: '$$REMOVE' } }` when it is not wanted.

***A `$try` needs both branches.***
A missing or empty `Do` has nothing to guard and a missing or empty `Catch` catches nothing,
  and both are a `BadProcess` - the same reading a loop with no body gets.


<a id="$throw"></a>$throw
---------------------------------------------------------------------

Usage: `$throw: expression`

Fails the run on purpose.

The expression is evaluated against the current state, and may produce either form:

| Produces | Becomes |
|---|---|
| a string | `{ Code: 'Thrown', Message: <the string> }` |
| a document | `{ Code, Message }`, with `Code` defaulting to `Thrown` |

```js
const complaining = { Name: 'Complaining', Steps: [ { $throw: 'the cart is empty' } ] };

let complained = jsonproc.Execute( complaining, jsonproc.Start( complaining, {} ) );
complained.Status		// returns 'failed'
complained.Error		// returns { Code: 'Thrown', Message: 'the cart is empty', Cursor: [ 0 ] }
```

The nearest enclosing [`$try`](#$try) catches it.
With no `$try` around it the run halts, which is what the example above did.

***`Thrown` is the default code so that a deliberate failure can be told from an engine one.***
A handler which cares can check it.

```js
const named = {
	Name: 'Named',
	Steps: [ { $throw: { Code: 'NoCustomer', Message: { $concat: [ 'no such customer: ', '$who' ] } } } ],
};

let complaint = jsonproc.Execute( named, jsonproc.Start( named, { who: 'ada' } ) );
complaint.Error.Code		// returns 'NoCustomer'
complaint.Error.Message		// returns 'no such customer: ada'
```

***A `$throw` may not name one of the engine's own codes.***
Those are the codes a [`$try`](#$try) refuses to catch, so a process which could raise one
  would be able to reach past every handler around it and halt the run - which is the caller's
  decision to make and not the process's.
Naming one is itself a `BadProcess`.

```js
const sneaky = { Name: 'Sneaky', Steps: [ { $throw: { Code: 'BadProcess', Message: 'let me out' } } ] };

let denied = jsonproc.Execute( sneaky, jsonproc.Start( sneaky, {} ) );
denied.Error.Code		// returns 'BadProcess'
```


<a id="$call"></a>$call
---------------------------------------------------------------------

Usage: `$call: { Name: 'name', With: { field: expression, ... }, Into: 'path' }`

Suspends the run so that the host can do something the engine cannot.

```js
const charging = {
	Name: 'Charging',
	Steps: [
		{ $call: { Name: 'ChargeCard', With: { amount: '$total' }, Into: 'receipt' } },
		{ $return: '$receipt' },
	],
};

let waiting = jsonproc.Execute( charging, jsonproc.Start( charging, { total: 42 } ) );
waiting.Status			// returns 'waiting'
waiting.Waiting.Name	// returns 'ChargeCard'
waiting.Waiting.With	// returns { amount: 42 }
```

***`$call` does not call.***
The engine performs no I/O, has no dependency, and contains no `async`.
The host reads the descriptor, does the work, does the awaiting, and hands the answer back
  with `Resume()`.

```js
let resumed = jsonproc.Execute( charging, jsonproc.Resume( charging, waiting, { paid: true } ) );
resumed.Status		// returns 'done'
resumed.Result		// returns { paid: true }
```

`With` is evaluated against the state ***when the step runs***, so the descriptor the host
  receives holds values rather than expressions.
A run stored while it waits and resumed a day later hands over the amount computed at the
  moment the step ran.

`Into` names a path in the state where the result is written, and is optional: a call whose
  result is not wanted omits it.
A result of nothing removes the field at `Into` rather than setting it to `undefined`, which is
  the same rule `$do` follows and the same reason - a run has to stay storable.


### Fanning Out

***Work which can happen at the same time belongs to the host, not to the engine.***
One `$call` may ask for several things at once, and the host is free to do them concurrently -
  with `Promise.all()`, with a worker pool, with whatever it already uses - because the engine
  is not inside that loop.

Each piece of independent work can be a process of its own, run as a child of the call.

```js
const checking = {
	Name: 'Checking',
	Steps: [
		{ $do: { score: { $multiply: [ '$weight', 10 ] } } },
		{ $return: { name: '$name', passed: { $gte: [ '$score', 50 ] } } },
	],
};

const ordering = {
	Name: 'Ordering',
	Steps: [
		{ $call: { Name: 'RunChecks', With: { checks: '$checks' }, Into: 'results' } },
		{
			$when: {
				Check: { 'results.passed': false },
				Then: [ { $do: { decision: 'review' } } ],
				Else: [ { $do: { decision: 'accept' } } ],
			},
		},
		{ $return: '$decision' },
	],
};

// The host's handler for the call. A real one awaits Promise.all() around this loop.
function run_checks( Checks )
{
	let results = [];
	for ( let check_index = 0; check_index < Checks.length; check_index++ )
	{
		let child = jsonproc.Start( checking, Checks[ check_index ] );
		results.push( jsonproc.Execute( checking, child ).Result );
	}
	return results;
}

let order = jsonproc.Execute( ordering, jsonproc.Start( ordering,
	{ checks: [ { name: 'credit', weight: 9 }, { name: 'fraud', weight: 3 } ] } ) );

order.Waiting.Name			// returns 'RunChecks'
order.Waiting.With.checks	// returns [ { name: 'credit', weight: 9 }, { name: 'fraud', weight: 3 } ]

let checked = run_checks( order.Waiting.With.checks );
order = jsonproc.Execute( ordering, jsonproc.Resume( ordering, order, checked ) );

order.Status		// returns 'done'
order.Result		// returns 'review'
```

The parent is still ***one cursor and one state***, so it can be written down while the
  children are outstanding and resumed by whoever picks it up next.
[Invariant 4](./Process.md#the-invariants) - two runs stepped alternately never affect each
  other - is what makes running the children at the same time safe, and it is checked rather
  than assumed.

If one of the children fails, the host says so through the fourth parameter of
  `Resume()`, and the parent's [`$try`](#$try) catches it the way it catches any other
  failed call.

***This is why there is no parallel step operator.***
A branch of one would be a second live cursor, and a run would stop being one position in one
  document - which is the property the loops, the exception handling and the storage are all
  built on.
See [What Is Not Built](./Process.md#what-is-not-built).


<a id="$return"></a>$return
---------------------------------------------------------------------

Usage: `$return: expression`

Halts the run, and names what it produced.

```js
const answering = { Name: 'Answering', Steps: [ { $return: { sum: { $add: [ '$a', '$b' ] } } } ] };
let answer = jsonproc.Execute( answering, jsonproc.Start( answering, { a: 1, b: 2 } ) );

answer.Status		// returns 'done'
answer.Result		// returns { sum: 3 }
```

The steps after it do not run.

***Running off the end of the top level `Steps` does the same thing as `{ $return: '$$ROOT' }`.***
A process which computes and never says so still hands back the work it did.

```js
const implicit = { Name: 'Implicit', Steps: [ { $do: { doubled: { $multiply: [ '$n', 2 ] } } } ] };
let implied = jsonproc.Execute( implicit, jsonproc.Start( implicit, { n: 21 } ) );

implied.Status		// returns 'done'
implied.Result		// returns { n: 21, doubled: 42 }
```

***An expression which produces nothing leaves the run with no `Result` at all***, rather than
  with a `Result` of `undefined`.
A field set to `undefined` does not survive being written down and read back, and a run which
  cannot be stored is not a run.

```js
const empty_handed = { Name: 'EmptyHanded', Steps: [ { $return: '$nope' } ] };
let nothing = jsonproc.Execute( empty_handed, jsonproc.Start( empty_handed, {} ) );

nothing.Status						// returns 'done'
Object.keys( nothing ).includes( 'Result' )		// returns false
```


## See Also

- [The Process Runtime](./Process.md)
- [Stage Operators](http://jsongin.liquicode.com/#/guides/jsongin/Stage-Operators.md)
- [Expression Operators](http://jsongin.liquicode.com/#/guides/jsongin/Expression-Operators.md)
- [Query Operators](http://jsongin.liquicode.com/#/guides/jsongin/Query-Operators.md)
