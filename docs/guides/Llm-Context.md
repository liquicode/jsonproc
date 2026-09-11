# jsonproc for a Language Model

A single self-contained description of everything a model needs in order to write a **process**
for jsonproc, written to be pasted into a prompt whole.

This is a *derivation*, not a reference. The [Library Guide](/guides/Library-Guide.md) and the
operator pages explain the engine to a human reading one page at a time; this gives a model the
whole vocabulary at once, with the traps called out where they happen.

jsonproc runs on [jsongin](https://github.com/liquicode/jsongin). Where this document says
*query* it means a jsongin query criteria, and where it says *expression* it means a jsongin
aggregation expression. The two are not interchangeable and telling them apart is most of what
there is to learn here.

**Every example below uses one invented subject**, a freight consignment, which is not
anybody's real data. The point of an example here is the *shape* of the operator; a document
written around one consumer's field names teaches those names instead. **Use the field names of
the data you are actually shown, never these.**


## The shape of a process

A process is an object with a `Name` and a `Steps` array. **Each step is one object carrying
exactly one step operator:**

```
{
  "Name": "Price The Consignment",
  "Steps": [
    { "$do": { "Charge": { "$add": [ "$BaseRate", "$FuelLevy" ] } } },
    { "$when": { "Check": { "Charge": { "$gt": 0 } },
                 "Then": [ { "$return": "$Charge" } ],
                 "Else": [ { "$throw": "nothing to price" } ] } }
  ]
}
```

Two steps in one object is refused. `{ "$do": {...}, "$return": "$x" }` is not a step; it is
two steps and must be written as two array elements.

There are **eight** step operators and no others: `$do`, `$when`, `$while`, `$forEach`, `$try`,
`$throw`, `$call`, `$return`. There is no `$if`, no `$for`, no `$switch`, no `$log` and no
`$set` step.

**A process has a *state*** — one document that every step reads and writes. It starts as
whatever the caller passed in. Running off the end of `Steps` returns the whole state.


## Expressions and queries are different languages

This is the distinction that matters most, and the one most often got wrong.

**An expression computes a value.** Field references carry a `$`:

```
{ "$add": [ "$BaseRate", "$FuelLevy" ] }    reads state.BaseRate and state.FuelLevy
"$Shipper.Name"                              a bare reference is an expression too
```

**A query selects.** It is a jsongin criteria, keyed by field name, with **no** `$` prefix on
the field:

```
{ "Charge": { "$gt": 100 } }                correct in a Check
{ "$gt": [ "$Charge", 100 ] }               WRONG in a Check - that is an expression
```

`Check` in `$when` and `$while` takes a **query**. `In` in `$forEach`, `With` in `$call`, and
the whole of `$do`, `$return` and `$throw` take **expressions**.

**A bare word is a literal and a `$` word is a field.** `"Weight"` is the six-letter string;
`"$Weight"` is whatever the state holds under `Weight`. Passing `"Weight"` where you meant the
value is the most common expression mistake, and nothing rejects it — the process runs and
carries the wrong data.

A query can hold `$expr` when you genuinely need to compare two fields:
`{ "$expr": { "$gt": [ "$Paid", "$Charge" ] } }`.

Three system variables are available in expressions: `$$NOW` for the current time, `$$ROOT` for
the whole state, and `$$REMOVE`, which takes a field off the state when written to it.


## The step operators

### `$do` — change the state

```
{ "$do": { "field": expression, ... } }
```

Each field is computed from the current state and written back, leaving other fields alone.

**`$do` is the aggregation `$set` *stage*, not the update operator of the same name.** It
computes. So `{ "$add": [ "$n", 1 ] }` is arithmetic here, where the same document handed to an
update would be stored literally.

The cost of that choice: **`$inc`, `$mul` and `$push` do not exist here.** A counter is
incremented by computing it:

```
{ "$do": { "Handled": { "$add": [ "$Handled", 1 ] } } }     correct
{ "$do": { "Handled": { "$inc": 1 } } }                      WRONG - $inc is an update operator
```

Writing `"$$REMOVE"` removes a field.

### `$when` — a branch

```
{ "$when": { "Check": query, "Then": [ steps ], "Else": [ steps ] } }
```

`Else` is optional; a check that fails with no `Else` simply moves on. `Check` is a **query**.

```
{ "$when": { "Check": { "Weight": { "$gt": 500 } },
             "Then": [ { "$do": { "Surcharge": 25 } } ],
             "Else": [ { "$do": { "Surcharge": 0 } } ] } }
```

### `$while` — a loop

```
{ "$while": { "Check": query, "Do": [ steps ] } }
```

The check is made **before each pass**, so the loop may run no times at all. `Check` is a
**query**. The body must change something the check reads, or the run ends in
`StepLimitExceeded`.

### `$forEach` — a loop over an array

```
{ "$forEach": { "In": expression, "As": "name", "Index": "name", "Do": [ steps ] } }
```

`In` is an **expression** that must produce an array. `As` names a field in the state where
each element is written before its pass. `Index` is optional and gets the position. `Do` is the
body.

**The element is written into the state, not bound as a variable**, so it is reachable both as
`"$Leg"` in an expression and as `{ "Leg": ... }` in a query — which matters, because a `Check`
cannot see variables. **`As` and `Index` are removed when the loop ends.**

`In` is evaluated again before every pass, so a body that appends to the array is a work list
that grows.

### `$try` — handle a failure

```
{ "$try": { "Do": [ steps ], "Catch": [ steps ], "As": "Problem" } }
```

`As` is optional and names where the error is written as `{ Code, Message, Cursor }` before
`Catch` runs. Unlike a loop's `As`, it **stays** on the state afterwards.

**A `$try` catches a failure raised by running a step, and nothing else.** A refused operator, a
`$throw`, and a host-reported call failure are caught. A fault in the process document is not:
`BadProcess`, `BadRun`, `NoSuchStep`, `UnknownOperator`, `ResumeNotWaiting` and
`StepLimitExceeded` halt the run whatever it is wrapped in. That line is the difference between
an error and a bug.

A failure inside `Catch` is not caught by the same `Catch`. The state is **not** rolled back.

### `$throw` — fail on purpose

```
{ "$throw": "no route was found" }
{ "$throw": { "Code": "NoRoute", "Message": "no route was found" } }
```

A string becomes `{ Code: 'Thrown', Message: <string> }`. **A document keeps the `Code` you
give it**, so when a particular code is wanted, write the document form — the string form
always produces `Thrown` and nothing else. The engine's own codes are reserved and naming one
is itself a `BadProcess`.

The nearest enclosing `$try` catches it; with none, the run halts with `Status: 'failed'`.

### `$call` — ask the host to do something

```
{ "$call": { "Name": "name", "With": { field: expression }, "Into": "path" } }
```

**`$call` does not call.** The step suspends the run with `Status: 'waiting'` and a descriptor
saying what is wanted; the host does the work and hands the answer back with `Resume()`. The
engine performs no I/O and contains no `async`.

**`With` is an expression document**, so every value in it that should carry data from the state
needs a `$`:

```
{ "$call": { "Name": "Notify", "With": { "Reason": "$Delay", "Weight": "$Weight" } } }
        correct - the host receives the values

{ "$call": { "Name": "Notify", "With": { "Reason": "Delay", "Weight": "Weight" } } }
        WRONG - the host receives the literal strings "Delay" and "Weight"
```

`Into` names where the result is written and is optional.

### `$return` — stop and say what was produced

```
{ "$return": "$Charge" }
{ "$return": { "Charge": "$Charge", "When": "$$NOW" } }
```

The run comes back with `Status: 'done'` and the value in `Result`. Running off the end of
`Steps` is the same as `{ "$return": "$$ROOT" }`.


## Useful expression operators

Inside `$do`, `$return`, `$throw`, `With` and `In`:

| Expression | Meaning |
|---|---|
| `{ $add: [ a, b ] }`, `$subtract`, `$multiply`, `$divide`, `$mod` | arithmetic |
| `{ $eq: [ a, b ] }`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte` | comparison |
| `{ $and: [ a, b ] }`, `$or`, `$not` | boolean |
| `{ $concat: [ a, b ] }`, `$toLower`, `$toUpper`, `$substr` | strings |
| `{ $size: "$arr" }` | array length |
| `{ $cond: [ test, then, else ] }` | a conditional value |
| `{ $ifNull: [ a, b ] }` | `a` unless it is null, then `b` |
| `{ $year: "$d" }`, `$month`, `$dayOfMonth` | date parts |


## Worked examples

All over one invented consignment. **Read them for shape, not for field names.**

Total a distance over a list of legs, then branch on the result:

```
{
  "Name": "Rate The Route",
  "Steps": [
    { "$do": { "Mileage": 0 } },
    { "$forEach": { "In": "$Legs", "As": "Leg", "Do": [
        { "$do": { "Mileage": { "$add": [ "$Mileage", "$Leg.Distance" ] } } }
    ] } },
    { "$when": { "Check": { "Mileage": { "$gt": 300 } },
                 "Then": [ { "$do": { "Band": "long" } } ],
                 "Else": [ { "$do": { "Band": "short" } } ] } },
    { "$return": { "Mileage": "$Mileage", "Band": "$Band" } }
  ]
}
```

Count the elements meeting a test — a loop with a branch inside it:

```
{
  "Name": "Count Heavy Legs",
  "Steps": [
    { "$do": { "Heavy": 0 } },
    { "$forEach": { "In": "$Legs", "As": "Leg", "Do": [
        { "$when": { "Check": { "Leg.Fuel": { "$gt": 10 } },
                     "Then": [ { "$do": { "Heavy": { "$add": [ "$Heavy", 1 ] } } } ] } }
    ] } },
    { "$return": "$Heavy" }
  ]
}
```

Fail on purpose with a chosen code, which needs the document form of `$throw`:

```
{
  "Name": "Require A Route",
  "Steps": [
    { "$when": { "Check": { "Legs": { "$size": 0 } },
                 "Then": [ { "$throw": { "Code": "NoRoute", "Message": "no legs were given" } } ] } },
    { "$return": "ok" }
  ]
}
```

Ask the host to do something, and cope if it fails:

```
{
  "Name": "Notify The Shipper",
  "Steps": [
    { "$try": {
        "Do": [ { "$call": { "Name": "Notify",
                             "With": { "Reason": "$Delay", "Weight": "$Weight" },
                             "Into": "Receipt" } } ],
        "Catch": [ { "$do": { "Notified": false, "Why": "$Problem.Message" } } ],
        "As": "Problem" } },
    { "$return": "$$ROOT" }
  ]
}
```

Count down, which is the shape of every `$while`:

```
{
  "Name": "Clear The Queue",
  "Steps": [
    { "$while": { "Check": { "Pending": { "$gt": 0 } }, "Do": [
        { "$do": { "Pending": { "$subtract": [ "$Pending", 1 ] },
                   "Cleared": { "$add": [ "$Cleared", 1 ] } } }
    ] } },
    { "$return": "$Cleared" }
  ]
}
```
