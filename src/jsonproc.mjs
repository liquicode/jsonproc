// @liquicode/jsonproc - ESM entry point.
//
// This wrapper exists so that `import { Start } from '@liquicode/jsonproc'` works. Without it
// Node reports `Named export 'Start' not found`, because cjs-module-lexer cannot see a surface
// which is assigned dynamically: every member is attached inside NewJsonproc() as
// `Runtime.Start = ...`, and a static reader has nothing to find.
//
// ***This is a wrapper and never a second build.*** It imports the CommonJS module and re-exports
// what is already there, so `require()` and `import` reach ***one*** runtime. A separate ESM
// compilation would produce two, and the step operator registry belongs to an instance - an
// operator registered through one would be invisible through the other. src/jsonproc.js carries
// the same warning about the browser globals, for the same reason.
//
// ***OpLog and OpError are deliberately absent from the named exports below.*** They are mutable
// runtime settings, assigned once at construction and set afterwards by the caller to turn
// operation logging on. A named export is bound at load time, so `import { OpLog }` would hand
// back the null it held then and go on doing so after the caller had set one. Reach them through
// the default export, where an assignment lands on the runtime:
//
//		import jsonproc from '@liquicode/jsonproc';
//		jsonproc.OpLog = function ( Message ) { console.log( Message ); };
//
// ***jsongin is exported, and that is not the same case.*** It is chosen when the runtime is
// built - `NewJsonproc( { jsongin: MyEngine } )` - rather than assigned onto a running one, so
// the binding below and the runtime's own property point at the same engine for as long as that
// runtime exists.
//
// build/types-check.js knows about the OpLog and OpError exclusion by name and fails on any
// other difference between this file, the declaration, and the running runtime.

import RUNTIME from './jsonproc.js';


//---------------------------------------------------------------------
// The runtime itself.
// Same object as `require( '@liquicode/jsonproc' )` returns.

export default RUNTIME;


//---------------------------------------------------------------------
// Runtime construction.

export const NewJsonproc = RUNTIME.NewJsonproc;


//---------------------------------------------------------------------
// The process runtime.
//
// Four functions from one run to the next. Start makes a run, Step advances it once,
// Execute runs it to completion, and Resume continues one which stopped.

export const Start = RUNTIME.Start;
export const Step = RUNTIME.Step;
export const Execute = RUNTIME.Execute;
export const Resume = RUNTIME.Resume;


//---------------------------------------------------------------------
// Operator tables and runtime state.
//
// These are objects rather than values, so the binding below and the runtime's own property
// reference the same table. A step operator registered after import is visible through either.

export const Library = RUNTIME.Library;
export const Settings = RUNTIME.Settings;
export const StepOperators = RUNTIME.StepOperators;


//---------------------------------------------------------------------
// The engine.
//
// The jsongin instance this runtime evaluates with. Every expression a step computes and every
// criteria a step tests belongs to it, so a host which holds a run usually wants it too.

export const jsongin = RUNTIME.jsongin;
