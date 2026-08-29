'use strict';

module.exports = function ( jsonproc )
{
	// The jsongin engine this runtime evaluates against. It is aliased once, here, so that
	// every line below reads the way it did while the runtime lived inside jsongin itself.
	const jsongin = jsonproc.jsongin;


	//---------------------------------------------------------------------
	// The process runtime: four functions from one run to the next.
	//
	// ***The engine holds nothing between calls.*** A process is a document describing work,
	// a run is a value describing how far that work has got, and every function here takes
	// both and returns a new run. That is what makes two runs independent of each other, what
	// lets a run be written down and picked up an hour later somewhere else, and what keeps
	// the whole thing testable without a clock or a server.
	//
	// ***The process is passed alongside the run, never carried inside it.*** A run carries
	// only the process's Name, as a stamp: it cannot rebuild the process and is not meant to.
	// It is there so that stepping a stored run against the wrong process fails at the first
	// call instead of computing a wrong answer quietly.
	//
	// ***Nothing here throws.*** A failure is a run with Status 'failed' and an Error on it,
	// because the point of the design is that a run is a value which can be stored and looked
	// at later - and an error which vanished into a throw could not be. An operator still
	// throws, the way every other operator in this engine does; the throw is caught here and
	// turned into a failed run at the cursor which raised it.


	// The step budget Execute() uses when the caller does not name one. A process which
	// can loop can loop forever, and a function which never returns is worse than one which
	// fails. Step() needs no budget: one step cannot loop.
	const DEFAULT_MAX_STEPS = 1000;

	// The failures a $try may not catch.
	//
	// ***This list is the line between an error and a bug.*** A process which mishandled a
	// declined card is doing its job; a process with a misspelled operator name in it is
	// broken, and a $try which swallowed that would turn every typo into a silently handled
	// error. The step budget is on the list for a different reason: it is the caller's
	// protection against a process which does not end, and a process must not be able to
	// defeat it from the inside.
	//
	// ***An operator may not raise one of these on purpose either.*** $throw refuses to name
	// a code on this list, so the line cannot be crossed from a process document.
	const UNCATCHABLE = [ 'BadProcess', 'BadRun', 'NoSuchStep', 'UnknownOperator', 'ResumeNotWaiting', 'StepLimitExceeded' ];


	// A cursor pairs an index with a branch name, so it is always an odd length: [ 1 ] is a
	// top level step and [ 1, 'Then', 0 ] is the first step of a branch of it. A loop writes
	// its branch element as [ 'Do', 3 ] instead, pairing the name with the iteration it is
	// running, which keeps the length odd and keeps the whole position storable. This guards
	// the walk below against a cursor which has been edited by hand into something else.
	const CURSOR_LIMIT = 1000;


	//---------------------------------------------------------------------
	// Builds a run. The optional fields are left off rather than set to undefined.
	//
	// ***That is a storage requirement, not a tidiness preference.*** Format drops a field
	// whose value is undefined and Parse does not put it back, so a run carrying
	// `Result: undefined` would not survive being written down - and a run which cannot be
	// written down and read back is not a run. build/process-check.js rule 1 is what says so.
	function new_run( Name, Status, Cursor, State, Scope, Extra )
	{
		let run = {
			Process: Name,
			Status: Status,
			Cursor: Cursor,
			State: State,
			Scope: Scope,
		};
		if ( jsongin.ShortType( Extra ) === 'o' )
		{
			let keys = Object.keys( Extra );
			for ( let index = 0; index < keys.length; index++ )
			{
				let key = keys[ index ];
				if ( typeof Extra[ key ] === 'undefined' ) { continue; }
				run[ key ] = Extra[ key ];
			}
		}
		return run;
	}


	//---------------------------------------------------------------------
	// The Reentry field of the run a walk produced, or nothing at all.
	//
	// ***Left off rather than set to null***, for the reason given at new_run: an optional
	// field which is present and empty is one more thing storage has to carry back exactly,
	// and process-check rule 1 is unforgiving about it.
	function reentry_extra( Reentry )
	{
		if ( Reentry === null ) { return null; }
		return { Reentry: Reentry };
	}


	//---------------------------------------------------------------------
	// The name a process is known by, or null for a process which has none.
	function process_name( Process )
	{
		if ( jsongin.ShortType( Process ) !== 'o' ) { return null; }
		if ( jsongin.ShortType( Process.Name ) !== 's' ) { return null; }
		return Process.Name;
	}


	//---------------------------------------------------------------------
	// A fresh pipeline scope in its stored form.
	//
	// ***$$NOW is read once, here, and carried by the run from then on.*** A resumed run keeps
	// the instant it started with, the way every document of one aggregation pipeline sees the
	// same one. This is why the date had to survive storage before any of this could be built.
	function new_scope()
	{
		return jsongin.Scope.ToJSON( jsongin.Scope.NewPipeline() );
	}


	//---------------------------------------------------------------------
	// The frame chain a step is evaluated against. A run whose scope is missing or unreadable
	// gets a fresh one rather than failing, because a scope is a convenience the run carries
	// and not the run itself.
	function scope_of( Run )
	{
		try
		{
			let scope = jsongin.Scope.FromJSON( Run.Scope );
			if ( scope === null ) { return jsongin.Scope.NewPipeline(); }
			return scope;
		}
		catch ( error )
		{
			return jsongin.Scope.NewPipeline();
		}
	}


	//---------------------------------------------------------------------
	// Builds a failed run, defensively: this is reached with runs which are malformed, so
	// nothing on the one passed in can be assumed to be there.
	function failed_run( Process, Run, Code, Message, Cursor )
	{
		let name = process_name( Process );
		let cursor = Cursor;
		if ( jsongin.ShortType( cursor ) !== 'a' ) { cursor = []; }

		let state = {};
		let scope = null;
		if ( jsongin.ShortType( Run ) === 'o' )
		{
			if ( jsongin.ShortType( Run.State ) === 'o' ) { state = Run.State; }
			if ( jsongin.ShortType( Run.Scope ) === 'o' ) { scope = Run.Scope; }
		}
		if ( scope === null ) { scope = new_scope(); }

		return new_run( name, 'failed', cursor, state, scope, {
			Error: {
				Code: Code,
				Message: Message,
				Cursor: cursor,
			},
		} );
	}


	//---------------------------------------------------------------------
	// Whether a process is a process at all. Returns a message, or null when it is.
	function check_process( Process )
	{
		if ( jsongin.ShortType( Process ) !== 'o' ) { return `A process must be a document.`; }
		if ( jsongin.ShortType( Process.Steps ) !== 'a' ) { return `A process must have a Steps array.`; }
		return null;
	}


	//---------------------------------------------------------------------
	// Whether a run is shaped as a run, and whether it belongs to this process.
	function check_run( Process, Run )
	{
		if ( jsongin.ShortType( Run ) !== 'o' ) { return `A run must be a document.`; }

		const STATUSES = [ 'ready', 'waiting', 'done', 'failed' ];
		if ( STATUSES.includes( Run.Status ) === false )
		{
			return `A run's Status must be one of [${STATUSES.join( ', ' )}], not [${Run.Status}].`;
		}
		if ( jsongin.ShortType( Run.Cursor ) !== 'a' ) { return `A run's Cursor must be an array.`; }
		if ( jsongin.ShortType( Run.State ) !== 'o' ) { return `A run's State must be a document.`; }

		// The stamp. A process with no name stamps null, and matches only a process with none.
		let expected = process_name( Process );
		let actual = null;
		if ( jsongin.ShortType( Run.Process ) === 's' ) { actual = Run.Process; }
		if ( actual !== expected )
		{
			return `This run belongs to process [${actual}], not to [${expected}].`;
		}

		return null;
	}


	//---------------------------------------------------------------------
	// The list of steps a cursor prefix addresses. The prefix is the cursor without its last
	// index, so it is always an even number of elements: pairs of ( step index, branch name ).
	//
	// Returns null when the prefix addresses nothing, which the callers report as NoSuchStep.
	function list_at( Process, Prefix )
	{
		let list = Process.Steps;
		let index = 0;
		while ( index < Prefix.length )
		{
			let position = Prefix[ index ];
			if ( jsongin.ShortType( position ) !== 'n' ) { return null; }

			let step = list[ position ];
			if ( jsongin.ShortType( step ) !== 'o' ) { return null; }

			let keys = Object.keys( step );
			if ( keys.length !== 1 ) { return null; }

			let args = step[ keys[ 0 ] ];
			if ( jsongin.ShortType( args ) !== 'o' ) { return null; }

			// ***A branch element is a name, or a name paired with an iteration.*** A loop
			// writes [ 'Do', 3 ] where every other step writes 'Do', because the iteration is
			// control state and the cursor is where a run keeps its control state. Holding it
			// here rather than in the State is what lets a loop own no field of the document
			// it is working on.
			let branch = Prefix[ index + 1 ];
			let name = branch;
			if ( jsongin.ShortType( branch ) === 'a' ) { name = branch[ 0 ]; }
			if ( jsongin.ShortType( name ) !== 's' ) { return null; }

			let next = args[ name ];
			if ( jsongin.ShortType( next ) !== 'a' ) { return null; }

			list = next;
			index = index + 2;
		}
		return list;
	}


	//---------------------------------------------------------------------
	// Reads the step a cursor addresses.
	//
	// Three answers rather than two: the step, or 'the cursor is past the end of its branch'
	// which is how a branch finishes, or an error. Only the third is a failure.
	function locate( Process, Cursor )
	{
		if ( Cursor.length === 0 ) { return { Over: true }; }
		if ( ( Cursor.length % 2 ) === 0 )
		{
			return { Error: `A cursor must end with a step index.` };
		}

		let last = Cursor.length - 1;
		let list = list_at( Process, Cursor.slice( 0, last ) );
		if ( list === null ) { return { Error: `The cursor addresses a branch which is not there.` }; }

		let position = Cursor[ last ];
		if ( jsongin.ShortType( position ) !== 'n' ) { return { Error: `A cursor position must be a number.` }; }
		if ( position < 0 ) { return { Error: `A cursor position must not be negative.` }; }
		if ( position >= list.length ) { return { PastEnd: true }; }

		return { Step: list[ position ] };
	}


	//---------------------------------------------------------------------
	// The registered operator of the step a cursor addresses, with its arguments, or null.
	//
	// Written once because three walks want it: the one which asks whether a step repeats, the
	// one which asks whether a step catches, and nothing else may go reading Process.Steps by
	// hand and get the shape checks subtly different.
	function operator_at( Process, Cursor )
	{
		let located = locate( Process, Cursor );
		if ( typeof located.Step === 'undefined' ) { return null; }

		let step = located.Step;
		if ( jsongin.ShortType( step ) !== 'o' ) { return null; }

		let keys = Object.keys( step );
		if ( keys.length !== 1 ) { return null; }

		let operator = jsonproc.StepOperators[ keys[ 0 ] ];
		if ( typeof operator === 'undefined' ) { return null; }

		let args = step[ keys[ 0 ] ];
		if ( jsongin.ShortType( args ) !== 'o' ) { return null; }

		return { Name: keys[ 0 ], Operator: operator, Args: args };
	}


	//---------------------------------------------------------------------
	// Whether the step a cursor addresses asks for control back when a branch of it ends.
	//
	// ***This one declaration is the whole of what makes a loop possible.*** Every other step
	// is finished with once one of its branches ends, so the walk below steps past it; a step
	// operator which declares Repeats is asked again instead, and decides for itself whether
	// to run its branch once more or to move on. The loop lives in the cursor, which is what
	// keeps a run stopped in the middle of one storable - there is no call stack to write down.
	function repeats_at( Process, Cursor )
	{
		let found = operator_at( Process, Cursor );
		if ( found === null ) { return false; }
		return ( found.Operator.Repeats === true );
	}


	//---------------------------------------------------------------------
	// The position of the next step, and the branch element it climbed out of to get there.
	//
	// Increment the last element. If that runs past the end of the branch, drop it along with
	// the branch name above it and increment the element before. Repeat. An empty cursor
	// means the process is over.
	//
	// ***The exception is a step which repeats***, which the walk lands on rather than steps
	// past. The branch element it climbed out of comes back as Reentry, because a loop has to
	// know which iteration just ended and that element is where the iteration is kept.
	//
	// ***Reentry cannot be worked out from the position afterward***, which is why the two are
	// returned together. A cursor of [ 1 ] is the second top level step whether the walk
	// arrived there from [ 0 ] or climbed out of [ 1, [ 'Do', 3 ], 2 ]. Only the walk can tell
	// those apart, and a loop has to.
	function advance( Process, Cursor )
	{
		const OVER = { Cursor: [], Reentry: null };

		let cursor = Cursor.slice();
		let turns = 0;
		while ( ( cursor.length > 0 ) && ( turns < CURSOR_LIMIT ) )
		{
			turns++;
			let last = cursor.length - 1;
			if ( jsongin.ShortType( cursor[ last ] ) !== 'n' ) { return OVER; }
			cursor[ last ] = cursor[ last ] + 1;

			let list = list_at( Process, cursor.slice( 0, last ) );
			if ( list === null ) { return OVER; }
			if ( cursor[ last ] < list.length ) { return { Cursor: cursor, Reentry: null }; }

			cursor.pop();								// the index
			let branch = null;
			if ( cursor.length > 0 ) { branch = cursor.pop(); }	// the branch name it sat in

			if ( ( cursor.length > 0 ) && ( repeats_at( Process, cursor ) === true ) )
			{
				return { Cursor: cursor, Reentry: branch };
			}
		}
		return OVER;
	}


	//---------------------------------------------------------------------
	// Whether the step a cursor addresses will catch a failure raised inside the named branch.
	//
	// An operator declares Catches: { From: 'Try', Into: 'Catch' } - the branch it guards, and
	// the branch it handles with - the same way a loop declares Repeats. Naming them in the
	// operator rather than here is what keeps this file from knowing that $try exists.
	//
	// ***A handler branch which is not there does not catch.*** The operator refuses that
	// process itself; this returns null so that the search walks on out to a handler which
	// can, rather than jumping into nothing.
	function catches_at( Process, Cursor, Branch )
	{
		let found = operator_at( Process, Cursor );
		if ( found === null ) { return null; }

		let catches = found.Operator.Catches;
		if ( jsongin.ShortType( catches ) !== 'o' ) { return null; }
		if ( catches.From !== Branch ) { return null; }

		let handler = found.Args[ catches.Into ];
		if ( jsongin.ShortType( handler ) !== 'a' ) { return null; }
		if ( handler.length === 0 ) { return null; }

		return { Into: catches.Into, Args: found.Args };
	}


	//---------------------------------------------------------------------
	// The nearest enclosing step which will catch a failure raised at this cursor, or null.
	//
	// ***The cursor is the search.*** It already records every step the run is inside and
	// which branch of each it entered, so finding a handler is a walk outward through it
	// rather than a stack the run would have to carry, store, and restore. This is the same
	// property which lets a run stopped inside a loop be written down.
	//
	// ***A step entered through its own handler branch is skipped***, because catches_at asks
	// which branch the failure came out of. That one question is what stops a failure raised
	// inside a Catch from being handed back to the Catch it was raised in - which would be a
	// loop that no budget is watching, since it is not a loop.
	function handler_for( Process, Cursor )
	{
		if ( jsongin.ShortType( Cursor ) !== 'a' ) { return null; }

		// The ancestors sit at every second position below the last, each one followed by the
		// branch of it the run descended into.
		let position = Cursor.length - 3;
		while ( position >= 0 )
		{
			let at = Cursor.slice( 0, position + 1 );
			let branch = Cursor[ position + 1 ];
			let name = branch;
			if ( jsongin.ShortType( branch ) === 'a' ) { name = branch[ 0 ]; }

			let found = catches_at( Process, at, name );
			if ( found !== null ) { return { Cursor: at, Into: found.Into, Args: found.Args }; }

			position = position - 2;
		}
		return null;
	}


	//---------------------------------------------------------------------
	// A failure raised by running a step: handed to an enclosing handler if there is one, and
	// turned into a failed run if there is not.
	//
	// ***Only the failures which come from running a step come through here.*** A fault in the
	// process document calls failed_run directly, and so does anything on the UNCATCHABLE
	// list. The two guards are deliberately separate: the call site knows whether a failure
	// came from running something, and the list knows which codes are nobody's to handle.
	//
	// ***The Catch branch sees the state as the failure left it.*** A step which changed the
	// state and then failed did change it, and pretending otherwise would mean holding a copy
	// of the state at every step in case one is needed - which is a transaction, and is not
	// what this is.
	function raise( Process, Run, Code, Message, Cursor )
	{
		if ( UNCATCHABLE.includes( Code ) === true ) { return failed_run( Process, Run, Code, Message, Cursor ); }

		let handler = handler_for( Process, Cursor );
		if ( handler === null ) { return failed_run( Process, Run, Code, Message, Cursor ); }

		let state = {};
		let scope = null;
		if ( jsongin.ShortType( Run ) === 'o' )
		{
			if ( jsongin.ShortType( Run.State ) === 'o' ) { state = jsongin.SafeClone( Run.State ); }
			if ( jsongin.ShortType( Run.Scope ) === 'o' ) { scope = Run.Scope; }
		}
		if ( scope === null ) { scope = new_scope(); }

		// The error is written into the state, at the field the handler named, for the reason
		// a loop writes its element there: a $when inside the handler is a query, and a query
		// cannot see a variable. An operator which named no field catches without one.
		if ( jsongin.ShortType( handler.Args.As ) === 's' )
		{
			jsongin.SetValue( state, handler.Args.As, {
				Code: Code,
				Message: Message,
				Cursor: Cursor,
			} );
		}

		let entered = handler.Cursor.concat( [ handler.Into, 0 ] );
		return new_run( process_name( Process ), 'ready', entered, state, scope, null );
	}


	//---------------------------------------------------------------------
	// Begins a run.
	//
	// The Input document becomes the State, cloned, so that the caller's document is not the
	// one the process writes to.
	function Start( Process, Input )
	{
		try
		{
			let complaint = check_process( Process );
			if ( complaint !== null ) { return failed_run( null, null, 'BadProcess', complaint, [] ); }

			let state = {};
			let st_input = jsongin.ShortType( Input );
			if ( ( st_input === 'o' ) )
			{
				state = jsongin.SafeClone( Input );
			}
			else if ( ( st_input !== 'u' ) && ( st_input !== 'l' ) )
			{
				return failed_run( Process, null, 'BadRun', `The Input parameter must be a document, not [${st_input}].`, [] );
			}

			return new_run( process_name( Process ), 'ready', [ 0 ], state, new_scope(), null );
		}
		catch ( error )
		{
			if ( jsonproc.OpError ) { jsonproc.OpError( 'Start: ' + error.message ); }
			return failed_run( Process, null, 'StepFailed', error.message, [] );
		}
	}


	//---------------------------------------------------------------------
	// Runs one step.
	//
	// ***Stepping a halted run is a no-op rather than an error***, which is what lets Execute()
	// below be a plain loop. A copy is returned rather than the run itself, so that no caller
	// ever holds two names for one value.
	function Step( Process, Run )
	{
		try
		{
			let complaint = check_process( Process );
			if ( complaint !== null ) { return failed_run( null, Run, 'BadProcess', complaint, [] ); }

			complaint = check_run( Process, Run );
			if ( complaint !== null ) { return failed_run( Process, Run, 'BadRun', complaint, [] ); }

			if ( Run.Status !== 'ready' ) { return jsongin.SafeClone( Run ); }

			let cursor = Run.Cursor;
			let located = locate( Process, cursor );

			// The branch element a loop climbed out of to arrive here, carried by the run
			// since the step which produced it. A run which is not re-entering a loop has no
			// such field at all.
			let reentry = null;
			if ( jsongin.ShortType( Run.Reentry ) === 'a' ) { reentry = Run.Reentry; }

			// A cursor past the end of its branch is not an error, it is how a branch ends.
			// Walking out of it here rather than when the branch was entered is what keeps an
			// empty branch, an empty process, and a process which simply ran out of steps all
			// one case.
			let turns = 0;
			while ( located.PastEnd === true )
			{
				turns++;
				if ( turns > CURSOR_LIMIT ) { return failed_run( Process, Run, 'NoSuchStep', `The cursor could not be advanced.`, cursor ); }
				let moved = advance( Process, cursor );
				cursor = moved.Cursor;
				reentry = moved.Reentry;
				located = locate( Process, cursor );
			}

			if ( typeof located.Error !== 'undefined' )
			{
				return failed_run( Process, Run, 'NoSuchStep', located.Error, cursor );
			}

			// Running off the end of the top level Steps is the same as { $return: '$$ROOT' }.
			// A process which computes and never says so still hands back the work it did.
			if ( located.Over === true )
			{
				return new_run( Run.Process, 'done', [], Run.State, Run.Scope, { Result: jsongin.SafeClone( Run.State ) } );
			}

			let step = located.Step;
			if ( jsongin.ShortType( step ) !== 'o' )
			{
				return failed_run( Process, Run, 'BadProcess', `A step must be a document, not [${jsongin.ShortType( step )}].`, cursor );
			}

			let keys = Object.keys( step );
			if ( keys.length !== 1 )
			{
				return failed_run( Process, Run, 'BadProcess', `A step must have exactly one key, found [${keys.length}].`, cursor );
			}

			let key = keys[ 0 ];
			let operator = jsonproc.StepOperators[ key ];
			if ( typeof operator === 'undefined' )
			{
				return failed_run( Process, Run, 'UnknownOperator', `Unrecognized step operator [${key}].`, cursor );
			}

			// The same argument type check the aggregation and query dispatchers make.
			if ( jsongin.ShortType( operator.ArgTypes ) === 's' )
			{
				let argument_type = jsongin.ShortType( step[ key ] );
				if ( operator.ArgTypes.includes( argument_type ) === false )
				{
					return raise( Process, Run, 'StepFailed',
						`Step operator [${key}] does not take an argument of type [${argument_type}]. It takes [${operator.ArgTypes}].`, cursor );
				}
			}

			let outcome = null;
			try
			{
				outcome = operator.Step( Run.State, step[ key ], scope_of( Run ), { Reentry: reentry } );
			}
			catch ( error )
			{
				// ***An operator may name the code it failed with.*** A step operator which
				// finds the process malformed rather than the state wrong says BadProcess,
				// and the caller is told which of the two it is looking at. An operator which
				// throws an ordinary Error, as all four of the first ones do, still gets
				// StepFailed - so this reads a property rather than requiring one.
				let code = 'StepFailed';
				if ( jsongin.ShortType( error.Code ) === 's' ) { code = error.Code; }
				return raise( Process, Run, code, error.message, cursor );
			}

			if ( jsongin.ShortType( outcome ) !== 'o' )
			{
				return raise( Process, Run, 'StepFailed', `Step operator [${key}] did not report an outcome.`, cursor );
			}

			// 'next' - the state may have changed, and the cursor moves on.
			if ( outcome.Action === 'next' )
			{
				let state = Run.State;
				if ( jsongin.ShortType( outcome.State ) === 'o' ) { state = outcome.State; }
				let moved = advance( Process, cursor );
				return new_run( Run.Process, 'ready', moved.Cursor, state, Run.Scope, reentry_extra( moved.Reentry ) );
			}

			// 'enter' - the cursor descends into a branch of this step.
			if ( outcome.Action === 'enter' )
			{
				if ( jsongin.ShortType( outcome.Branch ) !== 's' )
				{
					return raise( Process, Run, 'StepFailed', `Step operator [${key}] named no branch to enter.`, cursor );
				}
				// ***A loop pairs the branch name with the iteration it is entering***, so
				// that climbing back out later says which one just finished. Every other
				// operator enters a plain name and the pair form never appears.
				let element = outcome.Branch;
				if ( jsongin.ShortType( outcome.Iteration ) === 'n' ) { element = [ outcome.Branch, outcome.Iteration ]; }

				// ***Entering may change the state***, which is how a loop binds the element
				// it is about to work on. Nothing else needs this, and nothing else uses it.
				let state = Run.State;
				if ( jsongin.ShortType( outcome.State ) === 'o' ) { state = outcome.State; }

				let entered = cursor.concat( [ element, 0 ] );
				return new_run( Run.Process, 'ready', entered, state, Run.Scope, null );
			}

			// 'wait' - the cursor stays where it is until Resume() moves it.
			if ( outcome.Action === 'wait' )
			{
				if ( jsongin.ShortType( outcome.Waiting ) !== 'o' )
				{
					return raise( Process, Run, 'StepFailed', `Step operator [${key}] suspended without saying what for.`, cursor );
				}
				return new_run( Run.Process, 'waiting', cursor, Run.State, Run.Scope, { Waiting: outcome.Waiting } );
			}

			// 'halt' - the run is over. A halt with nothing to report carries no Result, which
			// is what keeps the run storable.
			if ( outcome.Action === 'halt' )
			{
				return new_run( Run.Process, 'done', [], Run.State, Run.Scope, { Result: outcome.Result } );
			}

			return raise( Process, Run, 'StepFailed', `Step operator [${key}] reported an unrecognized action [${outcome.Action}].`, cursor );
		}
		catch ( error )
		{
			// Reached only by a defect in this file. It is still a run, because the contract
			// is that this function always returns one.
			if ( jsonproc.OpError ) { jsonproc.OpError( 'Step: ' + error.message ); }
			return failed_run( Process, Run, 'StepFailed', error.message, [] );
		}
	}


	//---------------------------------------------------------------------
	// Steps until the run is no longer ready: it finished, failed, or suspended on a call.
	//
	// ***The budget is not optional.*** MaxSteps defaults to 1000 and a caller who expects
	// more says so. This is the only function here which can loop, so it is the only one
	// which needs one.
	function Execute( Process, Run, MaxSteps )
	{
		try
		{
			let limit = DEFAULT_MAX_STEPS;
			if ( jsongin.ShortType( MaxSteps ) === 'n' ) { limit = Math.floor( MaxSteps ); }

			let run = Run;
			let steps = 0;
			while ( jsongin.ShortType( run ) === 'o' )
			{
				if ( run.Status !== 'ready' ) { break; }
				if ( steps >= limit )
				{
					return failed_run( Process, run, 'StepLimitExceeded', `The run did not halt within ${limit} steps.`, run.Cursor );
				}
				run = Step( Process, run );
				steps++;
			}

			// A run which was never ready is still returned as a new value.
			if ( run === Run ) { return Step( Process, Run ); }
			return run;
		}
		catch ( error )
		{
			if ( jsonproc.OpError ) { jsonproc.OpError( 'Execute: ' + error.message ); }
			return failed_run( Process, Run, 'StepFailed', error.message, [] );
		}
	}


	//---------------------------------------------------------------------
	// Hands a waiting run the result of the call it suspended on, or the failure of it.
	//
	// Resume( Process, Run, Result )                  the call succeeded
	// Resume( Process, Run, undefined, Error )        the call failed
	//
	// ***The fourth parameter keeps the host's failure path inside the four named functions***
	// rather than adding a fifth for it.
	function Resume( Process, Run, Result, Error_ )
	{
		try
		{
			let complaint = check_process( Process );
			if ( complaint !== null ) { return failed_run( null, Run, 'BadProcess', complaint, [] ); }

			complaint = check_run( Process, Run );
			if ( complaint !== null ) { return failed_run( Process, Run, 'BadRun', complaint, [] ); }

			if ( Run.Status !== 'waiting' )
			{
				return failed_run( Process, Run, 'ResumeNotWaiting', `A run with Status [${Run.Status}] is not waiting for a result.`, Run.Cursor );
			}

			// The host reporting a failure of the call it was asked to make.
			if ( typeof Error_ !== 'undefined' )
			{
				let code = 'StepFailed';
				let message = '';
				let st_error = jsongin.ShortType( Error_ );
				if ( st_error === 'o' )
				{
					if ( jsongin.ShortType( Error_.Code ) === 's' ) { code = Error_.Code; }
					if ( jsongin.ShortType( Error_.Message ) === 's' ) { message = Error_.Message; }
				}
				else if ( st_error === 'e' ) { message = Error_.message; }
				else { message = String( Error_ ); }

				// ***A failed call is the failure a $try most exists for***, so it takes the
				// same route a step's own failure takes rather than halting on the spot.
				return raise( Process, Run, code, message, Run.Cursor );
			}

			let state = jsongin.SafeClone( Run.State );

			let into = null;
			if ( jsongin.ShortType( Run.Waiting ) === 'o' )
			{
				if ( jsongin.ShortType( Run.Waiting.Into ) === 's' ) { into = Run.Waiting.Into; }
			}
			if ( into !== null )
			{
				// ***A result of nothing removes the field***, the same rule the $addFields
				// stage follows for an expression which produces nothing. Writing undefined
				// into the state would make a run which cannot be written down.
				if ( typeof Result === 'undefined' ) { jsongin.DeleteValue( state, into ); }
				else { jsongin.SetValue( state, into, jsongin.SafeClone( Result ) ); }
			}

			// A call which was the last step of a loop body climbs back out to the loop, so
			// this walk can find a re-entry exactly as the one in Step() can.
			let moved = advance( Process, Run.Cursor );
			return new_run( Run.Process, 'ready', moved.Cursor, state, Run.Scope, reentry_extra( moved.Reentry ) );
		}
		catch ( error )
		{
			if ( jsonproc.OpError ) { jsonproc.OpError( 'Resume: ' + error.message ); }
			return failed_run( Process, Run, 'StepFailed', error.message, [] );
		}
	}


	//---------------------------------------------------------------------
	return {
		Start: Start,
		Step: Step,
		Execute: Execute,
		Resume: Resume,
	};
};
