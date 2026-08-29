'use strict';

const assert = require( 'assert' );
const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '../../src/jsonproc' );

/*
	The process runtime.

	***These are unit tests and not parity tests, because MongoDB has no process language.***
	There is no server to compare a run against and no parity claim to be made. What an
	expression computes and what a query matches are still MongoDB's, and are still measured in
	the parity suites; only the stepping, the branching, the suspension and the run value
	itself are jsonproc's, and this file is where they are held to account.

	The six invariants of the design - storage is transparent, stepping is deterministic,
	Execute equals repeated Step, runs are independent, Step is total, the input is never
	modified - are checked separately and much more broadly by build/process-check.js, which
	drives twelve processes and applies all six at every step of each. A handful of them are
	restated here as ordinary tests so that a reader of this file can see what they say.

	See src/jsonproc/Process.js and src/Operators/Step/.
*/

const STORAGE = { TypedValues: true };


//---------------------------------------------------------------------
// The worked example from the guide, used by enough tests to be worth naming once.
function checkout_process()
{
	return {
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
	};
}


describe( '100) Process Runtime Tests', () =>
{


	//---------------------------------------------------------------------
	describe( 'Starting a Run', () =>
	{

		it( 'should begin ready, at the first step', () =>
		{
			let process_document = { Name: 'Simple', Steps: [ { $do: { a: 1 } } ] };
			let run = jsonproc.Start( process_document, { b: 2 } );
			assert.strictEqual( run.Status, 'ready' );
			assert.deepStrictEqual( run.Cursor, [ 0 ] );
			assert.deepStrictEqual( run.State, { b: 2 } );
		} );

		it( 'should carry the name of the process it belongs to', () =>
		{
			let run = jsonproc.Start( { Name: 'Simple', Steps: [] }, {} );
			assert.strictEqual( run.Process, 'Simple' );
		} );

		it( 'should stamp null for a process with no name', () =>
		{
			let run = jsonproc.Start( { Steps: [] }, {} );
			assert.strictEqual( run.Process, null );
		} );

		it( 'should clone the input rather than work on it', () =>
		{
			let input = { a: 1 };
			let run = jsonproc.Start( { Name: 'X', Steps: [] }, input );
			run.State.a = 999;
			assert.strictEqual( input.a, 1 );
		} );

		it( 'should take no input as an empty state', () =>
		{
			let run = jsonproc.Start( { Name: 'X', Steps: [] } );
			assert.deepStrictEqual( run.State, {} );
		} );

		it( 'should carry a scope holding the instant the run began', () =>
		{
			let run = jsonproc.Start( { Name: 'X', Steps: [] }, {} );
			assert.ok( run.Scope.Variables.NOW instanceof Date );
		} );

		it( 'should fail a process which is not a document with Steps', () =>
		{
			let run = jsonproc.Start( 'nope', {} );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );

			run = jsonproc.Start( { Name: 'X' }, {} );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should fail an input which is not a document', () =>
		{
			let run = jsonproc.Start( { Name: 'X', Steps: [] }, 42 );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadRun' );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $do Step', () =>
	{

		it( 'should compute a field from the state', () =>
		{
			let process_document = { Name: 'Add', Steps: [ { $do: { total: { $add: [ '$a', '$b' ] } } } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, { a: 2, b: 3 } ) );
			assert.deepStrictEqual( run.State, { a: 2, b: 3, total: 5 } );
		} );

		it( 'should store a literal', () =>
		{
			let process_document = { Name: 'Set', Steps: [ { $do: { flag: true } } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.State, { flag: true } );
		} );

		it( 'should remove a field whose expression produces nothing', () =>
		{
			let process_document = { Name: 'Drop', Steps: [ { $do: { a: '$$REMOVE' } } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, { a: 1, b: 2 } ) );
			assert.deepStrictEqual( run.State, { b: 2 } );
		} );

		it( 'should evaluate every field against the state as it was at the top of the step', () =>
		{
			// The aggregation stage rule: fields added by a stage are not visible to the other
			// expressions within the same stage.
			let process_document = { Name: 'Same', Steps: [ { $do: { x: 1, y: '$x' } } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.State, { x: 1 } );
		} );

		it( 'should see the variables the run carries', () =>
		{
			let process_document = { Name: 'Now', Steps: [ { $do: { at: '$$NOW' } } ] };
			let start = jsonproc.Start( process_document, {} );
			let run = jsonproc.Step( process_document, start );
			assert.strictEqual( run.State.at.getTime(), start.Scope.Variables.NOW.getTime() );
		} );

		it( 'should advance to the next step', () =>
		{
			let process_document = { Name: 'Two', Steps: [ { $do: { a: 1 } }, { $do: { b: 2 } } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.Cursor, [ 1 ] );
			assert.strictEqual( run.Status, 'ready' );
		} );

		it( 'should refuse an argument which is not a document', () =>
		{
			let process_document = { Name: 'Bad', Steps: [ { $do: 42 } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepFailed' );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $when Step', () =>
	{

		it( 'should enter the Then branch when the check matches', () =>
		{
			let process_document = {
				Name: 'Branch',
				Steps: [ { $when: { Check: { n: { $gt: 5 } }, Then: [ { $do: { big: true } } ], Else: [ { $do: { big: false } } ] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 9 } ) );
			assert.strictEqual( run.State.big, true );
		} );

		it( 'should enter the Else branch when the check does not match', () =>
		{
			let process_document = {
				Name: 'Branch',
				Steps: [ { $when: { Check: { n: { $gt: 5 } }, Then: [ { $do: { big: true } } ], Else: [ { $do: { big: false } } ] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 1 } ) );
			assert.strictEqual( run.State.big, false );
		} );

		it( 'should push the branch onto the cursor', () =>
		{
			let process_document = {
				Name: 'Branch',
				Steps: [ { $when: { Check: { n: { $gt: 5 } }, Then: [ { $do: { big: true } } ] } } ],
			};
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, { n: 9 } ) );
			assert.deepStrictEqual( run.Cursor, [ 0, 'Then', 0 ] );
		} );

		it( 'should advance past the step when a false check has no Else', () =>
		{
			let process_document = {
				Name: 'NoElse',
				Steps: [
					{ $when: { Check: { n: { $gt: 5 } }, Then: [ { $do: { big: true } } ] } },
					{ $do: { seen: true } },
				],
			};
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, { n: 1 } ) );
			assert.deepStrictEqual( run.Cursor, [ 1 ] );
		} );

		it( 'should advance past a branch which is present but empty', () =>
		{
			let process_document = {
				Name: 'Empty',
				Steps: [
					{ $when: { Check: { n: { $gt: 5 } }, Then: [] } },
					{ $do: { seen: true } },
				],
			};
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, { n: 9 } ) );
			assert.deepStrictEqual( run.Cursor, [ 1 ] );
		} );

		it( 'should leave a branch and carry on with the step after it', () =>
		{
			let process_document = {
				Name: 'After',
				Steps: [
					{ $when: { Check: { n: { $gt: 5 } }, Then: [ { $do: { big: true } } ] } },
					{ $do: { seen: true } },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 9 } ) );
			assert.deepStrictEqual( run.State, { n: 9, big: true, seen: true } );
		} );

		it( 'should nest, and unwind two levels at once', () =>
		{
			let process_document = {
				Name: 'Nested',
				Steps: [
					{
						$when: {
							Check: { n: { $gt: 0 } },
							Then: [
								{ $do: { sign: 'positive' } },
								{ $when: { Check: { n: { $gt: 100 } }, Then: [ { $do: { size: 'large' } } ], Else: [ { $do: { size: 'small' } } ] } },
							],
						},
					},
					{ $do: { done: true } },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 7 } ) );
			assert.deepStrictEqual( run.State, { n: 7, sign: 'positive', size: 'small', done: true } );
		} );

		it( 'should take a query holding $expr', () =>
		{
			let process_document = {
				Name: 'Expr',
				Steps: [ { $when: { Check: { $expr: { $gt: [ '$a', '$b' ] } }, Then: [ { $do: { bigger: 'a' } } ], Else: [ { $do: { bigger: 'b' } } ] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { a: 9, b: 2 } ) );
			assert.strictEqual( run.State.bigger, 'a' );
		} );

		it( 'should refuse a Check which is not a query document', () =>
		{
			let process_document = { Name: 'Bad', Steps: [ { $when: { Then: [] } } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepFailed' );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $while Step', () =>
	{

		function counting_process()
		{
			return {
				Name: 'CountUp',
				Steps: [
					{ $while: { Check: { n: { $lt: 3 } }, Do: [ { $do: { n: { $add: [ '$n', 1 ] } } } ] } },
					{ $do: { after: true } },
				],
			};
		}

		it( 'should run the body until the check stops matching', () =>
		{
			let process_document = counting_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 0 } ) );
			assert.strictEqual( run.State.n, 3 );
			assert.strictEqual( run.State.after, true );
		} );

		it( 'should run the body no times at all when the check is false to begin with', () =>
		{
			let process_document = counting_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 5 } ) );
			assert.strictEqual( run.State.n, 5 );
			assert.strictEqual( run.State.after, true );
		} );

		it( 'should push the body onto the cursor', () =>
		{
			let process_document = counting_process();
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, { n: 0 } ) );
			assert.deepStrictEqual( run.Cursor, [ 0, 'Do', 0 ] );
		} );

		// ***This is the difference between a loop and a branch, stated as a test.*** Every
		// other step is left behind once a branch of it ends; a $while is arrived at again.
		it( 'should return to the loop step when the body ends, rather than past it', () =>
		{
			let process_document = counting_process();
			let run = jsonproc.Start( process_document, { n: 0 } );
			run = jsonproc.Step( process_document, run );		// enter the body
			run = jsonproc.Step( process_document, run );		// run the body's one step
			assert.deepStrictEqual( run.Cursor, [ 0 ] );
		} );

		it( 'should carry on with the step after the loop once the check fails', () =>
		{
			let process_document = counting_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 3 } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.State.after, true );
		} );

		it( 'should refuse an empty body as a bad process', () =>
		{
			let process_document = { Name: 'Spin', Steps: [ { $while: { Check: { go: true }, Do: [] } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { go: true } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse a missing body as a bad process', () =>
		{
			let process_document = { Name: 'NoBody', Steps: [ { $while: { Check: { go: true } } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { go: true } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse a missing check as a bad process', () =>
		{
			let process_document = { Name: 'NoCheck', Steps: [ { $while: { Do: [ { $do: { a: 1 } } ] } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		function runaway_process()
		{
			return {
				Name: 'Forever',
				Steps: [
					{ $while: { Check: { go: true }, Do: [ { $do: { spins: { $add: [ '$spins', 1 ] } } } ] } },
				],
			};
		}

		it( 'should be stopped by the step budget when the check never fails', () =>
		{
			let process_document = runaway_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { go: true, spins: 0 } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepLimitExceeded' );
		} );

		it( 'should be stopped at the budget the caller named', () =>
		{
			let process_document = runaway_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { go: true, spins: 0 } ), 25 );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepLimitExceeded' );
			assert.ok( run.Error.Message.includes( '25' ) );
		} );

		// ***ProcessStep needs no budget, because one step cannot loop.*** A caller stepping
		// a runaway loop by hand is not doing anything wrong and is never stopped.
		it( 'should never be stopped by a budget when stepped one step at a time', () =>
		{
			let process_document = runaway_process();
			let run = jsonproc.Start( process_document, { go: true, spins: 0 } );
			for ( let index = 0; index < 50; index++ )
			{
				run = jsonproc.Step( process_document, run );
				assert.strictEqual( run.Status, 'ready' );
			}
			assert.strictEqual( run.State.spins, 25 );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $forEach Step', () =>
	{

		function summing_process()
		{
			return {
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
				],
			};
		}

		it( 'should run the body once for each element', () =>
		{
			let process_document = summing_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1, 2, 3, 4 ] } ) );
			assert.strictEqual( run.State.total, 10 );
		} );

		it( 'should write each element to the field named by As', () =>
		{
			let process_document = {
				Name: 'Collect',
				Steps: [
					{ $do: { seen: [] } },
					{ $forEach: { In: '$items', As: 'item', Do: [ { $do: { seen: { $concatArrays: [ '$seen', [ '$item' ] ] } } } ] } },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 'a', 'b', 'c' ] } ) );
			assert.deepStrictEqual( run.State.seen, [ 'a', 'b', 'c' ] );
		} );

		it( 'should write the position to the field named by Index', () =>
		{
			let process_document = {
				Name: 'Positions',
				Steps: [
					{ $do: { seen: [] } },
					{ $forEach: { In: '$items', As: 'item', Index: 'i', Do: [ { $do: { seen: { $concatArrays: [ '$seen', [ '$i' ] ] } } } ] } },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 'a', 'b', 'c' ] } ) );
			assert.deepStrictEqual( run.State.seen, [ 0, 1, 2 ] );
		} );

		// ***The two fields belong to the loop, so the loop takes them back.*** A process
		// which ran a loop does not carry its last element around for the rest of the run.
		it( 'should remove As and Index from the state when the loop ends', () =>
		{
			let process_document = summing_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1, 2 ] } ) );
			assert.strictEqual( 'item' in run.State, false );
			assert.strictEqual( 'i' in run.State, false );
		} );

		it( 'should leave the state alone when the array is empty', () =>
		{
			let process_document = summing_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [], item: 'mine' } ) );
			assert.strictEqual( run.State.item, 'mine' );
			assert.strictEqual( run.State.total, 0 );
		} );

		// ***The iteration is control state, so it lives in the cursor.*** Nothing about
		// where the loop has got to is kept in the document it is working on.
		it( 'should keep the iteration in the cursor', () =>
		{
			let process_document = summing_process();
			let run = jsonproc.Start( process_document, { items: [ 1, 2 ] } );
			run = jsonproc.Step( process_document, run );		// the $do
			run = jsonproc.Step( process_document, run );		// entering the first pass
			assert.deepStrictEqual( run.Cursor, [ 1, [ 'Do', 0 ], 0 ] );
		} );

		// ***This is the reason the runtime tells the operator it is being re-entered.***
		// Working it out from the Index field instead would start this loop at pass 100.
		it( 'should start at the first element even when the input already carries the Index field', () =>
		{
			let process_document = {
				Name: 'PreSet',
				Steps: [
					{ $forEach: { In: '$items', As: 'item', Index: 'i', Do: [ { $do: { seen: { $add: [ '$seen', 1 ] } } } ] } },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 'a', 'b' ], i: 99, seen: 0 } ) );
			assert.strictEqual( run.State.seen, 2 );
			assert.strictEqual( 'i' in run.State, false );
		} );

		it( 'should run a loop inside a loop', () =>
		{
			let process_document = {
				Name: 'Pairs',
				Steps: [
					{ $do: { seen: 0 } },
					{
						$forEach: {
							In: '$rows', As: 'row',
							Do: [ { $forEach: { In: '$row', As: 'cell', Do: [ { $do: { seen: { $add: [ '$seen', '$cell' ] } } } ] } } ],
						},
					},
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { rows: [ [ 1, 2 ], [ 3 ] ] } ) );
			assert.strictEqual( run.State.seen, 6 );
		} );

		it( 'should run a branch inside a loop', () =>
		{
			let process_document = {
				Name: 'ClassifyEach',
				Steps: [
					{ $do: { big: 0, small: 0 } },
					{
						$forEach: {
							In: '$values', As: 'value',
							Do: [ {
								$when: {
									Check: { value: { $gt: 10 } },
									Then: [ { $do: { big: { $add: [ '$big', 1 ] } } } ],
									Else: [ { $do: { small: { $add: [ '$small', 1 ] } } } ],
								},
							} ],
						},
					},
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { values: [ 5, 50, 7 ] } ) );
			assert.strictEqual( run.State.big, 1 );
			assert.strictEqual( run.State.small, 2 );
		} );

		// ***A loop body may suspend, which is the point of stepping a pass at a time.***
		it( 'should suspend inside a pass and resume into the next one', () =>
		{
			let process_document = {
				Name: 'ChargeEach',
				Steps: [
					{ $do: { paid: [] } },
					{
						$forEach: {
							In: '$orders', As: 'order',
							Do: [
								{ $call: { Name: 'Charge', With: { amount: '$order' }, Into: 'receipt' } },
								{ $do: { paid: { $concatArrays: [ '$paid', [ '$receipt' ] ] } } },
							],
						},
					},
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { orders: [ 10, 20 ] } ) );
			assert.strictEqual( run.Status, 'waiting' );
			assert.strictEqual( run.Waiting.With.amount, 10 );

			run = jsonproc.Execute( process_document, jsonproc.Resume( process_document, run, { ok: 1 } ) );
			assert.strictEqual( run.Status, 'waiting' );
			assert.strictEqual( run.Waiting.With.amount, 20 );

			run = jsonproc.Execute( process_document, jsonproc.Resume( process_document, run, { ok: 2 } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.deepStrictEqual( run.State.paid, [ { ok: 1 }, { ok: 2 } ] );
		} );

		it( 'should carry a run suspended in the middle of a pass through storage', () =>
		{
			let process_document = {
				Name: 'ChargeEach',
				Steps: [
					{
						$forEach: {
							In: '$orders', As: 'order',
							Do: [ { $call: { Name: 'Charge', With: { amount: '$order' }, Into: 'receipt' } } ],
						},
					},
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { orders: [ 10, 20 ] } ) );
			let restored = jsongin.Parse( jsongin.Format( run, STORAGE ), STORAGE );
			assert.deepStrictEqual( restored.Cursor, run.Cursor );

			let resumed = jsonproc.Execute( process_document, jsonproc.Resume( process_document, restored, { ok: 1 } ) );
			assert.strictEqual( resumed.Status, 'waiting' );
			assert.strictEqual( resumed.Waiting.With.amount, 20 );
		} );

		// ***In is evaluated again before each pass***, which makes a work list which the
		// body may add to. Documented as deliberate, and tested so it stays that way.
		it( 'should see an array the body has added to', () =>
		{
			let process_document = {
				Name: 'Growing',
				Steps: [
					{ $do: { seen: [] } },
					{
						$forEach: {
							In: '$queue', As: 'job',
							Do: [
								{ $do: { seen: { $concatArrays: [ '$seen', [ '$job' ] ] } } },
								{ $when: { Check: { job: 1 }, Then: [ { $do: { queue: { $concatArrays: [ '$queue', [ 2 ] ] } } } ] } },
							],
						},
					},
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { queue: [ 1 ] } ) );
			assert.deepStrictEqual( run.State.seen, [ 1, 2 ] );
		} );

		it( 'should fail when In does not produce an array', () =>
		{
			let process_document = {
				Name: 'NotAnArray',
				Steps: [ { $forEach: { In: '$n', As: 'x', Do: [ { $do: { seen: true } } ] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 7 } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepFailed' );
		} );

		it( 'should refuse a missing As as a bad process', () =>
		{
			let process_document = {
				Name: 'NoAs',
				Steps: [ { $forEach: { In: '$items', Do: [ { $do: { seen: true } } ] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1 ] } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse an empty body as a bad process', () =>
		{
			let process_document = {
				Name: 'NoBody',
				Steps: [ { $forEach: { In: '$items', As: 'item', Do: [] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1 ] } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse an Index which is not a field name as a bad process', () =>
		{
			let process_document = {
				Name: 'BadIndex',
				Steps: [ { $forEach: { In: '$items', As: 'item', Index: 7, Do: [ { $do: { seen: true } } ] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1 ] } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $throw Step', () =>
	{

		function throwing( Thrown )
		{
			return { Name: 'Throwing', Steps: [ { $throw: Thrown } ] };
		}

		it( 'should halt the run when nothing catches it', () =>
		{
			let process_document = throwing( 'boom' );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Message, 'boom' );
		} );

		it( 'should call a thrown string Thrown', () =>
		{
			let process_document = throwing( 'boom' );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'Thrown' );
		} );

		it( 'should take a Code and a Message from a thrown document', () =>
		{
			let process_document = throwing( { Code: 'CartEmpty', Message: 'nothing to charge for' } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'CartEmpty' );
			assert.strictEqual( run.Error.Message, 'nothing to charge for' );
		} );

		it( 'should evaluate the message as an expression', () =>
		{
			let process_document = throwing( { Code: 'NoCustomer', Message: { $concat: [ 'no such customer: ', '$who' ] } } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { who: 'ada' } ) );
			assert.strictEqual( run.Error.Message, 'no such customer: ada' );
		} );

		it( 'should name the cursor it was thrown at', () =>
		{
			let process_document = { Name: 'Late', Steps: [ { $do: { a: 1 } }, { $throw: 'boom' } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.Error.Cursor, [ 1 ] );
		} );

		// ***A process must not be able to reach past every handler around it.*** The reserved
		// codes are the ones a $try refuses to catch, so throwing one would halt a run whose
		// caller had wrapped it precisely so that it would not.
		it( 'should refuse a reserved code as a bad process', () =>
		{
			let process_document = throwing( { Code: 'BadProcess', Message: 'sneaky' } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
			assert.ok( run.Error.Message.includes( 'reserved' ) );
		} );

		it( 'should refuse a reserved code even inside a try', () =>
		{
			let process_document = {
				Name: 'Sneaky',
				Steps: [ { $try: {
					Do: [ { $throw: { Code: 'StepLimitExceeded', Message: 'sneaky' } } ],
					Catch: [ { $do: { caught: true } } ],
					As: 'error',
				} } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
			assert.strictEqual( 'caught' in run.State, false );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $try Step', () =>
	{

		function guarded( Do, Catch )
		{
			return {
				Name: 'Guarded',
				Steps: [
					{ $try: { Do: Do, Catch: Catch, As: 'error' } },
					{ $do: { after: true } },
				],
			};
		}

		it( 'should run the Catch branch when a step fails', () =>
		{
			let process_document = guarded( [ { $throw: 'boom' } ], [ { $do: { caught: true } } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.State.caught, true );
		} );

		it( 'should write the error to the field named by As', () =>
		{
			let process_document = guarded( [ { $throw: { Code: 'CartEmpty', Message: 'no items' } } ], [ { $do: { seen: '$error.Code' } } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.State.error.Code, 'CartEmpty' );
			assert.strictEqual( run.State.error.Message, 'no items' );
			assert.strictEqual( run.State.seen, 'CartEmpty' );
		} );

		// ***The error goes into the state so that a query can read it.*** A $$name could not
		// be tested by the $when a handler most often wants to make.
		it( 'should let a $when in the handler test the code', () =>
		{
			let process_document = guarded(
				[ { $throw: { Code: 'CartEmpty', Message: 'no items' } } ],
				[ { $when: {
					Check: { 'error.Code': 'CartEmpty' },
					Then: [ { $do: { why: 'empty cart' } } ],
					Else: [ { $do: { why: 'something else' } } ],
				} } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.State.why, 'empty cart' );
		} );

		it( 'should carry on with the step after the try', () =>
		{
			let process_document = guarded( [ { $throw: 'boom' } ], [ { $do: { caught: true } } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.State.after, true );
		} );

		it( 'should not run the Catch branch when the body succeeds', () =>
		{
			let process_document = guarded( [ { $do: { ran: true } } ], [ { $do: { caught: true } } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.State.ran, true );
			assert.strictEqual( 'caught' in run.State, false );
			assert.strictEqual( run.State.after, true );
		} );

		// ***A step which changed the state and then failed did change it.*** Rolling that
		// back would be a transaction, and this is not one.
		it( 'should show the handler the state as the failure left it', () =>
		{
			let process_document = guarded(
				[ { $do: { half: 'done' } }, { $throw: 'after the change' } ],
				[ { $do: { saw: '$half' } } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.State.saw, 'done' );
		} );

		it( 'should catch an operator which refused', () =>
		{
			let process_document = guarded(
				[ { $forEach: { In: '$n', As: 'x', Do: [ { $do: { seen: true } } ] } } ],
				[ { $do: { caught: '$error.Code' } } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { n: 7 } ) );
			assert.strictEqual( run.State.caught, 'StepFailed' );
		} );

		it( 'should catch a call the host reported as failed', () =>
		{
			let process_document = guarded(
				[ { $call: { Name: 'Charge', With: {}, Into: 'receipt' } } ],
				[ { $do: { declined: '$error.Code' } } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'waiting' );

			run = jsonproc.Execute( process_document,
				jsonproc.Resume( process_document, run, undefined, { Code: 'CardDeclined', Message: 'no funds' } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.State.declined, 'CardDeclined' );
			assert.strictEqual( run.State.after, true );
		} );

		it( 'should catch a failure reported to a run which was stored while waiting', () =>
		{
			let process_document = guarded(
				[ { $call: { Name: 'Charge', With: {}, Into: 'receipt' } } ],
				[ { $do: { declined: '$error.Code' } } ] );
			let waiting = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			let restored = jsongin.Parse( jsongin.Format( waiting, STORAGE ), STORAGE );

			let run = jsonproc.Execute( process_document,
				jsonproc.Resume( process_document, restored, undefined, { Code: 'CardDeclined', Message: 'no funds' } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.State.declined, 'CardDeclined' );
		} );

		it( 'should take no As at all', () =>
		{
			let process_document = {
				Name: 'NoAs',
				Steps: [ { $try: { Do: [ { $throw: 'boom' } ], Catch: [ { $do: { caught: true } } ] } } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.State.caught, true );
		} );

		// ***Without this rule a handler which failed would hand itself its own failure.***
		it( 'should not catch a failure raised inside its own Catch', () =>
		{
			let process_document = guarded(
				[ { $throw: 'first' } ],
				[ { $do: { ran: true } }, { $throw: 'second' } ] );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Message, 'second' );
			assert.strictEqual( run.State.ran, true );
		} );

		it( 'should let the try around it catch a failure raised inside a Catch', () =>
		{
			let process_document = {
				Name: 'Nested',
				Steps: [ { $try: {
					Do: [ { $try: { Do: [ { $throw: 'inner' } ], Catch: [ { $throw: 'from the handler' } ], As: 'inner_error' } } ],
					Catch: [ { $do: { outer: '$outer_error.Message' } } ],
					As: 'outer_error',
				} } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.State.outer, 'from the handler' );
		} );

		it( 'should catch a failure raised inside a loop in its body', () =>
		{
			let process_document = {
				Name: 'ThrowInLoop',
				Steps: [
					{ $do: { seen: [] } },
					{ $try: {
						Do: [ { $forEach: { In: '$items', As: 'item', Do: [
							{ $do: { seen: { $concatArrays: [ '$seen', [ '$item' ] ] } } },
							{ $when: { Check: { item: 2 }, Then: [ { $throw: 'the second one' } ] } },
						] } } ],
						Catch: [ { $do: { stopped: '$error.Message' } } ],
						As: 'error',
					} },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1, 2, 3 ] } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.deepStrictEqual( run.State.seen, [ 1, 2 ] );
			assert.strictEqual( run.State.stopped, 'the second one' );
		} );

		// ***A loop abandoned by a failure never reaches its own tidying up.*** Documented
		// rather than fixed: the alternative is unwinding, which this design does not do.
		it( 'should leave an abandoned loop\'s As field on the state', () =>
		{
			let process_document = {
				Name: 'Abandoned',
				Steps: [ { $try: {
					Do: [ { $forEach: { In: '$items', As: 'item', Do: [
						{ $when: { Check: { item: 2 }, Then: [ { $throw: 'stop' } ] } },
					] } } ],
					Catch: [ { $do: { caught: true } } ],
					As: 'error',
				} } ],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1, 2, 3 ] } ) );
			assert.strictEqual( run.State.item, 2 );
		} );

		it( 'should catch on every pass of a loop it sits inside', () =>
		{
			let process_document = {
				Name: 'GuardedLoop',
				Steps: [
					{ $do: { ok: 0, bad: 0 } },
					{ $forEach: { In: '$items', As: 'item', Do: [
						{ $try: {
							Do: [ { $when: {
								Check: { item: { $lt: 0 } },
								Then: [ { $throw: 'negative' } ],
								Else: [ { $do: { ok: { $add: [ '$ok', 1 ] } } } ],
							} } ],
							Catch: [ { $do: { bad: { $add: [ '$bad', 1 ] } } } ],
							As: 'error',
						} },
					] } },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { items: [ 1, -1, 2, -3 ] } ) );
			assert.strictEqual( run.State.ok, 2 );
			assert.strictEqual( run.State.bad, 2 );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'What a $try Does Not Catch', () =>
	{

		// ***The line between an error and a bug.*** A process which mishandles a declined
		// card is doing its job; a process with a typo in it is broken, and a $try which
		// swallowed that would turn every typo into a silently handled error.
		function wrapping( Step )
		{
			return {
				Name: 'Wrapping',
				Steps: [ { $try: { Do: [ Step ], Catch: [ { $do: { caught: true } } ], As: 'error' } } ],
			};
		}

		it( 'should not catch an operator which is not registered', () =>
		{
			let process_document = wrapping( { $nosuchthing: 1 } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'UnknownOperator' );
			assert.strictEqual( 'caught' in run.State, false );
		} );

		it( 'should not catch a fault in the process document', () =>
		{
			let process_document = wrapping( { $while: { Check: { go: true }, Do: [] } } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { go: true } ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
			assert.strictEqual( 'caught' in run.State, false );
		} );

		it( 'should not catch a step which is not a document with one key', () =>
		{
			let process_document = wrapping( 42 );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
			assert.strictEqual( 'caught' in run.State, false );
		} );

		// ***The budget is the caller's protection***, and a process must not be able to
		// defeat it from the inside.
		it( 'should not catch the step budget running out', () =>
		{
			let process_document = wrapping( { $while: { Check: { go: true }, Do: [ { $do: { n: { $add: [ '$n', 1 ] } } } ] } } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { go: true, n: 0 } ), 25 );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepLimitExceeded' );
			assert.strictEqual( 'caught' in run.State, false );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'Arguments the $try Step Refuses', () =>
	{

		function refusing( Args )
		{
			return { Name: 'Refusing', Steps: [ { $try: Args } ] };
		}

		it( 'should refuse a missing Do', () =>
		{
			let process_document = refusing( { Catch: [ { $do: { a: 1 } } ] } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse an empty Do', () =>
		{
			let process_document = refusing( { Do: [], Catch: [ { $do: { a: 1 } } ] } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse a missing Catch', () =>
		{
			let process_document = refusing( { Do: [ { $do: { a: 1 } } ] } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse an empty Catch', () =>
		{
			let process_document = refusing( { Do: [ { $do: { a: 1 } } ], Catch: [] } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should refuse an As which is not a field name', () =>
		{
			let process_document = refusing( { Do: [ { $do: { a: 1 } } ], Catch: [ { $do: { b: 2 } } ], As: 7 } );
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $call Step', () =>
	{

		it( 'should suspend rather than call', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			assert.strictEqual( run.Status, 'waiting' );
			assert.strictEqual( run.Waiting.Name, 'ChargeCard' );
		} );

		it( 'should evaluate With against the state', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			assert.strictEqual( run.Waiting.With.amount, 97.2 );
		} );

		it( 'should carry Into when there is one, and leave it off when there is not', () =>
		{
			let with_into = { Name: 'A', Steps: [ { $call: { Name: 'X', With: {}, Into: 'here' } } ] };
			let run = jsonproc.Execute( with_into, jsonproc.Start( with_into, {} ) );
			assert.strictEqual( run.Waiting.Into, 'here' );

			let without_into = { Name: 'B', Steps: [ { $call: { Name: 'X', With: {} } } ] };
			run = jsonproc.Execute( without_into, jsonproc.Start( without_into, {} ) );
			assert.strictEqual( typeof run.Waiting.Into, 'undefined' );
		} );

		it( 'should leave the cursor on the call until it is resumed', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $do: { a: 1 } }, { $call: { Name: 'X', With: {} } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.Cursor, [ 1 ] );
		} );

		it( 'should take no With as an empty With', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $call: { Name: 'X' } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.Waiting.With, {} );
		} );

		it( 'should refuse a call with no Name', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $call: { With: {} } } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepFailed' );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'The $return Step', () =>
	{

		it( 'should halt with the value it evaluates', () =>
		{
			let process_document = { Name: 'R', Steps: [ { $return: '$a' } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { a: 42 } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.Result, 42 );
		} );

		it( 'should evaluate an expression document', () =>
		{
			let process_document = { Name: 'R', Steps: [ { $return: { sum: { $add: [ '$a', '$b' ] } } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { a: 1, b: 2 } ) );
			assert.deepStrictEqual( run.Result, { sum: 3 } );
		} );

		it( 'should stop the steps after it from running', () =>
		{
			let process_document = { Name: 'R', Steps: [ { $return: 'here' }, { $do: { never: true } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Result, 'here' );
			assert.deepStrictEqual( run.State, {} );
		} );

		it( 'should carry no Result at all when the expression produces nothing', () =>
		{
			// ***A storage rule, not a nicety.*** A field set to undefined does not survive
			// being written down, and a run which cannot be stored is not a run.
			let process_document = { Name: 'R', Steps: [ { $return: '$nope' } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( Object.keys( run ).includes( 'Result' ), false );
		} );

		it( 'should return the state for $$ROOT', () =>
		{
			let process_document = { Name: 'R', Steps: [ { $return: '$$ROOT' } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { a: 1 } ) );
			assert.deepStrictEqual( run.Result, { a: 1 } );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'Running Off the End', () =>
	{

		it( 'should return the state, the way { $return: $$ROOT } would', () =>
		{
			let process_document = { Name: 'End', Steps: [ { $do: { total: { $add: [ '$a', '$b' ] } } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { a: 2, b: 3 } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.deepStrictEqual( run.Result, { a: 2, b: 3, total: 5 } );
		} );

		it( 'should finish a process which has no steps at all', () =>
		{
			let process_document = { Name: 'Nothing', Steps: [] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { a: 1 } ) );
			assert.strictEqual( run.Status, 'done' );
			assert.deepStrictEqual( run.Result, { a: 1 } );
		} );

		it( 'should empty the cursor when it is over', () =>
		{
			let process_document = { Name: 'End', Steps: [ { $do: { a: 1 } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.Cursor, [] );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'Resuming', () =>
	{

		it( 'should write the result into the state and carry on', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			run = jsonproc.Resume( process_document, run, { confirmation: 'abc' } );
			assert.strictEqual( run.Status, 'ready' );
			assert.deepStrictEqual( run.State.receipt, { confirmation: 'abc' } );
			assert.deepStrictEqual( run.Cursor, [ 3 ] );
		} );

		it( 'should finish the process it was resumed into', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			run = jsonproc.Resume( process_document, run, { confirmation: 'abc' } );
			run = jsonproc.Execute( process_document, run );
			assert.strictEqual( run.Status, 'done' );
			assert.deepStrictEqual( run.Result, { confirmation: 'abc' } );
		} );

		it( 'should drop the Waiting descriptor', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			run = jsonproc.Resume( process_document, run, {} );
			assert.strictEqual( Object.keys( run ).includes( 'Waiting' ), false );
		} );

		it( 'should discard the result of a call which named no Into', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $call: { Name: 'X', With: {} } }, { $do: { after: true } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			run = jsonproc.Execute( process_document, jsonproc.Resume( process_document, run, { ignored: true } ) );
			assert.deepStrictEqual( run.State, { after: true } );
		} );

		it( 'should remove the field when the result is nothing', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $call: { Name: 'X', With: {}, Into: 'a' } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { a: 1 } ) );
			run = jsonproc.Resume( process_document, run );
			assert.deepStrictEqual( run.State, {} );
		} );

		it( 'should write into a dotted path', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $call: { Name: 'X', With: {}, Into: 'a.b' } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			run = jsonproc.Resume( process_document, run, 7 );
			assert.deepStrictEqual( run.State, { a: { b: 7 } } );
		} );

		it( 'should refuse a run which is not waiting', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $do: { a: 1 } } ] };
			let run = jsonproc.Resume( process_document, jsonproc.Start( process_document, {} ), 1 );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'ResumeNotWaiting' );
		} );

		it( 'should fail the run when the host reports the call failed', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $call: { Name: 'X', With: {} } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			run = jsonproc.Resume( process_document, run, undefined, new Error( 'the card was declined' ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepFailed' );
			assert.strictEqual( run.Error.Message, 'the card was declined' );
			assert.deepStrictEqual( run.Error.Cursor, [ 0 ] );
		} );

		it( 'should take a code and a message from the host', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $call: { Name: 'X', With: {} } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			run = jsonproc.Resume( process_document, run, undefined, { Code: 'CardDeclined', Message: 'insufficient funds' } );
			assert.strictEqual( run.Error.Code, 'CardDeclined' );
			assert.strictEqual( run.Error.Message, 'insufficient funds' );
		} );

		it( 'should not modify the run it was given', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			let before = jsongin.Format( run, STORAGE );
			jsonproc.Resume( process_document, run, { confirmation: 'abc' } );
			assert.strictEqual( jsongin.Format( run, STORAGE ), before );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'Stepping and Executing', () =>
	{

		it( 'should make stepping a halted run a no-op', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $return: 1 } ] };
			let done = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			let again = jsonproc.Step( process_document, done );
			assert.deepStrictEqual( again, done );
		} );

		it( 'should return a new value rather than the run it was given', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $return: 1 } ] };
			let done = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.notStrictEqual( jsonproc.Step( process_document, done ), done );
		} );

		it( 'should agree with repeated stepping', () =>
		{
			let process_document = checkout_process();
			let start = jsonproc.Start( process_document, { sub: 100, tax: 8 } );

			let stepped = start;
			while ( stepped.Status === 'ready' ) { stepped = jsonproc.Step( process_document, stepped ); }
			let executed = jsonproc.Execute( process_document, start );

			assert.deepStrictEqual( stepped, executed );
		} );

		it( 'should fail a run which does not halt within the budget', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $do: { a: 1 } }, { $do: { b: 2 } }, { $do: { c: 3 } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ), 2 );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'StepLimitExceeded' );
		} );

		it( 'should take a budget large enough to finish', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $do: { a: 1 } }, { $do: { b: 2 } } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ), 50 );
			assert.strictEqual( run.Status, 'done' );
		} );

		it( 'should step the same run twice to the same answer', () =>
		{
			let process_document = checkout_process();
			let start = jsonproc.Start( process_document, { sub: 100, tax: 8 } );
			assert.deepStrictEqual(
				jsonproc.Step( process_document, start ),
				jsonproc.Step( process_document, start ) );
		} );

		it( 'should keep two runs of one process apart', () =>
		{
			let process_document = checkout_process();
			let left = jsonproc.Start( process_document, { sub: 100, tax: 8 } );
			let right = jsonproc.Start( process_document, { sub: 10, tax: 1 } );

			// One takes the Then branch and the other the Else, so they reach the call in a
			// different number of steps. Alternating until neither is ready is the point
			// anyway: the two are interleaved through the same engine.
			while ( ( left.Status === 'ready' ) || ( right.Status === 'ready' ) )
			{
				if ( left.Status === 'ready' ) { left = jsonproc.Step( process_document, left ); }
				if ( right.Status === 'ready' ) { right = jsonproc.Step( process_document, right ); }
			}

			assert.strictEqual( left.Waiting.With.amount, 97.2 );
			assert.strictEqual( right.Waiting.With.amount, 11 );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'Failure', () =>
	{

		it( 'should never throw, whatever it is handed', () =>
		{
			assert.doesNotThrow( function () { jsonproc.Step( null, null ); } );
			assert.doesNotThrow( function () { jsonproc.Step( { Steps: [] }, 'nope' ); } );
			assert.doesNotThrow( function () { jsonproc.Execute( 42, [] ); } );
			assert.doesNotThrow( function () { jsonproc.Resume( undefined, undefined ); } );
		} );

		it( 'should always return a run', () =>
		{
			let run = jsonproc.Step( null, null );
			assert.strictEqual( run.Status, 'failed' );
			assert.ok( Array.isArray( run.Cursor ) );
		} );

		it( 'should refuse a run which belongs to another process', () =>
		{
			let mine = { Name: 'Mine', Steps: [ { $do: { a: 1 } } ] };
			let yours = { Name: 'Yours', Steps: [ { $do: { a: 1 } } ] };
			let run = jsonproc.Step( yours, jsonproc.Start( mine, {} ) );
			assert.strictEqual( run.Status, 'failed' );
			assert.strictEqual( run.Error.Code, 'BadRun' );
		} );

		it( 'should refuse a run whose Status is not a status', () =>
		{
			let process_document = { Name: 'A', Steps: [] };
			let run = jsonproc.Start( process_document, {} );
			run.Status = 'sideways';
			assert.strictEqual( jsonproc.Step( process_document, run ).Error.Code, 'BadRun' );
		} );

		it( 'should report a step operator which is not registered', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $nosuchthing: 1 } ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'UnknownOperator' );
		} );

		it( 'should report a step which is not a document with one key', () =>
		{
			let process_document = { Name: 'A', Steps: [ 42 ] };
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'BadProcess' );

			process_document = { Name: 'B', Steps: [ { $do: { a: 1 }, $return: 1 } ] };
			run = jsonproc.Step( process_document, jsonproc.Start( process_document, {} ) );
			assert.strictEqual( run.Error.Code, 'BadProcess' );
		} );

		it( 'should report a cursor which addresses nothing', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $do: { a: 1 } } ] };
			let run = jsonproc.Start( process_document, {} );
			run.Cursor = [ 0, 'Nowhere', 0 ];
			assert.strictEqual( jsonproc.Step( process_document, run ).Error.Code, 'NoSuchStep' );
		} );

		it( 'should name the cursor the failure happened at', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $do: { a: 1 } }, { $nosuchthing: 1 } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.Error.Cursor, [ 1 ] );
		} );

		it( 'should keep the state a failed run had reached', () =>
		{
			let process_document = { Name: 'A', Steps: [ { $do: { a: 1 } }, { $nosuchthing: 1 } ] };
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			assert.deepStrictEqual( run.State, { a: 1 } );
		} );

	} );


	//---------------------------------------------------------------------
	describe( 'Storage', () =>
	{

		it( 'should write a run down and read it back unchanged', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Step( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			let restored = jsongin.Parse( jsongin.Format( run, STORAGE ), STORAGE );
			assert.deepStrictEqual( restored, run );
		} );

		it( 'should step a stored run to the same place as the run it came from', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Start( process_document, { sub: 100, tax: 8 } );
			let restored = jsongin.Parse( jsongin.Format( run, STORAGE ), STORAGE );
			assert.deepStrictEqual(
				jsonproc.Step( process_document, restored ),
				jsonproc.Step( process_document, run ) );
		} );

		it( 'should keep $$NOW across storage, so a resumed run agrees with itself', () =>
		{
			let process_document = {
				Name: 'Now',
				Steps: [
					{ $call: { Name: 'X', With: {} } },
					{ $do: { at: '$$NOW' } },
				],
			};
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, {} ) );
			let started_at = run.Scope.Variables.NOW.getTime();

			let restored = jsongin.Parse( jsongin.Format( run, STORAGE ), STORAGE );
			restored = jsonproc.Execute( process_document, jsonproc.Resume( process_document, restored ) );

			assert.strictEqual( restored.State.at.getTime(), started_at );
		} );

		it( 'should carry a state holding the values plain JSON cannot', () =>
		{
			let process_document = { Name: 'Typed', Steps: [ { $do: { copied: '$at' } } ] };
			let run = jsonproc.Step( process_document,
				jsonproc.Start( process_document, { at: new Date( '2020-01-01T00:00:00.000Z' ), pattern: /ab+c/i } ) );

			let restored = jsongin.Parse( jsongin.Format( run, STORAGE ), STORAGE );
			assert.ok( restored.State.copied instanceof Date );
			assert.ok( restored.State.pattern instanceof RegExp );
			assert.strictEqual( restored.State.pattern.flags, 'i' );
		} );

		it( 'should write a waiting run down with what it is waiting for', () =>
		{
			let process_document = checkout_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { sub: 100, tax: 8 } ) );
			let restored = jsongin.Parse( jsongin.Format( run, STORAGE ), STORAGE );
			assert.deepStrictEqual( restored.Waiting, run.Waiting );
		} );

	} );



	//---------------------------------------------------------------------
	// ***Parallel work belongs to the host, and this is the pattern which shows it.***
	// A $call handler starts one child run per item of work, drives each to completion, and
	// resumes the parent with all of the results at once. The engine needs nothing for this:
	// rule 4 of build/process-check.js already says that two runs stepped alternately never
	// affect each other, which is exactly the property a host running them at the same time
	// depends on. A real host would await Promise.all() around the loop below, and the engine
	// cannot tell the difference, because it is never inside the loop.
	describe( 'Fanning Out Through the Host', () =>
	{

		// The child process, run once per check.
		function check_process()
		{
			return {
				Name: 'Check',
				Steps: [
					{ $do: { score: { $multiply: [ '$weight', 10 ] } } },
					{ $return: { name: '$name', score: '$score', passed: { $gte: [ '$score', 50 ] } } },
				],
			};
		}

		// The parent process, which asks for all of the checks at once and then reads the
		// answers as ordinary state.
		function order_process()
		{
			return {
				Name: 'Order',
				Steps: [
					{ $call: { Name: 'RunChecks', With: { checks: '$checks' }, Into: 'results' } },
					{ $do: { failures: { $size: { $filter: { input: '$results', as: 'r', cond: { $eq: [ '$$r.passed', false ] } } } } } },
					{ $return: '$failures' },
				],
			};
		}

		// The host's handler for the RunChecks call. This is the whole of the fan-out.
		function run_checks( Checks )
		{
			let child_process = check_process();
			let results = [];
			for ( let check_index = 0; check_index < Checks.length; check_index++ )
			{
				let child_run = jsonproc.Start( child_process, Checks[ check_index ] );
				child_run = jsonproc.Execute( child_process, child_run );
				results.push( child_run.Result );
			}
			return results;
		}

		function three_checks()
		{
			return [
				{ name: 'credit', weight: 9 },
				{ name: 'fraud', weight: 3 },
				{ name: 'address', weight: 7 },
			];
		}

		it( 'should resume the parent with the result of every child run', () =>
		{
			let process_document = order_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { checks: three_checks() } ) );
			assert.strictEqual( run.Status, 'waiting' );
			assert.strictEqual( run.Waiting.Name, 'RunChecks' );

			let results = run_checks( run.Waiting.With.checks );
			run = jsonproc.Execute( process_document, jsonproc.Resume( process_document, run, results ) );

			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.Result, 1 );
			assert.deepStrictEqual( run.State.results, [
				{ name: 'credit', score: 90, passed: true },
				{ name: 'fraud', score: 30, passed: false },
				{ name: 'address', score: 70, passed: true },
			] );
		} );

		it( 'should leave the parent state untouched while the children run', () =>
		{
			let process_document = order_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { checks: three_checks() } ) );
			let before = JSON.stringify( run.State );

			run_checks( run.Waiting.With.checks );

			assert.strictEqual( JSON.stringify( run.State ), before );
			assert.strictEqual( typeof run.State.results, 'undefined' );
		} );

		it( 'should let the parent branch on what the children returned', () =>
		{
			let process_document = {
				Name: 'Order',
				Steps: [
					{ $call: { Name: 'RunChecks', With: { checks: '$checks' }, Into: 'results' } },
					{
						$when: {
							Check: { 'results.passed': false },
							Then: [ { $do: { decision: 'review' } } ],
							Else: [ { $do: { decision: 'accept' } } ],
						},
					},
					{ $return: '$decision' },
				],
			};

			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { checks: three_checks() } ) );
			let results = run_checks( run.Waiting.With.checks );
			run = jsonproc.Execute( process_document, jsonproc.Resume( process_document, run, results ) );
			assert.strictEqual( run.Result, 'review' );

			// The same process, with nothing for the children to complain about.
			let all_good = [ { name: 'credit', weight: 9 }, { name: 'fraud', weight: 8 } ];
			run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { checks: all_good } ) );
			results = run_checks( run.Waiting.With.checks );
			run = jsonproc.Execute( process_document, jsonproc.Resume( process_document, run, results ) );
			assert.strictEqual( run.Result, 'accept' );
		} );

		it( 'should write the parent down while its children are outstanding', () =>
		{
			let process_document = order_process();
			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { checks: three_checks() } ) );

			// ***The parent is one position and one state***, so it stores while the work it
			// asked for is still in flight. This is what a parent holding several live cursors
			// at once would have cost.
			let stored = jsongin.Format( run, STORAGE );
			let restored = jsongin.Parse( stored, STORAGE );

			let results = run_checks( restored.Waiting.With.checks );
			restored = jsonproc.Execute( process_document, jsonproc.Resume( process_document, restored, results ) );
			assert.strictEqual( restored.Status, 'done' );
			assert.strictEqual( restored.Result, 1 );
		} );

		it( 'should offer a failed child to the parent $try', () =>
		{
			let process_document = {
				Name: 'Order',
				Steps: [
					{
						$try: {
							Do: [ { $call: { Name: 'RunChecks', With: { checks: '$checks' }, Into: 'results' } } ],
							Catch: [ { $do: { decision: 'defer', why: '$error.Message' } } ],
							As: 'error',
						},
					},
					{ $return: '$decision' },
				],
			};

			let run = jsonproc.Execute( process_document, jsonproc.Start( process_document, { checks: three_checks() } ) );
			assert.strictEqual( run.Status, 'waiting' );

			// One of the children failed, and the host says so rather than handing back results.
			run = jsonproc.Resume( process_document, run, undefined, { Code: 'CheckFailed', Message: 'the fraud service is down' } );
			run = jsonproc.Execute( process_document, run );

			assert.strictEqual( run.Status, 'done' );
			assert.strictEqual( run.Result, 'defer' );
			assert.strictEqual( run.State.why, 'the fraud service is down' );
		} );

	} );


} );
