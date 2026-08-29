'use strict';

// The module's export is a ready to use runtime instance.
// It is held here as well so that the browser block at the bottom can publish this same
// instance rather than building a second one.
const DEFAULT_RUNTIME = NewJsonproc();

module.exports = DEFAULT_RUNTIME;

function NewJsonproc( RuntimeSettings = {} )
{
	// jsonproc does not evaluate anything itself. Every expression a step computes, every
	// criteria a step tests, and every scope a step is evaluated against belongs to jsongin,
	// and this runtime only decides which step runs next and what a run looks like afterwards.
	//
	// ***The jsongin engine is a setting rather than a fixed import.*** An engine carries its
	// operator registries, so a host which registered an operator of its own has an engine
	// which is not the default one, and a process must be able to run against it. Naming no
	// engine takes jsongin's default instance, which is what a host that registered nothing
	// wants.
	if ( typeof RuntimeSettings.jsongin === 'undefined' ) { RuntimeSettings.jsongin = null; }
	if ( typeof RuntimeSettings.OpLog === 'undefined' ) { RuntimeSettings.OpLog = null; }
	if ( typeof RuntimeSettings.OpError === 'undefined' ) { RuntimeSettings.OpError = null; }

	let Runtime = {};


	//---------------------------------------------------------------------
	// Factory Method
	Runtime.NewJsonproc = NewJsonproc;

	//---------------------------------------------------------------------
	// Library
	let _package = require( '../package.json' );
	Runtime.Library = {
		name: _package.name,
		url: _package.homepage,
		version: _package.version,
	};

	//---------------------------------------------------------------------
	// Settings
	Runtime.Settings = RuntimeSettings;

	//---------------------------------------------------------------------
	// The Engine
	//
	// Assigned before the operator registry and the runtime below, both of which read it.
	// It is named on the runtime rather than kept private because a host which holds a run
	// usually holds documents too, and there is no reason to make it find the engine twice.
	Runtime.jsongin = RuntimeSettings.jsongin;
	if ( Runtime.jsongin === null ) { Runtime.jsongin = require( '@liquicode/jsongin' ); }

	//---------------------------------------------------------------------
	// OpLog
	//
	// Assigned before the operator registry as well: a step operator reads Runtime.OpError
	// when it turns a throw into a failed run.
	Runtime.OpLog = RuntimeSettings.OpLog;
	Runtime.OpError = RuntimeSettings.OpError;

	//---------------------------------------------------------------------
	// Step Operators
	//
	// The registry which is not MongoDB's. MongoDB has no process language, so these are
	// jsonproc's own the way $eqx and $noop are jsongin's, and jsongin's api-coverage does
	// not count them - counting them would change what its percentage means.
	Runtime.StepOperators = {

		$do: require( './Operators/Step/do' )( Runtime ),
		$when: require( './Operators/Step/when' )( Runtime ),
		$while: require( './Operators/Step/while' )( Runtime ),
		$forEach: require( './Operators/Step/forEach' )( Runtime ),
		$try: require( './Operators/Step/try' )( Runtime ),
		$throw: require( './Operators/Step/throw' )( Runtime ),
		$call: require( './Operators/Step/call' )( Runtime ),
		$return: require( './Operators/Step/return' )( Runtime ),

	};

	//---------------------------------------------------------------------
	// The Process Runtime
	//
	// Four functions from one run to the next. They are named on the runtime rather than
	// grouped under an object because a run is a value the caller holds - there is nothing
	// here to be a member of.
	let process_runtime = require( './jsonproc/Process' )( Runtime );
	Runtime.Start = process_runtime.Start;
	Runtime.Step = process_runtime.Step;
	Runtime.Execute = process_runtime.Execute;
	Runtime.Resume = process_runtime.Resume;


	// Return the runtime.
	return Runtime;
};

// Browser compatability.
//
// The bundle publishes this module's export as window.jsonproc, and this publishes the same
// instance as window.liquicode.jsonproc, so the two globals are interchangeable.
// Building a second runtime here instead would make them two different instances, and that
// matters because the step operator registry belongs to an instance.
//
// ***jsongin is external to this bundle***, not built into it. The browser build resolves
// '@liquicode/jsongin' to the window.jsongin global, so a page loads jsongin.min.js first and
// both libraries then share one engine. Bundling a copy would have given the page two engines,
// and an operator registered through one would be invisible to the other.
if ( typeof window !== 'undefined' )
{
	if ( typeof window.liquicode === 'undefined' ) { window.liquicode = {}; }
	window.liquicode.jsonproc = DEFAULT_RUNTIME;
	window.liquicode.NewJsonproc = NewJsonproc;
}
