# @liquicode/jsonproc


# Operator Authoring

Every step operator `jsonproc` supports is a self contained module which is registered into a
  runtime instance by name.
Nothing about that registry is private, so you can add step operators of your own the same way
  the built-in ones are added.

This document describes the step operator contract and how to register one.
For the query, expression, update, stage and accumulator operators a step ***computes*** with,
  see jsongin's own
  [Operator Authoring](http://jsongin.liquicode.com/#/guides/Operator-Authoring.md).


## The Shape of a Step Operator Module

A step operator module exports a ***factory function*** which takes the runtime and returns an
  operator object:

```js
// docs-check: skip - an operator module, shown as it appears in its own file.
'use strict';
/*md

## Operators > Step > $myStep

Usage: `$myStep: { ... }`

What it does, and an example of it.

*/

module.exports = function ( jsonproc )
{
	const jsongin = jsonproc.jsongin;

	let operator =
	{
		Engine: jsonproc,

		Step: function ( State, Args, Scope, Position )
		{
			// ...
			return { Action: 'next' };
		},
	};

	return operator;
};
```

The factory is called once per runtime instance, so the operator closes over the runtime it
  belongs to — and, through it, the engine that runtime evaluates against.

***The `/*md` block is not optional.***
`npm run check-docs` fails an operator file which has none, so an operator cannot be added
  without being written up.


## The Step Contract

```
Step: function ( State, Args, Scope, Position )
```

Carries out one step of a process and says what the runtime should do next.
See [The Process Runtime](./jsonproc/Process.md) for the run value these move through.

- `State` is the document the process is working on.
- `Args` is whatever the step wrote as the operator's value.
- `Scope` is the frame chain the step is evaluated against. Pass it along; see below.
- `Position` is a document carrying `Reentry`: the branch element the cursor climbed out of,
  such as `[ 'Do', 3 ]`, or `null` when the step is being reached rather than returned to.
  Only a repeating operator needs it.

***A step operator returns an outcome rather than a value***, which is the one way this kind
  differs from every other operator in the family.
The outcome is a document naming an `Action`:

| **Action** | **Means**                          | **Also reads**                            |
|------------|------------------------------------|-------------------------------------------|
| `next`     | the step is done, move on          | `State`, when the step changed it         |
| `enter`    | descend into a branch of this step | `Branch` (required), `Iteration`, `State` |
| `wait`     | suspend until the host answers     | `Waiting` (required)                      |
| `halt`     | the run is over                    | `Result`                                  |

Anything else — an outcome which is not a document, or an `Action` outside those four — fails
  the run with `StepFailed`.

***An operator may name the code it fails with*** by setting `Code` on the error it throws.
A fault the operator can see in the process document rather than in the state should say
  `BadProcess`, so that a caller is told which of the two it is looking at.
An operator which throws an ordinary `Error` gets `StepFailed`.

***An operator may not name one of the uncatchable codes.***
`BadProcess`, `BadRun`, `NoSuchStep`, `UnknownOperator`, `ResumeNotWaiting` and
  `StepLimitExceeded` halt a run whatever wraps it, and the line between an error and a bug is
  exactly that list — so a process document must not be able to cross it from the inside.
`$throw` refuses to name one.


## The Scope Contract

***An operator which does not pass its `Scope` along loses every variable underneath it.***
Nothing goes wrong at the time. It goes wrong later, when somebody writes a `$$name` inside
  that one operator, and it reads as "`$map` is broken" rather than as "your step dropped the
  scope".

Two rules apply here:

1. Every `jsongin.Evaluate(` call passes three arguments. Two means the caller is making a
   fresh root scope by accident, which is exactly how a variable goes missing.
2. A step operator declares its `Step` with a `Scope`. An operator which needs the cursor takes
   `Position` ***after*** it, which is why `$while`, `$forEach`, `$try` and `$throw` carry the
   scope in the third slot rather than the last.

***Bind names with `Scope.Child( { name: value } )`, never by writing into `Scope.Variables`.***
A frame is immutable once made, and a child frame is what a binding is.
If your operator binds a name the caller chose, put it through
  `jsongin.Scope.RequireName( Name, '$myStep' )` first, so that a name which could be mistaken
  for a system variable is refused rather than shadowing one.

> ***A loop's iteration variable is written into the state, not bound as a `$$name`.***
  `Query()` takes no scope, so a `$$name` would be invisible to exactly the `$when` a loop body
  most often wants to make. `$forEach` writes to `As` for that reason, and a step operator of
  your own which offers the caller a value should do the same.

See [Scope](http://jsongin.liquicode.com/#/guides/jsongin/Scope.md) for the object itself.


## Reporting Problems

Operators do not print anything directly. They report through the runtime's log handlers, which
  are `null` unless the caller configured them.

```js
// docs-check: skip - shown as it appears inside an operator.
try
{
	// An explanation: the operation completed, but not as expected.
	if ( jsonproc.OpLog ) { jsonproc.OpLog( `$myStep: nothing to iterate at [${Path}].` ); }
}
catch ( error )
{
	// An error: the operation cannot complete.
	if ( jsonproc.OpError ) { jsonproc.OpError( `Step.$myStep: ${error.message}` ); }
	throw error;
}
```

Always guard the call with `if ( jsonproc.OpLog )`.
Always prefix the message with your operator's name.
When you catch an error to log it, ***rethrow it***; the log is an addition to the throw, not a
  replacement for it.

> ***The runtime catches what an operator throws.*** Nothing in `jsonproc` throws out to the
  caller; a throw becomes a failed run at the cursor which raised it. That is the point of the
  design, and it is invariant 5.


## Registering an Operator

Add it to the registry on a runtime instance:

```js
// docs-check: skip - registers an operator from a file of your own.
const jsonproc = require( '@liquicode/jsonproc' ).NewJsonproc();

jsonproc.StepOperators.$myStep = require( './my-operators/myStep' )( jsonproc );
```

The registry is a plain object keyed by operator name, so this is all registration amounts to.
Replacing an existing key overrides that operator for the instance.

Because the registry belongs to the instance, an operator you add to one runtime is not visible
  to another. Use `NewJsonproc()` to make an instance to extend, and leave the module's default
  instance alone if other code shares it.


## See Also

- [Step Operators](./jsonproc/Step-Operators.md)
- [The Process Runtime](./jsonproc/Process.md)
- [Testing](./Testing.md)
