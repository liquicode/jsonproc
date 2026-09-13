# @liquicode/jsonproc


# NodeJS Usage


## Install

```bash
npm install --save @liquicode/jsonproc
```

This also installs its one dependency, [`@liquicode/jsongin`](http://jsongin.liquicode.com).


## Require

The module exports a ready-to-use ***runtime***, not a function to call:

```js
const jsonproc = require( '@liquicode/jsonproc' );

console.log( jsonproc.Library.name + ', v' + jsonproc.Library.version );
```

This runtime uses jsongin's default engine and has logging turned off.
For most uses, it is all you need.


## Import as an ES Module

Both `import` forms work:

```mjs
import jsonproc from '@liquicode/jsonproc';
import { Start, Step, Execute, Resume } from '@liquicode/jsonproc';
```

`require()` and `import` give you the ***same*** runtime, so a step operator you add through one
  is available through the other.

Every member of the runtime is a named export except `OpLog` and `OpError`.
Set those on the default export instead, so the runtime sees the change:

```mjs
import jsonproc from '@liquicode/jsonproc';
jsonproc.OpLog = function ( Message ) { console.log( Message ); };
```


## TypeScript

Type declarations are included in the package, in `types/`, so TypeScript projects and editors
  know the runtime's functions without installing anything else.
`jsonproc` itself is written in Javascript.


## Create a Runtime with Settings

To choose settings, call `NewJsonproc( Settings )`:

```js
let Settings = { jsongin: null, OpLog: null, OpError: null };

const jsonproc = require( '@liquicode/jsonproc' ).NewJsonproc( Settings );
```

Each runtime has its own settings and its own step operators, so you can have more than one.

> The module export is a runtime, not a function, so
  `require( '@liquicode/jsonproc' )( Settings )` does not work. Use `NewJsonproc( Settings )`.


## Settings

```js
// docs-check: skip - the shape of the settings object.
let Settings = {
	jsongin: null, // The jsongin engine to use. null uses jsongin's default engine.
	OpLog: null, // A function, such as console.log, to receive explanations.
	OpError: null, // A function, such as console.error, to receive errors.
}
```

All three default to `null`.


## Running Against Your Own Engine

If you added operators to a jsongin engine of your own, give that engine to the runtime so that
  processes can use them:

```js
const jsongin = require( '@liquicode/jsongin' ).NewJsongin();
const jsonproc = require( '@liquicode/jsonproc' ).NewJsonproc( { jsongin: jsongin } );

jsonproc.jsongin === jsongin
```


## What a Runtime Has

Besides the functions in the [Library Guide](./Library-Guide.md), a runtime has these fields:

| **Field**         | **Description**                                                       |
|-------------------|------------------------------------------------------------------------|
| `Library`         | The library's `name`, `url` and `version`.                            |
| `Settings`        | The settings the runtime was made with.                               |
| `NewJsonproc`     | The factory method, so any runtime can make another.                  |
| `jsongin`         | The jsongin engine the runtime uses.                                  |
| `StepOperators`   | The step operators, by name.                                          |
| `OpLog`, `OpError`| The logging functions, or `null`.                                     |

`StepOperators` is a plain object, so you can add step operators of your own.
See [Operator Authoring](./Operator-Authoring.md).


## See Also

- [Browser Usage](./Usage-Browser.md)
- [Library Guide](./Library-Guide.md)
- [The Process Runtime](./jsonproc/Process.md)
