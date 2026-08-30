# @liquicode/jsonproc


# NodeJS Usage


## Install jsonproc with NPM

```bash
npm install --save @liquicode/jsonproc
```

`jsonproc` has one runtime dependency, and it is
  [`@liquicode/jsongin`](http://jsongin.liquicode.com).
Every expression a step computes and every criteria a step tests is evaluated by that engine,
  so installing `jsonproc` installs it too.


## Include jsonproc in your NodeJS Project

The module's default export is a ready-to-use runtime ***instance***, not a factory:

```js
const jsonproc = require( '@liquicode/jsonproc' );

console.log( jsonproc.Library.name + ', v' + jsonproc.Library.version );
```

This instance runs against jsongin's own default engine and has logging turned off.
For most uses it is all you need.


## Import jsonproc as an ES Module

The library is CommonJS, and an ESM wrapper ships beside it so that both import forms work:

```mjs
import jsonproc from '@liquicode/jsonproc';
import { Start, Step, Execute, Resume } from '@liquicode/jsonproc';
```

***There is one runtime, whichever way you load it.***
`require()` and `import` reach the same object, because the wrapper re-exports the CommonJS
  module rather than being a second build of it.
That matters because the step operator registry belongs to an instance, so an operator
  registered through one handle has to be visible through the other.
A separate ESM build would have given you two runtimes which disagreed.

***`OpLog` and `OpError` are not named exports.***
They are mutable settings, and a named ESM export binds once at load time — `import { OpLog }`
  would hand back the `null` it held then and go on handing it back after you had assigned a
  logger.
Reach them through the default export, where an assignment lands on the runtime:

```mjs
import jsonproc from '@liquicode/jsonproc';
jsonproc.OpLog = function ( Message ) { console.log( Message ); };
```

Everything else on the runtime is a named export, `jsongin` included — an engine is chosen when
  the runtime is built rather than assigned onto a running one.


## Use jsonproc from TypeScript

A hand-written declaration ships in `types/`, so an editor completes the runtime's surface and a
  TypeScript project compiles against it with no `@types` package to install.

***TypeScript is supported and never required.***
There is no TypeScript in the source and no compiler in the build.
`npm run types-check` compares the declaration and the ESM wrapper against the runtime which is
  actually running, so neither one can quietly fall behind it.


## Create an Instance with Custom Settings

To configure the runtime, call the `NewJsonproc( Settings )` factory method:

```js
let Settings = { jsongin: null, OpLog: null, OpError: null };

const jsonproc = require( '@liquicode/jsonproc' ).NewJsonproc( Settings );
```

Each instance carries its own settings and its own step operator registry, so you can hold more
  than one at a time.

> ***Note*** : the module export is an instance, so
  `require( '@liquicode/jsonproc' )( Settings )` does not work. Use `NewJsonproc( Settings )`.


## Customize jsonproc Behavior with Settings

```js
// docs-check: skip - the shape of the settings object.
let Settings = {
	jsongin: null, // The jsongin engine to evaluate against. Null takes jsongin's default instance.
	OpLog: null, // A function to call (such as console.log) to output OpLog messages.
	OpError: null, // A function to call (such as console.error) to output OpError messages.
}
```

All three default to `null`.


## Running Against Your Own Engine

***The engine is a setting because an engine carries its operator registries.***
A host which registered an expression operator of its own holds an engine which is not the
  default one, and a process has to be able to compute with it:

```js
const jsongin = require( '@liquicode/jsongin' ).NewJsongin( { OpLog: console.log } );
const jsonproc = require( '@liquicode/jsonproc' ).NewJsonproc( { jsongin: jsongin } );

jsonproc.jsongin === jsongin
```

Naming no engine takes jsongin's default instance, which is what a host that registered nothing
  wants.


## What the Runtime Exposes

Beyond the four functions described in the [Library Guide](./Library-Guide.md), a runtime
  instance carries a few fields worth knowing about:

| **Field**         | **Description**                                                       |
|-------------------|------------------------------------------------------------------------|
| `Library`         | The library's `name`, `url`, and `version`.                           |
| `Settings`        | The settings this instance was created with.                          |
| `NewJsonproc`     | The factory method, so any instance can make another.                 |
| `jsongin`         | The engine this runtime evaluates against.                            |
| `StepOperators`   | The registered step operators, keyed by name.                         |

The registry is a plain object, which is what makes it possible to add step operators of your
  own. See [Operator Authoring](./Operator-Authoring.md).


## See Also

- [Browser Usage](./Usage-Browser.md)
- [Library Guide](./Library-Guide.md)
- [The Process Runtime](./jsonproc/Process.md)
