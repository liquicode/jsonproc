# @liquicode/jsonproc


# Step Operators

The steps of a process, run by the [process runtime](./Process.md).
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

These are jsonproc's own operators, not MongoDB's, and their argument names are PascalCase.
An argument of the wrong type, such as `{ $do: [ ... ] }`, fails the step with `StepFailed`.


<a id="$do"></a>$do
---------------------------------------------------------------------

Usage: `$do: { field: expression, ... }`

Computes each field from the state and writes it to the state. Other fields are left alone.

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

***`$do` is the aggregation `$set` stage, not the update operator `$set`.***
Its values are expressions, so `{ $add: [ ... ] }` is computed.
The same document given to [`Update()`](http://jsongin.liquicode.com/#/guides/jsongin/Update.md)
  stores `{ $add: [ ... ] }` as a literal.

```js
let computed = jsongin.Aggregate( [ { sub: 100, tax: 8 } ], [ { $set: { total: { $add: [ '$sub', '$tax' ] } } } ] );
computed		// returns [ { sub: 100, tax: 8, total: 108 } ]

let stored = jsongin.Update( { sub: 100, tax: 8 }, { $set: { total: { $add: [ '$sub', '$tax' ] } } } );
stored.total	// returns { $add: [ '$sub', '$tax' ] }
```

Update operators such as `$inc`, `$mul`, `$push` and `$pop` do not work in `$do`.
Write the arithmetic out instead:

```js
const counter = { Name: 'Counter', Steps: [ { $do: { n: { $add: [ '$n', 1 ] } } } ] };
let counted = jsonproc.Execute( counter, jsonproc.Start( counter, { n: 41 } ) );
counted.State.n		// returns 42
```

An expression which produces nothing removes the field, as in
  [`$addFields`](http://jsongin.liquicode.com/#/guides/jsongin/Stage-Operators.md?id=addfields).
Use `'$$REMOVE'` to take a field off the state.

```js
const dropping = { Name: 'Dropping', Steps: [ { $do: { secret: '$$REMOVE' } } ] };
let dropped = jsonproc.Execute( dropping, jsonproc.Start( dropping, { keep: 1, secret: 2 } ) );
dropped.State		// returns { keep: 1 }
```

Every expression in one `$do` sees the state as it was before the step.


<a id="$when"></a>$when
---------------------------------------------------------------------

Usage: `$when: { Check: query, Then: [ steps ], Else: [ steps ] }`

Runs `Then` when the state matches the query, and `Else` when it does not.

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
To compare two fields, use `$expr` inside the query:

```js
const compared = {
	Name: 'Compared',
	Steps: [ { $when: { Check: { $expr: { $gt: [ '$a', '$b' ] } }, Then: [ { $do: { bigger: 'a' } } ], Else: [ { $do: { bigger: 'b' } } ] } } ],
};

let comparison = jsonproc.Execute( compared, jsonproc.Start( compared, { a: 9, b: 2 } ) );
comparison.State.bigger		// returns 'a'
```

`Check` is required; without it the step fails with `StepFailed`.
`Then` and `Else` are optional. A missing or empty branch does nothing, and the run moves to the
  next step.

While a branch runs, the cursor records the position inside it: `[ 0, 'Then', 1 ]` is the second
  step of the `Then` branch of step 0.

***A query has no variables.***
[`Query()`](http://jsongin.liquicode.com/#/guides/jsongin/Query.md) takes no scope, so a
  `$$name` is not visible in `Check`, even within `$expr`, and `$$NOW` there is the current time
  rather than the run's.
Compute the value into the state with `$do` first, and check the field.


<a id="$while"></a>$while
---------------------------------------------------------------------

Usage: `$while: { Check: query, Do: [ steps ] }`

Runs `Do` again and again while the state matches the query.

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

***The check is made before each pass, so the loop may run no times at all.***

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

Each step of a pass is a step of the run, and the cursor returns to the loop after the last one.
A run can stop in the middle of a pass, so a [`$call`](#$call) works inside `Do`.

A missing `Check`, or a missing or empty `Do`, fails the step with `BadProcess`.

```js
const spinning = { Name: 'Spinning', Steps: [ { $while: { Check: { go: true }, Do: [] } } ] };

let refused = jsonproc.Execute( spinning, jsonproc.Start( spinning, { go: true } ) );
refused.Status			// returns 'failed'
refused.Error.Code		// returns 'BadProcess'
```

A loop which never ends is stopped by [`Execute()`](./Process.md#stepping), which fails the run
  with `StepLimitExceeded` after `MaxSteps` steps.

```js
const forever = {
	Name: 'Forever',
	Steps: [ { $while: { Check: { go: true }, Do: [ { $do: { spins: { $add: [ '$spins', 1 ] } } } ] } } ],
};

let stopped = jsonproc.Execute( forever, jsonproc.Start( forever, { go: true, spins: 0 } ), 25 );
stopped.Status			// returns 'failed'
stopped.Error.Code		// returns 'StepLimitExceeded'
```

Like [`$when`](#$when), `Check` cannot see variables.


<a id="$forEach"></a>$forEach
---------------------------------------------------------------------

Usage: `$forEach: { In: expression, As: 'path', Index: 'path', Do: [ steps ] }`

Runs `Do` once for each element of an array.

| **Argument** | **Meaning**                                                              |
|--------------|--------------------------------------------------------------------------|
| `In`         | An expression which must produce an array.                               |
| `As`         | The field where each element is written.                                 |
| `Index`      | Optional. The field where the element's position is written.             |
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
So it can be read as `'$item'` in an expression and as `{ item: ... }` in a query:

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

`Index` writes the element's position alongside it:

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

***The `As` and `Index` fields are removed when the loop ends.***
A field of the same name already in the state is overwritten on the first pass and then removed
  too.
A loop over an empty array writes nothing and removes nothing.

```js
let tidied = jsonproc.Execute( summing, jsonproc.Start( summing, { items: [ 1, 2 ] } ) );
Object.keys( tidied.State ).includes( 'item' )		// returns false
```

The pass number is kept in the cursor, not the state: the branch element is `[ 'Do', 3 ]` during
  the fourth pass.

```js
let entered = jsonproc.Step( summing, jsonproc.Step( summing, jsonproc.Start( summing, { items: [ 1, 2 ] } ) ) );
entered.Cursor		// returns [ 1, [ 'Do', 0 ], 0 ]
```

***`In` is evaluated again before each pass.***
If `Do` adds to the array, the loop runs longer; if it shortens the array, the loop ends sooner.
A loop which keeps adding is stopped by `Execute()` with `StepLimitExceeded`.

A missing `As`, an `Index` which is not a string, or a missing or empty `Do` fails the step with
  `BadProcess`.
An `In` which does not produce an array fails it with `StepFailed`.


<a id="$try"></a>$try
---------------------------------------------------------------------

Usage: `$try: { Do: [ steps ], Catch: [ steps ], As: 'path' }`

Runs `Do`. If a step in it fails, runs `Catch` instead of stopping the run.

| **Argument** | **Meaning**                                                              |
|--------------|--------------------------------------------------------------------------|
| `Do`         | The steps to run.                                                        |
| `Catch`      | The steps to run if one of them fails.                                   |
| `As`         | Optional. The field where the error is written before `Catch` runs.      |

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

The error is written as `{ Code, Message, Cursor }`.
Because it is in the state, a `$when` in `Catch` can check it:

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

***A `$try` catches `StepFailed`, `Thrown`, and any code a `$throw` or the host chose.***
That includes a [`$throw`](#$throw), an expression which threw, and a call the host reported as
  failed through [`Resume()`](./Process.md#running-one), at any depth inside `Do`.
These codes are never caught:

| Never caught | |
|---|---|
| `BadProcess` | `BadRun` |
| `NoSuchStep` | `UnknownOperator` |
| `ResumeNotWaiting` | `StepLimitExceeded` |

```js
const typo = {
	Name: 'Typo',
	Steps: [ { $try: { Do: [ { $nosuchthing: 1 } ], Catch: [ { $do: { caught: true } } ], As: 'error' } } ],
};

let unswallowed = jsonproc.Execute( typo, jsonproc.Start( typo, {} ) );
unswallowed.Status			// returns 'failed'
unswallowed.Error.Code		// returns 'UnknownOperator'
```

A failure inside `Catch` is not caught by the same `$try`.
It goes to the next `$try` outward, or stops the run if there is none.

```js
const rethrown = {
	Name: 'Rethrown',
	Steps: [ { $try: { Do: [ { $throw: 'first' } ], Catch: [ { $throw: 'second' } ], As: 'error' } } ],
};

let escaped = jsonproc.Execute( rethrown, jsonproc.Start( rethrown, {} ) );
escaped.Status				// returns 'failed'
escaped.Error.Message		// returns 'second'
```

***Nothing is rolled back.*** `Catch` sees the state as the failure left it.
A loop abandoned by the failure leaves its `As` and `Index` fields behind.

The `As` field stays on the state after `Catch` runs.
Remove it with `{ $do: { error: '$$REMOVE' } }` if you do not want it.

A missing or empty `Do` or `Catch`, or an `As` which is not a string, fails the step with
  `BadProcess`.


<a id="$throw"></a>$throw
---------------------------------------------------------------------

Usage: `$throw: expression`

Fails the run on purpose.

The expression is evaluated against the state:

| Produces | Error |
|---|---|
| a string | `{ Code: 'Thrown', Message: <the string> }` |
| a document | `{ Code, Message }`; `Code` defaults to `Thrown` and `Message` to `''` |
| anything else | `{ Code: 'Thrown', Message: <the value as a string> }` |

```js
const complaining = { Name: 'Complaining', Steps: [ { $throw: 'the cart is empty' } ] };

let complained = jsonproc.Execute( complaining, jsonproc.Start( complaining, {} ) );
complained.Status		// returns 'failed'
complained.Error		// returns { Code: 'Thrown', Message: 'the cart is empty', Cursor: [ 0 ] }
```

The nearest enclosing [`$try`](#$try) catches it.
With no `$try`, the run stops, as above.

Use the document form to choose a code:

```js
const named = {
	Name: 'Named',
	Steps: [ { $throw: { Code: 'NoCustomer', Message: { $concat: [ 'no such customer: ', '$who' ] } } } ],
};

let complaint = jsonproc.Execute( named, jsonproc.Start( named, { who: 'ada' } ) );
complaint.Error.Code		// returns 'NoCustomer'
complaint.Error.Message		// returns 'no such customer: ada'
```

***A `$throw` may not use a code a `$try` never catches.***
Naming `BadProcess`, `BadRun`, `NoSuchStep`, `UnknownOperator`, `ResumeNotWaiting` or
  `StepLimitExceeded` fails the step with `BadProcess` instead.

```js
const sneaky = { Name: 'Sneaky', Steps: [ { $throw: { Code: 'BadProcess', Message: 'let me out' } } ] };

let denied = jsonproc.Execute( sneaky, jsonproc.Start( sneaky, {} ) );
denied.Error.Code		// returns 'BadProcess'
```


<a id="$call"></a>$call
---------------------------------------------------------------------

Usage: `$call: { Name: 'name', With: { field: expression, ... }, Into: 'path' }`

Suspends the run so that your code can do work the runtime cannot.

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

***`$call` does not call anything.***
The run stops with `Status: 'waiting'` and a `Waiting` document.
Your code reads it, does the work, and passes the answer to `Resume()`.

```js
let resumed = jsonproc.Execute( charging, jsonproc.Resume( charging, waiting, { paid: true } ) );
resumed.Status		// returns 'done'
resumed.Result		// returns { paid: true }
```

| **Argument** | **Meaning**                                                              |
|--------------|--------------------------------------------------------------------------|
| `Name`       | Required. What you are being asked to do. Without it the step fails with `StepFailed`. |
| `With`       | Optional. An expression document, evaluated when the step runs, so `Waiting.With` holds values. Defaults to `{}`. |
| `Into`       | Optional. The field where `Resume()` writes the result. A result of `undefined` removes the field. |


### Fanning Out

***Parallel work is done by your code, not by a step.***
One `$call` can ask for several things, and your code can do them at the same time however it
  likes.

Each piece of work can be a separate process with its own run:

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

// Your handler for the call. A real one could run the children with Promise.all().
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

The parent run can be stored while the children are running.
Runs never affect each other ([invariant 4](./Process.md#the-invariants)), so the children are
  safe to run at the same time.
If a child fails, report it through the fourth argument of `Resume()`, and a `$try` around the
  `$call` catches it.


<a id="$return"></a>$return
---------------------------------------------------------------------

Usage: `$return: expression`

Ends the run with `Status: 'done'` and the expression's value in `Result`.

```js
const answering = { Name: 'Answering', Steps: [ { $return: { sum: { $add: [ '$a', '$b' ] } } } ] };
let answer = jsonproc.Execute( answering, jsonproc.Start( answering, { a: 1, b: 2 } ) );

answer.Status		// returns 'done'
answer.Result		// returns { sum: 3 }
```

The steps after it do not run.

***Running off the end of the top level `Steps` is the same as `{ $return: '$$ROOT' }`.***

```js
const implicit = { Name: 'Implicit', Steps: [ { $do: { doubled: { $multiply: [ '$n', 2 ] } } } ] };
let implied = jsonproc.Execute( implicit, jsonproc.Start( implicit, { n: 21 } ) );

implied.Status		// returns 'done'
implied.Result		// returns { n: 21, doubled: 42 }
```

An expression which produces nothing leaves the run with no `Result` field at all.

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
