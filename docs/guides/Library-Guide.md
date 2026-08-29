# @liquicode/jsonproc


# Library Guide

`jsonproc` is a process runtime for JSON documents.

A ***process*** is a JSON document describing work.
A ***run*** is a JSON value describing how far that work has got.
The runtime is a pure function from one run to the next and holds nothing between calls, so a
  run can be written down, moved, and picked up an hour later somewhere else.

The module's default export is a ready-to-use runtime instance.
To create an instance with custom settings, use the `NewJsonproc( Settings )` factory method.
See [NodeJS Usage](./Usage-NodeJS.md) for both forms.


jsonproc Functions
---------------------------------------------------------------------


### The Process Runtime

Four functions, from one run to the next.
See [The Process Runtime](./jsonproc/Process.md) for the run value and the rules, and
[Step Operators](./jsonproc/Step-Operators.md) for `$do`, `$when`, `$call` and `$return`.

- [Start( Process, Input )](./jsonproc/Process.md)
  : Begins a run, with `Input` as its state.

- [Step( Process, Run )](./jsonproc/Process.md)
  : Runs one step and returns a new run. Stepping a halted run is a no-op.

- [Execute( Process, Run, MaxSteps )](./jsonproc/Process.md)
  : Steps until the run is no longer ready. `MaxSteps` defaults to 1000.

- [Resume( Process, Run, Result, Error )](./jsonproc/Process.md)
  : Hands a waiting run the result of the call it suspended on, or the failure of it.

***Nothing here throws.***
A failure is a run with `Status` `'failed'` and an `Error` on it, because the point of the
  design is that a run is a value which can be stored and looked at later — and an error which
  vanished into a throw could not be.


### The Engine Underneath

`jsonproc` evaluates nothing itself.
Every expression a step computes, every criteria a step tests, and every scope a step is
  evaluated against belongs to [`jsongin`](http://jsongin.liquicode.com), which is at parity
  with MongoDB and is measured against it.

- `jsonproc.jsongin`
  : The engine this runtime evaluates against.
  It is a setting rather than a fixed import, because an engine carries its operator registries
  and a host which registered an operator of its own must be able to compute with it.
  See [NodeJS Usage](./Usage-NodeJS.md).

Only the step sequencing, the branching, the run value, the suspension and the error
  propagation are `jsonproc`'s own.
That division is the reason a process language could be built at all without giving up the
  family's method: what an expression means still has an authority, and only what a step does
  is decided here.


### Registration

- `jsonproc.StepOperators`
  : The registered step operators, keyed by name.

The registry is a plain object, so a step operator of your own is registered the same way the
  built-in ones are.
See [Operator Authoring](./Operator-Authoring.md).


## See Also

- [The Process Runtime](./jsonproc/Process.md)
- [Step Operators](./jsonproc/Step-Operators.md)
- [NodeJS Usage](./Usage-NodeJS.md)
- [Browser Usage](./Usage-Browser.md)
- [Operator Authoring](./Operator-Authoring.md)
- [Testing](./Testing.md)
