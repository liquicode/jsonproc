// Type declarations for @liquicode/jsonproc
//
// ***Hand written, and hand written on purpose.*** The library is Javascript and stays
// Javascript: there is no `.ts` source, no compiler, and no generated declaration in this
// project. What ships is a declaration a consumer's editor can read, so TypeScript is
// ***supported and never required***.
//
// ***A declaration file drifts silently***, which is the whole objection to writing one by
// hand. `build/types-check.js` answers that: it loads the running runtime and asserts that
// every export here exists there, that every export there is declared here, and that
// `src/jsonproc.mjs` re-exports the same set. A declaration nothing checks is a comment.
//
// OpLog and OpError are declared on the runtime but are ***not*** named exports. They are
// mutable settings, and a named ESM export binds at load time. See src/jsonproc.mjs.

declare module '@liquicode/jsonproc'
{

	//---------------------------------------------------------------------
	// Documents and values.

	/** A document is an object. A process, a run, and a state are all documents. */
	export type JsonDocument = { [ Key: string ]: any };

	/** Reports an operation. Assign one to Runtime.OpLog to turn operation logging on. */
	export type OpLogFunction = ( Message: string ) => void;

	/** A table of step operators, keyed by operator name. Extended by registering an operator. */
	export type StepOperatorTable = { [ OperatorName: string ]: any };


	//---------------------------------------------------------------------
	// Runtime settings.

	export interface RuntimeSettings
	{
		/** The jsongin engine this runtime evaluates with. Null takes jsongin's default instance. */
		jsongin: any;
		OpLog: OpLogFunction | null;
		OpError: OpLogFunction | null;
	}

	export interface LibraryInfo
	{
		name: string;
		url: string;
		version: string;
	}


	//---------------------------------------------------------------------
	// A process.
	//
	// A document describing work. Each step is one document with one step operator, so a
	// step is left open rather than enumerated - the registry is extensible, and a step
	// operator of your own makes a step shape this declaration has never heard of.

	export interface ProcessStep
	{
		[ StepOperator: string ]: any;
	}

	export interface ProcessDocument
	{
		/** Stamped onto every run, so a stored run cannot be stepped against the wrong process. */
		Name?: string;
		Steps: ProcessStep[];
		[ Key: string ]: any;
	}


	//---------------------------------------------------------------------
	// A run.
	//
	// How far the work has got. ***The run has no methods; everything on it is data.***
	// The optional fields are left off rather than set to undefined, so that a run survives
	// a JSON round trip - see the Process guide.

	/** `ready` - a step is waiting to run. `waiting` - suspended on a `$call`. `done` - halted with a Result. `failed` - halted with an Error. */
	export type RunStatus = 'ready' | 'waiting' | 'done' | 'failed';

	export type RunErrorCode =
		'BadProcess' | 'BadRun' | 'NoSuchStep' | 'UnknownOperator' |
		'StepFailed' | 'ResumeNotWaiting' | 'StepLimitExceeded' | 'Thrown';

	export interface RunError
	{
		Code: RunErrorCode;
		Message: string;
		Cursor: any[];
	}

	/** The call a waiting run is suspended on. */
	export interface RunWaiting
	{
		Name: string;
		With: JsonDocument;
		Into?: string;
	}

	export interface ProcessRun
	{
		/** The Name of the process this run belongs to, or null for a process with no name. */
		Process: string | null;
		Status: RunStatus;
		/** The position of the next step. An empty cursor means the process is over. */
		Cursor: any[];
		/** The document the process is working on. */
		State: JsonDocument;
		/** The variable bindings, in the stored form jsongin's Scope.ToJSON() writes. */
		Scope: JsonDocument;
		/** Present only while Status is `waiting`. */
		Waiting?: RunWaiting;
		/** Present only when Status is `done` and there is a value. */
		Result?: any;
		/** Present only when Status is `failed`. */
		Error?: RunError;
		/** Present only while the cursor has just climbed back into a loop. */
		Reentry?: any[];
	}

	/** What a host reports back to Resume() when the call it was asked to make failed. */
	export interface ResumeError
	{
		Code?: RunErrorCode;
		Message?: string;
		[ Key: string ]: any;
	}


	//---------------------------------------------------------------------
	// The runtime.

	export interface JsonprocRuntime
	{
		//--- Runtime construction.
		NewJsonproc( RuntimeSettings?: Partial<RuntimeSettings> ): JsonprocRuntime;

		//--- Library information and settings.
		Library: LibraryInfo;
		Settings: RuntimeSettings;

		/** Assign a function to turn operation logging on. Null by default. */
		OpLog: OpLogFunction | null;
		/** Assign a function to turn operation error reporting on. Null by default. */
		OpError: OpLogFunction | null;

		/**
		 * The jsongin engine this runtime evaluates with.
		 *
		 * Declared as the engine `@liquicode/jsongin` describes rather than restated here,
		 * so that it cannot drift from the package which defines it. jsongin is a runtime
		 * dependency, so its declaration is always installed alongside this one.
		 */
		jsongin: import( '@liquicode/jsongin' ).JsonginEngine;

		//--- Operator tables.
		StepOperators: StepOperatorTable;

		//--- The process runtime.

		/** Begins a run. The Input document becomes the State, cloned. */
		Start( Process: ProcessDocument, Input?: JsonDocument | null ): ProcessRun;

		/** Runs one step. Stepping a halted run returns it unchanged rather than failing. */
		Step( Process: ProcessDocument, Run: ProcessRun ): ProcessRun;

		/** Runs until the run halts or the step budget is spent. */
		Execute( Process: ProcessDocument, Run: ProcessRun, MaxSteps?: number ): ProcessRun;

		/** Continues a waiting run with the result of the call it suspended on, or with a failure. */
		Resume( Process: ProcessDocument, Run: ProcessRun, Result?: any, Error?: ResumeError | string ): ProcessRun;
	}


	//---------------------------------------------------------------------
	// The default export is the runtime, and is what `require()` returns.

	const jsonproc: JsonprocRuntime;
	export default jsonproc;


	//---------------------------------------------------------------------
	// Named exports, matching src/jsonproc.mjs one for one.

	export const NewJsonproc: JsonprocRuntime[ 'NewJsonproc' ];

	export const Start: JsonprocRuntime[ 'Start' ];
	export const Step: JsonprocRuntime[ 'Step' ];
	export const Execute: JsonprocRuntime[ 'Execute' ];
	export const Resume: JsonprocRuntime[ 'Resume' ];

	export const Library: LibraryInfo;
	export const Settings: RuntimeSettings;
	export const StepOperators: StepOperatorTable;

	export const jsongin: JsonprocRuntime[ 'jsongin' ];

}
