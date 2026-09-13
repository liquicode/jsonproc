# @liquicode/jsonproc


# Operator Authoring

Each step operator is an object registered by name in a runtime's `StepOperators`.
You can add step operators of your own.

This page covers step operators.
For the query, expression, update, stage and accumulator operators a step computes with, see
  jsongin's [Operator Authoring](http://jsongin.liquicode.com/#/guides/Operator-Authoring.md).


## A Step Operator

```js
const runtime = jsonproc.NewJsonproc();

runtime.StepOperators.$flag = {
	ArgTypes: 's',
	Step: function ( State, Args, Scope, Position )
	{
		let state = jsongin.SafeClone( State );
		jsongin.SetValue( state, Args, true );
		return { Action: 'next', State: state };
	},
};

const flagging = { Name: 'Flagging', Steps: [ { $flag: 'checked' } ] };
let flagged = runtime.Execute( flagging, runtime.Start( flagging, { n: 1 } ) );
flagged.State		// returns { n: 1, checked: true }
```

| **Field**  | **Meaning**                                                                   |
|------------|--------------------------------------------------------------------------------|
| `Step`     | Required. The function which runs the step.                                   |
| `ArgTypes` | Optional. A string of [`ShortType`](http://jsongin.liquicode.com/#/guides/jsongin/ShortType.md) letters. A step whose argument has another type fails the run with `BadProcess` before `Step` is called. |
| `Repeats`  | Optional. `true` makes the operator a loop; see [Loops](#loops).              |
| `Catches`  | Optional. Makes the operator a handler; see [Handlers](#handlers).            |

The built-in operators are written as modules which export a factory taking the runtime:

```js
// docs-check: skip - an operator module in a file of your own.
module.exports = function ( jsonproc )
{
	const jsongin = jsonproc.jsongin;
	return {
		ArgTypes: 'o',
		Step: function ( State, Args, Scope, Position ) { return { Action: 'next' }; },
	};
};
```

Use `jsonproc.jsongin` inside the operator, so it computes with the same engine as the runtime.


## The Step Function

```
Step: function ( State, Args, Scope, Position )
```

- `State` is the document the process is working on. ***Do not change it.*** Clone it and return
  the copy.
- `Args` is the value the step gave the operator.
- `Scope` is the run's variables. Pass it to jsongin; see [Scope](#scope).
- `Position.Reentry` is the branch element the cursor just left, such as `[ 'Do', 3 ]`, or `null`.
  Only a loop needs it.

`Step` returns an ***outcome*** document naming an `Action`:

| **Action** | **Means**                           | **Also reads**                            |
|------------|-------------------------------------|-------------------------------------------|
| `next`     | move to the next step               | `State`, if the step changed it           |
| `enter`    | run a branch of this step           | `Branch` (required), `Iteration`, `State` |
| `wait`     | suspend until `Resume()`            | `Waiting` (required)                      |
| `halt`     | end the run with `Status: 'done'`   | `Result`                                  |

`Branch` names an array of steps in `Args`, such as `'Then'`. Naming one which is not there fails
  the run with `NoSuchStep`.
`Iteration` is a number, and makes the cursor element `[ Branch, Iteration ]`.
`Waiting` should be `{ Name, With, Into }`; `Resume()` writes its result at `Waiting.Into`.

An outcome which is not a document, an unknown `Action`, a `Branch` which is not a string, or a
  `Waiting` which is not a document fails the run with `StepFailed`.


## Failing

Throw to fail the step. The runtime catches it and fails the run at that step.

The code is `StepFailed`, unless the error has a string `Code` property.
Use `BadProcess` for a mistake in the process document, such as a missing argument.

```js
// docs-check: skip - inside a Step function.
let error = new Error( '$flag requires a field name.' );
error.Code = 'BadProcess';
throw error;
```

***Codes the runtime never catches*** - `BadProcess`, `BadRun`, `NoSuchStep`,
  `UnknownOperator`, `ResumeNotWaiting` and `StepLimitExceeded` - pass every `$try`, whichever
  operator throws them.
Use them only for faults a process should not be able to handle.


<a id="loops"></a>
## Loops

With `Repeats: true`, the cursor returns to the operator each time a branch it entered ends.
`Position.Reentry` is then the element it left, and `null` when the step is first reached.
Return `enter` to run the branch again, or `next` to finish.

Enter with an `Iteration` to keep a pass number in the cursor, as `$forEach` does.


<a id="handlers"></a>
## Handlers

`Catches: { From: 'Do', Into: 'Catch' }` makes the operator a handler, as `$try` is.
When a catchable failure happens inside the `From` branch, the run continues at the first step of
  the `Into` branch.
If `Args.As` is a string, the error `{ Code, Message, Cursor }` is written to that field first.
A missing or empty `Into` branch does not catch, and the failure moves outward.

The operator itself only enters `From`.


<a id="scope"></a>
## Scope

Evaluate expressions with a scope for the current document:

```js
// docs-check: skip - inside a Step function.
let value = jsongin.Evaluate( State, Args.Value, Scope.ForDocument( State ) );
```

***Always pass a scope to `Evaluate()`.*** Without one, `$$NOW` is the current time rather than
  the run's, and the run's variables are missing.

To add a variable, use `Scope.Child( { name: value } )`. A scope cannot be changed.
If the caller chooses the name, check it with `jsongin.Scope.RequireName( Name, '$myStep' )`.

`Query()` takes no scope.
To make a value visible to a `Check`, write it into the state, as `$forEach` does with `As`.

See [Scope](http://jsongin.liquicode.com/#/guides/jsongin/Scope.md).


## Logging

A runtime's `OpLog` and `OpError` are `null` unless set.
Check before calling, and start the message with the operator's name:

```js
// docs-check: skip - inside a Step function.
if ( jsonproc.OpLog ) { jsonproc.OpLog( `$flag: nothing to flag.` ); }
```


## Registering an Operator

```js
// docs-check: skip - registers an operator from a file of your own.
const jsonproc = require( '@liquicode/jsonproc' ).NewJsonproc();

jsonproc.StepOperators.$myStep = require( './my-operators/myStep' )( jsonproc );
```

Using an existing name replaces that operator.

***Each runtime has its own registry.*** An operator added to one is not visible to another.
Add operators to a runtime made with `NewJsonproc()`, not to the shared default one.

An operator file under `src/Operators/` in this repository must also contain a `/*md` comment
  block describing it; `npm run check-docs` fails without one.


## See Also

- [Step Operators](./jsonproc/Step-Operators.md)
- [The Process Runtime](./jsonproc/Process.md)
- [Testing](./Testing.md)
