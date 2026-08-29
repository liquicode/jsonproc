# @liquicode/jsonproc


# Testing

***`jsonproc` makes no parity claim, and that is the interesting thing about testing it.***

MongoDB has no process language.
There is no server to compare a run against, so the method the rest of this family uses — let
  MongoDB decide what correct means — has nothing to decide here.
What takes its place is a set of ***invariants***: rules which must be true of the design
  itself, and which can be checked without any authority at all.


## Running the Tests

```bash
npm test
```

This runs the unit tests and the invariant check, in that order, and needs nothing but Node.

```bash
npm run process-check
```

This runs the invariant check on its own.
Add `--verbose` to list every finding rather than the first few.

```bash
npm run check-docs
```

This checks the documentation: every `js` fence must parse, every local link and anchor must
  resolve, every page must be reachable, every registered operator must carry an `/*md` block,
  and every claim a fence makes about what a call returns is executed and compared.


## The Two Kinds of Test

***Unit tests*** measure behavior.
They live in `test/Unit Tests/` and are ordinary mocha tests: this process, stepped this way,
  reaches this run.

***The invariant check*** measures the design.
It lives in `build/process-check.js`, drives every fixture it holds through the whole runtime,
  and applies eight rules at every step of each:

| | Invariant |
|---|---|
| 1 | ***Storage is transparent.*** `Step( P, Parse( Format( run, T ), T ) )` equals `Step( P, run )`. A run which cannot be written down and read back is not a run. |
| 2 | ***Stepping is deterministic.*** The same run stepped twice gives the same result. |
| 3 | ***`Execute` equals repeated `Step`.*** The convenience wrapper cannot be allowed to diverge from the primitive. |
| 4 | ***Runs are independent.*** Two runs stepped alternately never affect each other. |
| 5 | ***`Step` is total.*** It always returns a run and never throws. A failure is a run with `Status` `'failed'`. |
| 6 | ***The input run is never modified.*** Every function returns a new value. |
| 7 | ***A runaway loop is failed, not hung.*** A process which never halts is a process; `Execute()` never coming back from one would be a defect. |
| 8 | ***A failure is caught only where it should be.*** A `$try` catches a failure raised by running a step, and nothing else. |

***This file was written before the first step operator existed***, and reported the runtime as
  missing until it did.
That was the correct answer and the whole reason to write it first: the finish line is drawn
  before the race is run.
It moved out of `jsongin` with the runtime it measures, and the invariants moved unchanged.


## Why the Invariants Are the Stronger Half

A unit test says what one process does.
An invariant says what ***every*** process must do, and it says it about processes nobody
  thought to write a test for.

Invariant 1 is the load-bearing claim of the whole design, and it is the reason a run leaves
  `Waiting`, `Result` and `Error` off a run they do not apply to rather than setting them to
  `undefined`: `Format` drops a field whose value is `undefined` and `Parse` does not put it
  back. The rule is not being lenient about that; the design is being told what shape it has
  to have.

Invariant 4 is what the variable scope being a ***value the caller owns*** bought, at the cost
  of touching two hundred files in `jsongin` to get it. It is tested here rather than assumed,
  and it is also what makes running several runs at once safe — which is why there is no
  parallel step operator and no plan for one.


## See Also

- [The Process Runtime](./jsonproc/Process.md)
- [Operator Authoring](./Operator-Authoring.md)
- [Library Guide](./Library-Guide.md)
