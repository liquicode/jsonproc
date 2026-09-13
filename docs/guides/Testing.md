# @liquicode/jsonproc


# Testing

MongoDB has no process language, so jsonproc is not compared against a server.
It is tested with unit tests and with ***invariants***: rules every process and run must obey.


## Running the Tests

```bash
npm test
```

Runs the unit tests, then the invariant check. Needs only Node.

```bash
npm run process-check
```

Runs the invariant check alone. Add `-- --verbose` to list every finding rather than the first
  few.

```bash
npm run check-docs
```

Checks the documentation:

- every `js` fence parses;
- every local link and anchor resolves, and every page is linked from somewhere;
- every operator file under `src/Operators/` has a `/*md` block;
- `docs/guides/Llm-Context.md` names every step operator;
- every `js` fence runs, and each `// returns` comment or `===` line in it is checked.

```bash
npm run types-check
```

Checks that the type declaration in `types/` and the ES module wrapper match the runtime.


## Unit Tests

The unit tests are mocha tests in `test/Unit Tests/`.
Each one runs a process and checks the run it reaches.


## The Invariants

`build/process-check.js` drives a set of fixture processes through the runtime and checks these
  rules at every step:

| | Invariant |
|---|---|
| 1 | ***Storage is transparent.*** `Step( P, Parse( Format( run, T ), T ) )` equals `Step( P, run )`, where `T` is `{ TypedValues: true }`. |
| 2 | ***Stepping is deterministic.*** The same run stepped twice gives the same result. |
| 3 | ***`Execute` equals repeated `Step`.*** |
| 4 | ***Runs are independent.*** Two runs stepped alternately never affect each other. |
| 5 | ***`Step` is total.*** It always returns a run and never throws. |
| 6 | ***The input run is never modified.*** Every function returns a new value. |
| 7 | ***A runaway loop fails.*** `Execute()` returns a `StepLimitExceeded` run rather than running forever. |
| 8 | ***A failure is caught only where it should be.*** A `$try` catches a failure raised by running a step, and nothing else. |

A unit test checks one process.
An invariant is checked on every fixture, so it also covers cases no unit test was written for.


## See Also

- [The Process Runtime](./jsonproc/Process.md)
- [Operator Authoring](./Operator-Authoring.md)
- [Library Guide](./Library-Guide.md)
