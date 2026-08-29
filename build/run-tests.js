'use strict';

/*
	Runs the unit tests and the invariant check, and prints a report with a clear
	heading and a per-section summary for each.

	Shared by `npm test` and the `run_tests` build task so the two always run the
	same thing. `npm test` prints this output to the terminal; the build task
	captures it to tests.md and prepends the package title.

	***The invariant check is a section of the report rather than a separate
	errand.*** MongoDB has no process language, so there is no parity suite to
	stand beside the unit tests here; what takes its place is build/process-check.js,
	which drives every fixture through all eight invariants. A release which ran the
	unit tests and not that one would have measured the behavior and not the design.

	Needs no server.
*/

const path = require( 'path' );
const { spawnSync } = require( 'child_process' );

const REPO_ROOT = path.resolve( __dirname, '..' );
// Resolved rather than joined onto REPO_ROOT: under the jsonx workspace, node_modules is
// hoisted to the folder above this repo and there is no node_modules/mocha here at all.
const MOCHA_BIN = require.resolve( 'mocha/bin/mocha.js' );
const MOCHA_OPTS = [ '-u', 'bdd', '--timeout', '0', '--slow', '10' ];

const SUITES = [
	{
		label: 'Unit Tests',
		command: [ MOCHA_BIN, ...MOCHA_OPTS, 'test/Unit Tests/*.js' ],
		counted: true,
	},
	{
		label: 'Process Invariants',
		command: [ path.join( __dirname, 'process-check.js' ) ],
		counted: false,
	},
];

//---------------------------------------------------------------------
// Runs one invocation and returns its captured output and counts.
function run_suite( suite )
{
	const result = spawnSync( process.execPath, suite.command, {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	} );
	// Mocha writes the spec listing and summary to stdout; failure details
	// and stack traces go to stderr. Keep both so failures are not lost.
	const output = ( result.stdout || '' ) + ( result.stderr || '' );
	const counts = parse_counts( output );
	return {
		label: suite.label,
		counted: suite.counted,
		output: output.trim(),
		passed: result.status === 0,
		counts,
	};
}

//---------------------------------------------------------------------
// Pulls the passing / failing / pending counts out of mocha's summary line.
function parse_counts( output )
{
	const counts = { passing: 0, failing: 0, pending: 0 };
	const passing = output.match( /(\d+)\s+passing/ );
	const failing = output.match( /(\d+)\s+failing/ );
	const pending = output.match( /(\d+)\s+pending/ );
	if ( passing ) { counts.passing = parseInt( passing[ 1 ], 10 ); }
	if ( failing ) { counts.failing = parseInt( failing[ 1 ], 10 ); }
	if ( pending ) { counts.pending = parseInt( pending[ 1 ], 10 ); }
	return counts;
}

//---------------------------------------------------------------------
// Main.
function main()
{
	const results = SUITES.map( run_suite );

	// Print one markdown section per suite, each in its own code fence so
	// each run's own summary stays with its suite.
	for ( const result of results )
	{
		process.stdout.write( `\n## ${result.label}\n\n` );
		process.stdout.write( '```\n' );
		process.stdout.write( result.output );
		process.stdout.write( '\n```\n' );
	}

	// Combined summary at the end.
	let total = 0;
	let all_passed = true;
	process.stdout.write( '\n## Summary\n\n' );
	for ( const result of results )
	{
		const c = result.counts;
		if ( c.failing > 0 || !result.passed ) { all_passed = false; }
		const status = ( c.failing === 0 && result.passed ) ? 'passed' : 'FAILED';

		// A suite which reports no test count of its own is reported by its outcome
		// alone. Counting it as zero passing would read as a suite which asserted
		// nothing, which is the one thing a report here must never say by accident.
		if ( result.counted === false )
		{
			process.stdout.write( `- ${result.label}: ${status}\n` );
			continue;
		}

		total += c.passing;
		process.stdout.write( `- ${result.label}: ${c.passing} passed` );
		if ( c.failing > 0 ) { process.stdout.write( `, ${c.failing} failed` ); }
		if ( c.pending > 0 ) { process.stdout.write( `, ${c.pending} pending` ); }
		process.stdout.write( ` (${status})\n` );
	}
	process.stdout.write( `- Total: ${total} passed\n` );

	process.exit( all_passed ? 0 : 1 );
}

main();
