'use strict';

/*
	Checks the eight invariants of the process runtime.

	***This file was written before the first step operator***, the way build/scope-check.js
	existed before the 198 files it measured were converted. Until Start and the rest
	existed it reported the runtime as missing, which was the correct answer and the whole
	reason to write it first: the finish line is drawn before the race is run. It moved here
	with the runtime it measures, and the invariants moved unchanged.

	***The rules need no authority, which is what makes them the strongest tests here.***
	MongoDB has no process language, so there is no server to compare against and no parity
	claim to be made. What is left is what must be true of the design itself:

		1. Storage is transparent.
		   Step( P, Parse( Format( run, T ), T ) ) equals Step( P, run ),
		   for T = { TypedValues: true }. This is the load bearing claim of the whole design.
		   A run which cannot be written down and read back is not a run.

		2. Stepping is deterministic.
		   The same run stepped twice gives the same result.

		3. Execute equals repeated Step.
		   The convenience wrapper cannot be allowed to diverge from the primitive.

		4. Runs are independent.
		   Two runs stepped alternately never affect each other. This is what the variable
		   scope conversion paid two hundred files for, so it is tested rather than assumed.

		5. Step is total.
		   It always returns a run and never throws. A failure is a run with Status 'failed'.

		6. The input run is never modified.
		   Every function returns a new value.

		7. A runaway loop is failed, not hung.
		   A process which never halts is a process. Execute never coming back from
		   one would be a defect, so the budget is an invariant rather than a convenience.
		   Nothing could test this until a step operator could loop.

		8. A failure is caught only where it should be.
		   A $try catches a failure raised by running a step, and nothing else. A fault in
		   the process document must not be swallowed by that document's own error handler,
		   and a failure raised inside a Catch branch must not be caught by the Catch it was
		   raised in - which would be a loop no budget covers, since it is not one.

	***The comparison is written here rather than borrowed from the engine.*** LooseEquals has
	opinions about type coercion and Format has opinions about what JSON can hold, and rule 1
	exists precisely to check the second of those - a comparison built on Format would agree
	with itself no matter what Format lost. So deep_equals below is plain structural equality,
	and it counts a key whose value is undefined as present, because $$REMOVE is bound to
	nothing and nothing is not null.

	***That strictness has a consequence worth stating.*** A run carrying Result: undefined
	cannot survive storage: Format drops the field and Parse does not put it back. So rule 1
	requires the engine to leave Waiting, Result and Error off a run they do not apply to,
	rather than setting them undefined. The rule is not being lenient about this; the design
	is being told what shape it has to have.

	Needs no server.

	Usage:
		node build/process-check.js
		node build/process-check.js --verbose
*/

const LIB_PATH = require( 'path' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( LIB_PATH.resolve( __dirname, '..', 'src', 'jsonproc.js' ) );

// The options every storage round trip in this file uses. Named once so that rule 1 cannot
// drift from what the runtime itself is documented to use.
const STORAGE = { TypedValues: true };

// A driver which cannot finish a fixture in this many turns has found a loop, not a process.
const DRIVE_LIMIT = 100;

// The four functions this file exists to check.
const RUNTIME_FUNCTIONS = [ 'Start', 'Step', 'Execute', 'Resume' ];


//---------------------------------------------------------------------
// The fixtures.
//
// Each one is a process, an input, and the results to hand back to any $call it suspends on.
// They are chosen to reach every branch the runtime has: a straight line, both sides of a
// branch, a suspension with and without a place to put the answer, an explicit halt, a fall
// off the end, and two ways of being wrong.

const FIXTURES = [

	{
		Name: 'checkout - the worked example from the spec',
		Process: {
			Name: 'Checkout',
			Steps: [
				{ $do: { total: { $add: [ '$sub', '$tax' ] } } },
				{
					$when: {
						Check: { total: { $gt: 100 } },
						Then: [ { $do: { discount: { $multiply: [ '$total', 0.1 ] } } } ],
						Else: [ { $do: { discount: 0 } } ],
					},
				},
				{ $call: { Name: 'ChargeCard', With: { amount: { $subtract: [ '$total', '$discount' ] } }, Into: 'receipt' } },
				{ $return: '$receipt' },
			],
		},
		Input: { sub: 100, tax: 8 },
		Calls: { ChargeCard: { confirmation: 'abc123', paid: 97.2 } },
	},

	{
		Name: 'checkout - the same process down the Else branch',
		Process: null,			// filled in below, from the fixture above
		Input: { sub: 10, tax: 1 },
		Calls: { ChargeCard: { confirmation: 'def456', paid: 11 } },
	},

	{
		Name: 'a branch with no Else',
		Process: {
			Name: 'Flag',
			Steps: [
				{ $when: { Check: { n: { $gt: 5 } }, Then: [ { $do: { big: true } } ] } },
				{ $do: { seen: true } },
			],
		},
		Input: { n: 9 },
		Calls: {},
	},

	{
		Name: 'nested branches, which is what a cursor deeper than one level tests',
		Process: {
			Name: 'Nested',
			Steps: [
				{
					$when: {
						Check: { n: { $gt: 0 } },
						Then: [
							{ $do: { sign: 'positive' } },
							{
								$when: {
									Check: { n: { $gt: 100 } },
									Then: [ { $do: { size: 'large' } } ],
									Else: [ { $do: { size: 'small' } } ],
								},
							},
						],
						Else: [ { $do: { sign: 'negative' } } ],
					},
				},
				{ $return: '$$ROOT' },
			],
		},
		Input: { n: 7 },
		Calls: {},
	},

	{
		Name: 'a call whose result is not wanted',
		Process: {
			Name: 'Notify',
			Steps: [
				{ $call: { Name: 'SendMail', With: { to: '$email' } } },
				{ $do: { notified: true } },
			],
		},
		Input: { email: 'someone@example.com' },
		Calls: { SendMail: { queued: true } },
	},

	{
		Name: 'two calls, so that a resumed run is resumed again',
		Process: {
			Name: 'TwoCalls',
			Steps: [
				{ $call: { Name: 'First', With: {}, Into: 'one' } },
				{ $call: { Name: 'Second', With: { from: '$one' }, Into: 'two' } },
				{ $return: { first: '$one', second: '$two' } },
			],
		},
		Input: {},
		Calls: { First: { value: 1 }, Second: { value: 2 } },
	},

	{
		Name: 'falling off the end, which returns the state',
		Process: {
			Name: 'Total',
			Steps: [
				{ $do: { total: { $add: [ '$a', '$b' ] } } },
			],
		},
		Input: { a: 2, b: 3 },
		Calls: {},
	},

	{
		Name: 'a process with no steps at all',
		Process: { Name: 'Nothing', Steps: [] },
		Input: { a: 1 },
		Calls: {},
	},

	{
		Name: 'the values which do not survive plain JSON',
		Process: {
			Name: 'Typed',
			Steps: [
				{ $do: { when: '$$NOW', missing: '$$REMOVE' } },
				{ $do: { copied: '$when' } },
			],
		},
		Input: { pattern: /ab+c/i, nothing: undefined, at: new Date( '2020-01-01T00:00:00.000Z' ) },
		Calls: {},
	},

	{
		Name: 'a variable bound by $let inside a step',
		Process: {
			Name: 'Let',
			Steps: [
				{ $do: { doubled: { $let: { vars: { n: '$a' }, in: { $multiply: [ '$$n', 2 ] } } } } },
			],
		},
		Input: { a: 21 },
		Calls: {},
	},

	{
		Name: 'a step naming an operator which is not registered',
		Process: { Name: 'Bad', Steps: [ { $nosuchthing: 1 } ] },
		Input: { a: 1 },
		Calls: {},
	},

	{
		Name: 'a step which is not a document with one operator',
		Process: { Name: 'Worse', Steps: [ 42 ] },
		Input: { a: 1 },
		Calls: {},
	},

	{
		Name: 'a while loop which counts up',
		Process: {
			Name: 'CountUp',
			Steps: [
				{ $do: { n: 0 } },
				{ $while: { Check: { n: { $lt: 3 } }, Do: [ { $do: { n: { $add: [ '$n', 1 ] } } } ] } },
				{ $return: '$n' },
			],
		},
		Input: {},
		Calls: {},
	},

	{
		Name: 'a while loop whose check is false to begin with',
		Process: {
			Name: 'NeverRuns',
			Steps: [
				{ $while: { Check: { go: true }, Do: [ { $do: { touched: true } } ] } },
				{ $do: { after: true } },
			],
		},
		Input: { go: false },
		Calls: {},
	},

	{
		Name: 'a forEach which accumulates a total',
		Process: {
			Name: 'SumItems',
			Steps: [
				{ $do: { total: 0 } },
				{
					$forEach: {
						In: '$items',
						As: 'item',
						Index: 'i',
						Do: [ { $do: { total: { $add: [ '$total', '$item' ] } } } ],
					},
				},
				{ $return: '$$ROOT' },
			],
		},
		Input: { items: [ 1, 2, 3, 4 ] },
		Calls: {},
	},

	{
		Name: 'a forEach over an empty array, which binds nothing',
		Process: {
			Name: 'SumNothing',
			Steps: [
				{ $do: { total: 0 } },
				{ $forEach: { In: '$items', As: 'item', Do: [ { $do: { total: { $add: [ '$total', '$item' ] } } } ] } },
				{ $return: '$$ROOT' },
			],
		},
		Input: { items: [] },
		Calls: {},
	},

	{
		Name: 'a call inside a loop body, which is a run suspended mid iteration',
		Process: {
			Name: 'ChargeEach',
			Steps: [
				{ $do: { paid: [] } },
				{
					$forEach: {
						In: '$orders',
						As: 'order',
						Do: [
							{ $call: { Name: 'Charge', With: { amount: '$order' }, Into: 'receipt' } },
							{ $do: { paid: { $concatArrays: [ '$paid', [ '$receipt' ] ] } } },
						],
					},
				},
				{ $return: '$paid' },
			],
		},
		Input: { orders: [ 10, 20 ] },
		Calls: { Charge: { ok: true } },
	},

	{
		Name: 'a branch inside a loop body, which is a parent that does not repeat',
		Process: {
			Name: 'ClassifyEach',
			Steps: [
				{ $do: { big: 0, small: 0 } },
				{
					$forEach: {
						In: '$values',
						As: 'value',
						Do: [
							{
								$when: {
									Check: { value: { $gt: 10 } },
									Then: [ { $do: { big: { $add: [ '$big', 1 ] } } } ],
									Else: [ { $do: { small: { $add: [ '$small', 1 ] } } } ],
								},
							},
						],
					},
				},
				{ $return: '$$ROOT' },
			],
		},
		Input: { values: [ 5, 50, 7 ] },
		Calls: {},
	},

	{
		Name: 'a loop inside a loop, which is two repeating cursors at once',
		Process: {
			Name: 'Pairs',
			Steps: [
				{ $do: { seen: 0 } },
				{
					$forEach: {
						In: '$rows',
						As: 'row',
						Do: [
							{
								$forEach: {
									In: '$row',
									As: 'cell',
									Do: [ { $do: { seen: { $add: [ '$seen', '$cell' ] } } } ],
								},
							},
						],
					},
				},
				{ $return: '$seen' },
			],
		},
		Input: { rows: [ [ 1, 2 ], [ 3 ] ] },
		Calls: {},
	},

	{
		Name: 'a while loop with an empty body, which is a bad process',
		Process: {
			Name: 'Spin',
			Steps: [ { $while: { Check: { go: true }, Do: [] } } ],
		},
		Input: { go: true },
		Calls: {},
	},

];

// The Else fixture runs the same process as the first one. Sharing the object rather than
// copying it also means a second run of one process is among the pairs rule 4 tests.
FIXTURES[ 1 ].Process = FIXTURES[ 0 ].Process;


//---------------------------------------------------------------------
// The fixtures which do not end.
//
// ***These are kept apart from the list above rather than flagged inside it***, because every
// other rule drives a fixture until it halts and these never would. Rule 7 is the only thing
// which may run them, and it runs them through Execute, which is the only function
// with a budget to enforce.

// The fixtures which fail on purpose.
//
// ***Each one says where its failure should end up***, which is the whole of rule 8. Caught
// records whether the Catch branch ran, observed through a marker it writes rather than
// guessed at: a branch which did not run cannot have written it.

const CATCH_FIXTURES = [

	{
		Name: 'a throw inside a try, which is caught',
		Process: {
			Name: 'Caught',
			Steps: [
				{
					$try: {
						Do: [ { $throw: 'boom' } ],
						Catch: [ { $do: { caught: true } } ],
						As: 'error',
					},
				},
			],
		},
		Input: {},
		Calls: {},
		Expect: { Status: 'done', Code: null, Caught: true },
	},

	{
		Name: 'a throw with no try around it, which halts the run',
		Process: {
			Name: 'Uncaught',
			Steps: [ { $throw: 'boom' } ],
		},
		Input: {},
		Calls: {},
		Expect: { Status: 'failed', Code: 'Thrown', Caught: false },
	},

	{
		Name: 'a try whose body succeeds, which never runs its Catch',
		Process: {
			Name: 'NoFailure',
			Steps: [
				{
					$try: {
						Do: [ { $do: { ran: true } } ],
						Catch: [ { $do: { caught: true } } ],
						As: 'error',
					},
				},
			],
		},
		Input: {},
		Calls: {},
		Expect: { Status: 'done', Code: null, Caught: false },
	},

	{
		Name: 'an operator which refused, which is a failure a step raised',
		Process: {
			Name: 'BadArgument',
			Steps: [
				{
					$try: {
						Do: [ { $forEach: { In: '$n', As: 'x', Do: [ { $do: { seen: true } } ] } } ],
						Catch: [ { $do: { caught: true } } ],
						As: 'error',
					},
				},
			],
		},
		Input: { n: 7 },
		Calls: {},
		Expect: { Status: 'done', Code: null, Caught: true },
	},

	{
		Name: 'a fault in the process document, which a try must not swallow',
		Process: {
			Name: 'BadInside',
			Steps: [
				{
					$try: {
						Do: [ { $while: { Check: { go: true }, Do: [] } } ],
						Catch: [ { $do: { caught: true } } ],
						As: 'error',
					},
				},
			],
		},
		Input: { go: true },
		Calls: {},
		Expect: { Status: 'failed', Code: 'BadProcess', Caught: false },
	},

	{
		Name: 'an operator which is not registered, which a try must not swallow either',
		Process: {
			Name: 'UnknownInside',
			Steps: [
				{
					$try: {
						Do: [ { $nosuchthing: 1 } ],
						Catch: [ { $do: { caught: true } } ],
						As: 'error',
					},
				},
			],
		},
		Input: {},
		Calls: {},
		Expect: { Status: 'failed', Code: 'UnknownOperator', Caught: false },
	},

	{
		Name: 'a failure inside a Catch, which its own Catch must not catch',
		Process: {
			Name: 'CatchFails',
			Steps: [
				{
					$try: {
						Do: [ { $throw: 'first' } ],
						Catch: [ { $do: { caught: true } }, { $throw: 'second' } ],
						As: 'error',
					},
				},
			],
		},
		Input: {},
		Calls: {},
		Expect: { Status: 'failed', Code: 'Thrown', Caught: true },
	},

	{
		Name: 'a failure inside a Catch, caught by the try around it',
		Process: {
			Name: 'NestedCatch',
			Steps: [
				{
					$try: {
						Do: [
							{
								$try: {
									Do: [ { $throw: 'inner' } ],
									Catch: [ { $throw: 'from the handler' } ],
									As: 'inner_error',
								},
							},
						],
						Catch: [ { $do: { caught: true } } ],
						As: 'outer_error',
					},
				},
			],
		},
		Input: {},
		Calls: {},
		Expect: { Status: 'done', Code: null, Caught: true },
	},

	{
		Name: 'a call the host reported as failed, caught by the try around it',
		Process: {
			Name: 'CallFails',
			Steps: [
				{
					$try: {
						Do: [ { $call: { Name: 'Charge', With: {}, Into: 'receipt' } } ],
						Catch: [ { $do: { caught: true } } ],
						As: 'error',
					},
				},
			],
		},
		Input: {},
		Calls: {},
		Fail: { Charge: { Code: 'CardDeclined', Message: 'no funds' } },
		Expect: { Status: 'done', Code: null, Caught: true },
	},

	{
		Name: 'a throw inside a loop inside a try',
		Process: {
			Name: 'ThrowInLoop',
			Steps: [
				{
					$try: {
						Do: [
							{
								$forEach: {
									In: '$items', As: 'item',
									Do: [ { $when: { Check: { item: 2 }, Then: [ { $throw: 'the second one' } ] } } ],
								},
							},
						],
						Catch: [ { $do: { caught: true } } ],
						As: 'error',
					},
				},
			],
		},
		Input: { items: [ 1, 2, 3 ] },
		Calls: {},
		Expect: { Status: 'done', Code: null, Caught: true },
	},

];


const RUNAWAY_FIXTURES = [

	{
		Name: 'a while loop whose check never becomes false',
		Process: {
			Name: 'Forever',
			Steps: [
				{ $while: { Check: { go: true }, Do: [ { $do: { spins: { $add: [ '$spins', 1 ] } } } ] } },
			],
		},
		Input: { go: true, spins: 0 },
		Calls: {},
	},

	{
		Name: 'a loop whose body puts back what the check takes away',
		Process: {
			Name: 'Sisyphus',
			Steps: [
				{
					$while: {
						Check: { n: { $lt: 3 } },
						Do: [
							{ $do: { n: { $add: [ '$n', 1 ] } } },
							{ $do: { n: 0 } },
						],
					},
				},
			],
		},
		Input: { n: 0 },
		Calls: {},
	},

];


//---------------------------------------------------------------------
// Structural equality, owned by this file for the reason given in the header.
//
// A key whose value is undefined is present. Two Dates are equal when their times are, two
// RegExps when their source and flags are, and NaN equals NaN - none of which === does.
function deep_equals( Left, Right )
{
	if ( Left === Right ) { return true; }

	if ( ( typeof Left === 'number' ) && ( typeof Right === 'number' ) )
	{
		if ( Number.isNaN( Left ) && Number.isNaN( Right ) ) { return true; }
		return false;
	}

	if ( ( Left === null ) || ( Right === null ) ) { return false; }
	if ( ( typeof Left !== 'object' ) || ( typeof Right !== 'object' ) ) { return false; }

	if ( Left instanceof Date ) { return ( Right instanceof Date ) && ( Left.getTime() === Right.getTime() ); }
	if ( Right instanceof Date ) { return false; }

	if ( Left instanceof RegExp )
	{
		if ( !( Right instanceof RegExp ) ) { return false; }
		return ( Left.source === Right.source ) && ( Left.flags === Right.flags );
	}
	if ( Right instanceof RegExp ) { return false; }

	if ( Array.isArray( Left ) !== Array.isArray( Right ) ) { return false; }

	if ( Array.isArray( Left ) )
	{
		if ( Left.length !== Right.length ) { return false; }
		for ( let index = 0; index < Left.length; index++ )
		{
			if ( !deep_equals( Left[ index ], Right[ index ] ) ) { return false; }
		}
		return true;
	}

	let left_keys = Object.keys( Left ).sort();
	let right_keys = Object.keys( Right ).sort();
	if ( left_keys.length !== right_keys.length ) { return false; }
	for ( let index = 0; index < left_keys.length; index++ )
	{
		if ( left_keys[ index ] !== right_keys[ index ] ) { return false; }
	}
	for ( let index = 0; index < left_keys.length; index++ )
	{
		let key = left_keys[ index ];
		if ( !deep_equals( Left[ key ], Right[ key ] ) ) { return false; }
	}
	return true;
}


//---------------------------------------------------------------------
// A clone which keeps what deep_equals looks at, for the same reason: rule 6 cannot borrow
// the engine's SafeClone to prove the engine did not modify something.
function deep_clone( Value )
{
	if ( ( Value === null ) || ( typeof Value !== 'object' ) ) { return Value; }
	if ( Value instanceof Date ) { return new Date( Value.getTime() ); }
	if ( Value instanceof RegExp ) { return new RegExp( Value.source, Value.flags ); }

	if ( Array.isArray( Value ) )
	{
		let copy = [];
		for ( let index = 0; index < Value.length; index++ )
		{
			copy.push( deep_clone( Value[ index ] ) );
		}
		return copy;
	}

	let copy = {};
	let names = Object.keys( Value );
	for ( let index = 0; index < names.length; index++ )
	{
		copy[ names[ index ] ] = deep_clone( Value[ names[ index ] ] );
	}
	return copy;
}


//---------------------------------------------------------------------
// A short readable rendering, for a finding which has to say how two runs differed.
function describe( Value )
{
	try
	{
		let text = jsongin.Format( Value, STORAGE );
		if ( text.length > 240 ) { return text.substring( 0, 237 ) + '...'; }
		return text;
	}
	catch ( error )
	{
		return String( Value );
	}
}


//---------------------------------------------------------------------
// Whether a value is shaped like a run at all. Rule 5 says Step always returns one,
// and returning undefined would otherwise pass every comparison against itself.
function is_a_run( Value )
{
	if ( ( Value === null ) || ( typeof Value !== 'object' ) ) { return false; }
	if ( Array.isArray( Value ) ) { return false; }
	let statuses = [ 'ready', 'waiting', 'done', 'failed' ];
	if ( !statuses.includes( Value.Status ) ) { return false; }
	if ( !Array.isArray( Value.Cursor ) ) { return false; }
	return true;
}


//---------------------------------------------------------------------
function finding( Report, Rule, Fixture, Message )
{
	Report.Counts[ Rule ] = Report.Counts[ Rule ] + 1;
	Report.Findings.push( {
		Rule: Rule,
		Fixture: Fixture,
		Message: Message,
	} );
}


//---------------------------------------------------------------------
// Calls an engine function and reports a throw as a rule 5 finding rather than letting it
// end the run of this file. Returns { Ok, Value }.
function attempt( Report, Fixture, What, Call )
{
	try
	{
		let value = Call();
		if ( !is_a_run( value ) )
		{
			finding( Report, 5, Fixture, What + ' did not return a run: ' + describe( value ) );
			return { Ok: false, Value: value };
		}
		return { Ok: true, Value: value };
	}
	catch ( error )
	{
		finding( Report, 5, Fixture, What + ' threw: ' + error.message );
		return { Ok: false, Value: null };
	}
}


//---------------------------------------------------------------------
// Rules 1, 2, 5 and 6 are all about one step, so they are checked on every ready run every
// fixture produces rather than only on the first one.
function check_one_step( Report, Fixture, Process, Run )
{
	// Rule 6 - the input run is not modified.
	let before = deep_clone( Run );
	let stepped = attempt( Report, Fixture.Name, 'Step',
		function () { return jsonproc.Step( Process, Run ); } );
	if ( !deep_equals( before, Run ) )
	{
		finding( Report, 6, Fixture.Name,
			'Step modified the run it was given, at cursor ' + describe( before.Cursor ) + '.' );
	}
	if ( !stepped.Ok ) { return null; }

	// Rule 2 - stepping is deterministic.
	let again = attempt( Report, Fixture.Name, 'Step (a second time)',
		function () { return jsonproc.Step( Process, deep_clone( Run ) ); } );
	if ( again.Ok && !deep_equals( stepped.Value, again.Value ) )
	{
		finding( Report, 2, Fixture.Name,
			'the same run stepped twice gave two answers at cursor ' + describe( Run.Cursor ) + '.'
			+ '\n         first  ' + describe( stepped.Value )
			+ '\n         second ' + describe( again.Value ) );
	}

	// Rule 1 - storage is transparent.
	let restored = null;
	try
	{
		let json = jsongin.Format( Run, STORAGE );
		restored = jsongin.Parse( json, STORAGE );
	}
	catch ( error )
	{
		finding( Report, 1, Fixture.Name,
			'the run could not be written down at cursor ' + describe( Run.Cursor ) + ': ' + error.message );
		return stepped.Value;
	}
	if ( !deep_equals( Run, restored ) )
	{
		finding( Report, 1, Fixture.Name,
			'the run did not survive storage at cursor ' + describe( Run.Cursor ) + '.'
			+ '\n         wrote ' + describe( Run )
			+ '\n         read  ' + describe( restored ) );
	}
	let stepped_restored = attempt( Report, Fixture.Name, 'Step (on a stored run)',
		function () { return jsonproc.Step( Process, restored ); } );
	if ( stepped_restored.Ok && !deep_equals( stepped.Value, stepped_restored.Value ) )
	{
		finding( Report, 1, Fixture.Name,
			'a stored run stepped differently at cursor ' + describe( Run.Cursor ) + '.'
			+ '\n         live   ' + describe( stepped.Value )
			+ '\n         stored ' + describe( stepped_restored.Value ) );
	}

	return stepped.Value;
}


//---------------------------------------------------------------------
// Drives one fixture from start to halt, checking the one step rules at every ready run and
// handing back a canned result at every suspension.
//
// CheckSteps is off for the runs rules 3 and 4 build, which only want the destination.
function drive( Report, Fixture, CheckSteps, From )
{
	let process_document = Fixture.Process;

	// ***Rule 4 hands in the run to start from rather than letting this make one.*** Two
	// calls of Start are two readings of the clock, so the runs they produce differ in
	// $$NOW by a millisecond, and comparing those would report the measurement rather than
	// the thing being measured.
	let run = From;
	if ( typeof run === 'undefined' )
	{
		let started = attempt( Report, Fixture.Name, 'Start',
			function () { return jsonproc.Start( process_document, Fixture.Input ); } );
		if ( !started.Ok ) { return null; }
		run = started.Value;
	}
	let turns = 0;
	while ( turns < DRIVE_LIMIT )
	{
		turns++;
		if ( run.Status === 'ready' )
		{
			if ( CheckSteps )
			{
				let next = check_one_step( Report, Fixture, process_document, run );
				if ( next === null ) { return run; }
				run = next;
				continue;
			}
			let held = run;
			let stepped = attempt( Report, Fixture.Name, 'Step',
				function () { return jsonproc.Step( process_document, held ); } );
			if ( !stepped.Ok ) { return run; }
			run = stepped.Value;
			continue;
		}
		if ( run.Status === 'waiting' )
		{
			let waiting_name = null;
			if ( ( run.Waiting !== null ) && ( typeof run.Waiting === 'object' ) ) { waiting_name = run.Waiting.Name; }
			let result = deep_clone( Fixture.Calls[ waiting_name ] );

			// ***A fixture may say that the host's call failed rather than succeeded.***
			// Resume takes the failure in a fourth parameter, so the path which turns
			// a host failure into a run is reachable from here and is driven like any other.
			let failure = null;
			if ( ( Fixture.Fail !== null ) && ( typeof Fixture.Fail === 'object' ) )
			{
				if ( typeof Fixture.Fail[ waiting_name ] !== 'undefined' ) { failure = Fixture.Fail[ waiting_name ]; }
			}

			let before = deep_clone( run );
			let held = run;
			let resumed = attempt( Report, Fixture.Name, 'Resume',
				function ()
				{
					if ( failure !== null ) { return jsonproc.Resume( process_document, held, undefined, failure ); }
					return jsonproc.Resume( process_document, held, result );
				} );
			if ( !deep_equals( before, held ) )
			{
				finding( Report, 6, Fixture.Name,
					'Resume modified the run it was given, waiting on ' + waiting_name + '.' );
			}
			if ( !resumed.Ok ) { return run; }
			run = resumed.Value;
			continue;
		}
		break;
	}

	if ( turns >= DRIVE_LIMIT )
	{
		finding( Report, 3, Fixture.Name, 'the fixture did not halt within ' + DRIVE_LIMIT + ' turns.' );
	}
	return run;
}


//---------------------------------------------------------------------
// Rule 3 - Execute equals repeated Step.
//
// Both stop at the first suspension, so this compares the two ways of getting there rather
// than the whole fixture. A fixture which suspends on its first step still compares that.
function check_execute( Report, Fixture )
{
	let process_document = Fixture.Process;
	let started = attempt( Report, Fixture.Name, 'Start',
		function () { return jsonproc.Start( process_document, Fixture.Input ); } );
	if ( !started.Ok ) { return; }

	let looped = deep_clone( started.Value );
	let turns = 0;
	while ( ( looped.Status === 'ready' ) && ( turns < DRIVE_LIMIT ) )
	{
		turns++;
		let held = looped;
		let stepped = attempt( Report, Fixture.Name, 'Step',
			function () { return jsonproc.Step( process_document, held ); } );
		if ( !stepped.Ok ) { return; }
		looped = stepped.Value;
	}

	let executed = attempt( Report, Fixture.Name, 'Execute',
		function () { return jsonproc.Execute( process_document, deep_clone( started.Value ) ); } );
	if ( !executed.Ok ) { return; }

	if ( !deep_equals( looped, executed.Value ) )
	{
		finding( Report, 3, Fixture.Name,
			'Execute and ' + turns + ' calls of Step disagreed.'
			+ '\n         stepped  ' + describe( looped )
			+ '\n         executed ' + describe( executed.Value ) );
	}
}


//---------------------------------------------------------------------
// Rule 4 - runs are independent.
//
// Two fixtures are driven to their halt separately, then driven again with their turns
// interleaved. Anything the engine holds between calls shows up as a difference here.
function check_independence( Report, Left, Right )
{
	let label = Left.Name + '  ||  ' + Right.Name;

	let states = [
		{ Fixture: Left, Run: null, Done: false },
		{ Fixture: Right, Run: null, Done: false },
	];
	for ( let index = 0; index < states.length; index++ )
	{
		let fixture = states[ index ].Fixture;
		let started = attempt( Report, label, 'Start',
			function () { return jsonproc.Start( fixture.Process, fixture.Input ); } );
		if ( !started.Ok ) { return; }
		states[ index ].Run = started.Value;
	}

	// Each run is driven alone from the very run it is driven from when interleaved.
	let alone_left = drive( Report, Left, false, deep_clone( states[ 0 ].Run ) );
	let alone_right = drive( Report, Right, false, deep_clone( states[ 1 ].Run ) );
	if ( ( alone_left === null ) || ( alone_right === null ) ) { return; }

	let turns = 0;
	while ( turns < ( DRIVE_LIMIT * 2 ) )
	{
		turns++;
		let moved = false;
		for ( let index = 0; index < states.length; index++ )
		{
			let state = states[ index ];
			if ( state.Done ) { continue; }
			let fixture = state.Fixture;
			let run = state.Run;

			if ( run.Status === 'ready' )
			{
				let stepped = attempt( Report, label, 'Step',
					function () { return jsonproc.Step( fixture.Process, run ); } );
				if ( !stepped.Ok ) { return; }
				state.Run = stepped.Value;
				moved = true;
				continue;
			}
			if ( run.Status === 'waiting' )
			{
				let waiting_name = null;
				if ( ( run.Waiting !== null ) && ( typeof run.Waiting === 'object' ) ) { waiting_name = run.Waiting.Name; }
				let result = deep_clone( fixture.Calls[ waiting_name ] );
				let resumed = attempt( Report, label, 'Resume',
					function () { return jsonproc.Resume( fixture.Process, run, result ); } );
				if ( !resumed.Ok ) { return; }
				state.Run = resumed.Value;
				moved = true;
				continue;
			}
			state.Done = true;
		}
		if ( !moved ) { break; }
	}

	if ( !deep_equals( alone_left, states[ 0 ].Run ) )
	{
		finding( Report, 4, label,
			Left.Name + ' finished differently when another run was interleaved with it.'
			+ '\n         alone       ' + describe( alone_left )
			+ '\n         interleaved ' + describe( states[ 0 ].Run ) );
	}
	if ( !deep_equals( alone_right, states[ 1 ].Run ) )
	{
		finding( Report, 4, label,
			Right.Name + ' finished differently when another run was interleaved with it.'
			+ '\n         alone       ' + describe( alone_right )
			+ '\n         interleaved ' + describe( states[ 1 ].Run ) );
	}
}


//---------------------------------------------------------------------
// Rule 8 - a failure is caught only where it should be.
//
// ***This rule is a line, not a feature.*** Catching is easy to build and easy to build too
// widely: a $try which swallowed a misspelled operator name would turn every typo in a
// process into a silently handled error, and a Catch which caught its own failure would spin
// where no budget is watching. So each fixture says where its failure should end up, and the
// three answers - caught, halted, and halted despite a handler being right there - are checked
// apart from one another.
function check_catching( Report, Fixture )
{
	let run = drive( Report, Fixture, false );
	if ( run === null ) { return; }

	let expected = Fixture.Expect;

	if ( run.Status !== expected.Status )
	{
		finding( Report, 8, Fixture.Name,
			'the run ended ' + run.Status + ' rather than ' + expected.Status + '.'
			+ '\n         ' + describe( run ) );
		return;
	}

	let code = null;
	if ( ( run.Error !== null ) && ( typeof run.Error === 'object' ) ) { code = run.Error.Code; }
	if ( code !== expected.Code )
	{
		finding( Report, 8, Fixture.Name,
			'the run failed with [' + code + '] rather than [' + expected.Code + '].' );
	}

	// The marker a Catch branch writes. A branch which did not run cannot have written it, so
	// this reads whether the handler ran rather than inferring it from the outcome.
	let caught = ( run.State.caught === true );
	if ( caught !== expected.Caught )
	{
		let said = expected.Caught ? 'the Catch branch did not run, and should have' : 'the Catch branch ran, and should not have';
		finding( Report, 8, Fixture.Name, said + '.' );
	}
}


//---------------------------------------------------------------------
// Rule 7 - a runaway loop is failed, not hung.
//
// ***The narrow claim is the checkable one.*** Whether a given process halts is not something
// this file can decide, so it does not try. What it checks is that a process which plainly
// cannot halt comes back at all, comes back failed, and says which limit it hit.
//
// ***A caller's limit is checked alongside the default***, because a default which works and
// an override which is quietly ignored look identical from the outside.
function check_budget( Report, Fixture )
{
	let process_document = Fixture.Process;
	let started = attempt( Report, Fixture.Name, 'Start',
		function () { return jsonproc.Start( process_document, Fixture.Input ); } );
	if ( !started.Ok ) { return; }

	const LIMITS = [ null, 25 ];
	for ( let index = 0; index < LIMITS.length; index++ )
	{
		let limit = LIMITS[ index ];
		let named = ( limit === null ) ? 'the default' : ( 'MaxSteps ' + limit );

		let executed = attempt( Report, Fixture.Name, 'Execute',
			function ()
			{
				if ( limit === null ) { return jsonproc.Execute( process_document, deep_clone( started.Value ) ); }
				return jsonproc.Execute( process_document, deep_clone( started.Value ), limit );
			} );
		if ( !executed.Ok ) { continue; }

		let run = executed.Value;
		if ( run.Status !== 'failed' )
		{
			finding( Report, 7, Fixture.Name,
				'a loop which cannot end came back with Status [' + run.Status + '] rather than failed, at ' + named + '.' );
			continue;
		}

		let code = null;
		if ( ( run.Error !== null ) && ( typeof run.Error === 'object' ) ) { code = run.Error.Code; }
		if ( code !== 'StepLimitExceeded' )
		{
			finding( Report, 7, Fixture.Name,
				'a loop which cannot end failed with [' + code + '] rather than StepLimitExceeded, at ' + named + '.' );
		}
	}
}


//---------------------------------------------------------------------
function Check()
{
	let report = {
		Counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 },
		Findings: [],
		Missing: [],
		Fixtures: FIXTURES.length + CATCH_FIXTURES.length + RUNAWAY_FIXTURES.length,
	};

	for ( let index = 0; index < RUNTIME_FUNCTIONS.length; index++ )
	{
		let name = RUNTIME_FUNCTIONS[ index ];
		if ( typeof jsonproc[ name ] !== 'function' ) { report.Missing.push( name ); }
	}
	if ( report.Missing.length > 0 ) { return report; }

	for ( let index = 0; index < FIXTURES.length; index++ )
	{
		drive( report, FIXTURES[ index ], true );
		check_execute( report, FIXTURES[ index ] );
	}

	// Every fixture is paired with the one after it, and the last with the first, so that
	// each one is interleaved with something unlike itself without running N squared pairs.
	for ( let index = 0; index < FIXTURES.length; index++ )
	{
		let other = FIXTURES[ ( index + 1 ) % FIXTURES.length ];
		check_independence( report, FIXTURES[ index ], other );
	}

	// ***The catch fixtures answer to the first six rules as well.*** A caught failure
	// produces an ordinary run, so it has to be storable, deterministic, and independent like
	// any other - which is the claim most worth checking and the one rule 8 does not make.
	for ( let index = 0; index < CATCH_FIXTURES.length; index++ )
	{
		drive( report, CATCH_FIXTURES[ index ], true );
		check_execute( report, CATCH_FIXTURES[ index ] );
		check_catching( report, CATCH_FIXTURES[ index ] );
	}

	for ( let index = 0; index < RUNAWAY_FIXTURES.length; index++ )
	{
		check_budget( report, RUNAWAY_FIXTURES[ index ] );
	}

	return report;
}


//---------------------------------------------------------------------
const RULE_NAMES = {
	1: 'storage is transparent',
	2: 'stepping is deterministic',
	3: 'Execute equals repeated Step',
	4: 'runs are independent',
	5: 'Step is total',
	6: 'the input run is not modified',
	7: 'a runaway loop is failed, not hung',
	8: 'a failure is caught only where it should be',
};


//---------------------------------------------------------------------
function main()
{
	let verbose = process.argv.includes( '--verbose' );
	let result = Check();

	console.log( '' );
	console.log( 'Process Runtime Invariants' );
	console.log( '' );

	if ( result.Missing.length > 0 )
	{
		console.log( '   The runtime is not built yet. Missing: ' + result.Missing.join( ', ' ) );
		console.log( '' );
		console.log( '   This file was written first on purpose. Nothing below it runs until it is.' );
		console.log( '' );
		process.exitCode = 1;
		return;
	}

	console.log( '   ' + result.Fixtures + ' fixtures' );
	console.log( '' );
	let rules = Object.keys( result.Counts );
	for ( let index = 0; index < rules.length; index++ )
	{
		let rule = rules[ index ];
		let name = rule + '. ' + RULE_NAMES[ rule ];
		console.log( '   ' + name.padEnd( 36 ) + String( result.Counts[ rule ] ).padStart( 5 ) );
	}
	console.log( '' );

	if ( result.Findings.length === 0 )
	{
		console.log( '   Every invariant holds.' );
		console.log( '' );
		return;
	}

	let shown = verbose ? result.Findings.length : Math.min( result.Findings.length, 15 );
	for ( let index = 0; index < shown; index++ )
	{
		let item = result.Findings[ index ];
		console.log( '   rule ' + item.Rule + ' - ' + item.Fixture );
		console.log( '      ' + item.Message );
	}
	if ( shown < result.Findings.length )
	{
		console.log( '' );
		console.log( '   ' + ( result.Findings.length - shown ) + ' more. Run with --verbose to list them all.' );
	}
	console.log( '' );

	process.exitCode = 1;
}


//---------------------------------------------------------------------
module.exports = {
	Check: Check,
	FIXTURES: FIXTURES,
	CATCH_FIXTURES: CATCH_FIXTURES,
	RUNAWAY_FIXTURES: RUNAWAY_FIXTURES,
	DeepEquals: deep_equals,
};

if ( require.main === module ) { main(); }
