# @liquicode/jsonproc


# Library Guide

`jsonproc` runs processes written as JSON.

A ***process*** is a JSON document describing work.
A ***run*** is a JSON value recording how far that work has got.
The runtime keeps nothing between calls, so a run can be stored and continued later, somewhere
  else.

The module exports a ready-to-use runtime.
To choose settings, use `NewJsonproc( Settings )`.
See [NodeJS Usage](./Usage-NodeJS.md).


jsonproc Functions
---------------------------------------------------------------------


### The Process Runtime

See [The Process Runtime](./jsonproc/Process.md) for runs and failures, and
  [Step Operators](./jsonproc/Step-Operators.md) for the steps a process is made of.

- [Start( Process, Input )](./jsonproc/Process.md#a-run)
  : Begins a run, with a copy of `Input` as its state.

- [Step( Process, Run )](./jsonproc/Process.md#stepping)
  : Runs one step and returns a new run. A run which is not `ready` comes back unchanged.

- [Execute( Process, Run, MaxSteps )](./jsonproc/Process.md#running-one)
  : Steps until the run is not `ready`. Fails the run after `MaxSteps` steps, 1000 by default.

- [Resume( Process, Run, Result, Error )](./jsonproc/Process.md#running-one)
  : Gives a `waiting` run the result of its `$call`, or reports that the call failed.

***None of these functions throws.***
A failure is a run with `Status: 'failed'` and an `Error`.


### The Engine

`jsonproc` evaluates every expression and query with
  [jsongin](http://jsongin.liquicode.com).

- `jsonproc.jsongin`
  : The jsongin engine this runtime uses. Choose it with the `jsongin` setting.
  See [NodeJS Usage](./Usage-NodeJS.md#running-against-your-own-engine).


### Registration

- `jsonproc.StepOperators`
  : The step operators, by name. Add your own; see [Operator Authoring](./Operator-Authoring.md).


## See Also

- [The Process Runtime](./jsonproc/Process.md)
- [Step Operators](./jsonproc/Step-Operators.md)
- [NodeJS Usage](./Usage-NodeJS.md)
- [Browser Usage](./Usage-Browser.md)
- [Operator Authoring](./Operator-Authoring.md)
- [Testing](./Testing.md)
