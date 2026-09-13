# @liquicode/jsonproc


# Project History



v0.2.0 (current)
---------------------------------------------------------------------

***Built on `@liquicode/jsongin` 0.2.0.*** The runtime itself is unchanged, but the checks in
  `$when` and `$while` are jsongin queries, so they follow jsongin's new rules: an object whose
  first key is an operator holds only operators, and one whose first key is a field name is a
  value. Read [jsongin's history](https://github.com/liquicode/jsongin/blob/main/history.md) for
  the details.

- ***ESM named imports and TypeScript declarations.*** The package has an `exports` map, an ESM
  entry point `src/jsonproc.mjs`, and `types/jsonproc.d.ts`.
  *Breaking for deep imports: a path into the package other than those the map names is no
  longer reachable.*
- ***`docs/guides/Llm-Context.md`*** describes the process language for a language model, and a
  check holds it to every step operator.
- The user documentation is rewritten in plain language, and each claim was checked against the
  runtime.
- The package declares Node.js `>=10.4.0` in `engines`.



v0.1.0 (2026-08-29)
---------------------------------------------------------------------

***The first version, and it is a move rather than a beginning.***

The process runtime was built inside `@liquicode/jsongin` and released there as part of its
  v0.1.0. It is a language of its own with its own tests, its own invariants and its own
  documentation, and none of it is MongoDB's — so it moved out into a package of its own rather
  than growing inside an engine whose whole method is that MongoDB decides what correct means.

Everything came across unchanged except its names and the engine it reaches.


### What Moved

- `Process.js`, the runtime, now `src/jsonproc/Process.js`.
- The eight step operators — `$do`, `$when`, `$while`, `$forEach`, `$try`, `$throw`, `$call`
  and `$return` — now `src/Operators/Step/`.
- The `StepOperators` registry, now on a `jsonproc` runtime rather than a `jsongin` engine.
- `build/process-check.js` and its eight invariants, unchanged.
- The unit tests, unchanged.
- `docs/guides/jsongin/Process.md` and `Step-Operators.md`, now under `docs/guides/jsonproc/`.


### Breaking — Names

For anyone who used the runtime through `jsongin` v0.1.0:

| Was | Is |
|---|---|
| `jsongin.ProcessStart( Process, Input )` | `jsonproc.Start( Process, Input )` |
| `jsongin.ProcessStep( Process, Run )` | `jsonproc.Step( Process, Run )` |
| `jsongin.ProcessExecute( Process, Run, MaxSteps )` | `jsonproc.Execute( Process, Run, MaxSteps )` |
| `jsongin.ProcessResume( Process, Run, Result, Error )` | `jsonproc.Resume( Process, Run, Result, Error )` |
| `jsongin.StepOperators` | `jsonproc.StepOperators` |

The `Process` prefix was there to keep four engine functions apart from the rest of an engine
  with fifty of them. In a package which is the process runtime it said nothing, so it is gone.

***Nothing else changed.*** A process document written against `jsongin` v0.1.0 runs here
  unaltered, and so does a stored run: the run value, the cursor, the statuses, the error codes
  and the storage form are all exactly what they were.


### New

- ***The engine is a setting.*** `NewJsonproc( { jsongin: <engine> } )` runs a process against
  an engine of the caller's choosing, so a host which registered an expression operator of its
  own can compute with it. Naming no engine takes jsongin's default instance.
- ***A step operator factory receives the runtime***, not the engine. It reaches the engine
  through `jsonproc.jsongin`.
- ***The browser bundle does not contain jsongin.*** It resolves `@liquicode/jsongin` to the
  global that library publishes, so a page which loads both scripts holds one engine rather
  than two. See [Browser Usage](/docs/guides/Usage-Browser.md).
