'use strict';

/*
	Checks that the type declaration and the ESM wrapper both describe the runtime which is
	actually running.

	***This exists because both of those files are written by hand, and both drift silently.***
	The standing decision is that jsonproc stays Javascript and ships a hand-written `.d.ts`
	rather than a generated one - so nothing regenerates when a function is added, and nothing
	complains either. A declaration nobody checks is a comment, and an ESM wrapper which has
	fallen behind is worse than a comment: `import { NewOperator }` fails at the consumer's
	build with a message about our package, and every test here still passes.

	Three rules, each mechanical:

		1. ***Every runtime member is declared.*** Loaded from src/jsonproc.js and compared
		   against the members of the JsonprocRuntime interface in types/jsonproc.d.ts.

		2. ***Every declared member exists.*** The same comparison in the other direction,
		   which is the one that catches a rename: without it a declaration keeps describing
		   the old name forever and a consumer's editor offers a function which is not there.

		3. ***Every runtime member is re-exported by src/jsonproc.mjs, and declared as a named
		   export.*** Three lists which have to agree: what the runtime has, what the wrapper
		   re-exports, and what the declaration names. This is the rule that makes writing the
		   wrapper by hand a safe thing to do.

	EXCLUDED_FROM_NAMED_EXPORTS is the one deliberate difference between the runtime and the
	other two lists, and it is named here rather than inferred. OpLog and OpError are mutable
	settings: a named ESM export binds once at load, so `import { OpLog }` would hand back the
	null it held then and go on doing so after the caller had assigned a logger. They are
	reached through the default export. See the header of src/jsonproc.mjs.

	***The jsongin member is not excluded***, because it is not the same case: an engine is
	chosen when the runtime is built rather than assigned onto a running one.

	Needs no server, and constructs nothing but the runtime.

	Usage:
		npm run types-check
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );

const REPO = LIB_PATH.resolve( __dirname, '..' );
const RUNTIME_FILE = LIB_PATH.join( REPO, 'src', 'jsonproc.js' );
const WRAPPER_FILE = LIB_PATH.join( REPO, 'src', 'jsonproc.mjs' );
const TYPES_FILE = LIB_PATH.join( REPO, 'types', 'jsonproc.d.ts' );

// Members which the runtime has and the named-export lists deliberately do not. See above.
const EXCLUDED_FROM_NAMED_EXPORTS = [ 'OpLog', 'OpError' ];


//---------------------------------------------------------------------
// Returns the runtime's member names, as the running library reports them.
function read_runtime_members()
{
	let runtime = require( RUNTIME_FILE );
	return Object.keys( runtime );
}


//---------------------------------------------------------------------
// Returns the member names declared on the JsonprocRuntime interface.
//
// The interface sits one tab in, its members two. Reading the block by indentation rather
// than by brace counting keeps this from having to understand TypeScript, which it does not
// need to do: it is comparing a list of names. A doc comment's continuation lines begin with
// a space after the tabs, so they cannot be mistaken for a member.
function read_declared_members()
{
	let text = LIB_FS.readFileSync( TYPES_FILE, 'utf8' );
	let lines = text.split( /\r?\n/ );

	let members = [];
	let inside = false;

	for ( let index = 0; index < lines.length; index++ )
	{
		let line = lines[ index ];

		if ( inside === false )
		{
			if ( /^\texport interface JsonprocRuntime\b/.test( line ) ) { inside = true; }
			continue;
		}

		// The interface's own closing brace, at one tab.
		if ( line === '\t}' ) { break; }

		// A member is an identifier at two tabs, followed by a call, a generic, or a type.
		let found = line.match( /^\t\t([A-Za-z_][A-Za-z0-9_]*)\s*[(<:]/ );
		if ( found ) { members.push( found[ 1 ] ); }
	}

	return members;
}


//---------------------------------------------------------------------
// Returns the names declared as named exports in the .d.ts, outside the interface.
function read_declared_named_exports()
{
	let text = LIB_FS.readFileSync( TYPES_FILE, 'utf8' );
	let names = [];
	let pattern = /^\texport const ([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
	let found = pattern.exec( text );
	while ( found !== null )
	{
		names.push( found[ 1 ] );
		found = pattern.exec( text );
	}
	return names;
}


//---------------------------------------------------------------------
// Returns the names re-exported by the ESM wrapper.
function read_wrapper_exports()
{
	let text = LIB_FS.readFileSync( WRAPPER_FILE, 'utf8' );
	let names = [];
	let pattern = /^export const ([A-Za-z_][A-Za-z0-9_]*)\s*=/gm;
	let found = pattern.exec( text );
	while ( found !== null )
	{
		names.push( found[ 1 ] );
		found = pattern.exec( text );
	}
	return names;
}


//---------------------------------------------------------------------
// Returns the members of ListA which are not in ListB.
function missing_from( ListA, ListB )
{
	let missing = [];
	for ( let index = 0; index < ListA.length; index++ )
	{
		if ( ListB.includes( ListA[ index ] ) === false ) { missing.push( ListA[ index ] ); }
	}
	return missing;
}


//---------------------------------------------------------------------
// Runs the three rules and returns the findings.
function Check()
{
	let runtime_members = read_runtime_members();
	let declared_members = read_declared_members();
	let declared_exports = read_declared_named_exports();
	let wrapper_exports = read_wrapper_exports();

	// What the runtime has, minus the two deliberate exclusions.
	let expected_named = missing_from( runtime_members, EXCLUDED_FROM_NAMED_EXPORTS );

	let findings = [];

	function report( Message, Names )
	{
		if ( Names.length === 0 ) { return; }
		findings.push( { Message: Message, Names: Names } );
	}

	// Rule 1 and 2: the interface and the runtime describe the same surface.
	report(
		'On the runtime but not declared in the JsonprocRuntime interface',
		missing_from( runtime_members, declared_members ) );
	report(
		'Declared in the JsonprocRuntime interface but not on the runtime',
		missing_from( declared_members, runtime_members ) );

	// Rule 3: the wrapper and the declaration's named exports both match the runtime.
	report(
		'On the runtime but not re-exported by src/jsonproc.mjs',
		missing_from( expected_named, wrapper_exports ) );
	report(
		'Re-exported by src/jsonproc.mjs but not on the runtime',
		missing_from( wrapper_exports, runtime_members ) );
	report(
		'On the runtime but not declared as a named export in the .d.ts',
		missing_from( expected_named, declared_exports ) );
	report(
		'Declared as a named export in the .d.ts but not on the runtime',
		missing_from( declared_exports, runtime_members ) );

	// The exclusions are excluded from both lists or they are not exclusions.
	report(
		'Excluded from named exports, yet re-exported by src/jsonproc.mjs',
		missing_from( EXCLUDED_FROM_NAMED_EXPORTS, missing_from( EXCLUDED_FROM_NAMED_EXPORTS, wrapper_exports ) ) );
	report(
		'Excluded from named exports, yet declared as a named export in the .d.ts',
		missing_from( EXCLUDED_FROM_NAMED_EXPORTS, missing_from( EXCLUDED_FROM_NAMED_EXPORTS, declared_exports ) ) );

	return {
		RuntimeMembers: runtime_members,
		DeclaredMembers: declared_members,
		DeclaredExports: declared_exports,
		WrapperExports: wrapper_exports,
		Excluded: EXCLUDED_FROM_NAMED_EXPORTS,
		Findings: findings,
	};
}


//---------------------------------------------------------------------
// Main.
function main()
{
	let result = Check();

	console.log( '' );
	console.log( 'Types Check' );
	console.log( '' );
	console.log( `   runtime members               : ${result.RuntimeMembers.length}` );
	console.log( `   declared on the interface     : ${result.DeclaredMembers.length}` );
	console.log( `   named exports in the .d.ts    : ${result.DeclaredExports.length}` );
	console.log( `   re-exported by jsonproc.mjs   : ${result.WrapperExports.length}` );
	console.log( `   excluded by decision          : ${result.Excluded.length} (${result.Excluded.join( ', ' )})` );
	console.log( '' );

	if ( result.Findings.length === 0 )
	{
		console.log( '   The runtime, the declaration, and the ESM wrapper agree.' );
		console.log( '' );
		return;
	}

	for ( let index = 0; index < result.Findings.length; index++ )
	{
		let finding = result.Findings[ index ];
		console.log( `   ${finding.Message}:` );
		console.log( `      ${finding.Names.join( ', ' )}` );
	}
	console.log( '' );

	process.exitCode = 1;
}


//---------------------------------------------------------------------
module.exports = {
	Check: Check,
};

if ( require.main === module ) { main(); }
