'use strict';

module.exports = function ( jsonproc )
{
	// The jsongin engine this runtime evaluates against.
	const jsongin = jsonproc.jsongin;


	//---------------------------------------------------------------------
	// Readies the Check of a $when or a $while for jsongin.Query.
	//
	// ***A Check which cannot be run is a fault in the process, not in the run.*** A missing
	// Check, and one jsongin refuses - an unknown operator, an operator where none may stand -
	// are refused the same way whatever the state holds, so they are BadProcess and a $try does
	// not catch them. jsongin.ValidateQuery asks that question without a document.
	//
	// ***$$NOW in a Check is the instant the run began.*** Query() takes no scope, and carrying
	// one into it is a standing non-goal, so a $$NOW inside $expr used to read the clock. The
	// run's instant is written into the Check instead, as a $literal, wherever $$NOW stands
	// inside an $expr or an $exprx. Outside those, '$$NOW' is an ordinary string, as it is to
	// MongoDB. The process document is not modified; a copy is returned.
	function Prepare( OperatorName, Check, Scope )
	{
		if ( jsongin.ShortType( Check ) !== 'o' )
		{
			throw bad_process( `${OperatorName} requires a Check query.` );
		}

		let prepared = Check;
		let now = now_of( Scope );
		if ( now !== null ) { prepared = with_now( Check, now, false ); }

		try
		{
			jsongin.ValidateQuery( prepared );
		}
		catch ( error )
		{
			throw bad_process( `${OperatorName} has a Check which cannot be run. ${error.message}` );
		}
		return prepared;
	}


	//---------------------------------------------------------------------
	function bad_process( Message )
	{
		let error = new Error( Message );
		error.Code = 'BadProcess';
		return error;
	}


	//---------------------------------------------------------------------
	// The run's $$NOW, or null when the scope offers none.
	function now_of( Scope )
	{
		if ( jsongin.ShortType( Scope ) !== 'o' ) { return null; }
		if ( typeof Scope.Lookup !== 'function' ) { return null; }
		let found = Scope.Lookup( 'NOW' );
		if ( found.Found !== true ) { return null; }
		if ( jsongin.ShortType( found.Value ) !== 'd' ) { return null; }
		return found.Value;
	}


	//---------------------------------------------------------------------
	// A copy of Node with every '$$NOW' inside an expression replaced by the given instant.
	function with_now( Node, Now, InExpression )
	{
		let node_type = jsongin.ShortType( Node );

		if ( node_type === 's' )
		{
			if ( ( InExpression === true ) && ( Node === '$$NOW' ) ) { return { $literal: Now }; }
			return Node;
		}

		if ( node_type === 'a' )
		{
			let copy = [];
			for ( let index = 0; index < Node.length; index++ )
			{
				copy.push( with_now( Node[ index ], Now, InExpression ) );
			}
			return copy;
		}

		if ( node_type === 'o' )
		{
			let copy = {};
			let keys = Object.keys( Node );
			for ( let index = 0; index < keys.length; index++ )
			{
				let key = keys[ index ];
				let inside = ( InExpression === true ) || ( key === '$expr' ) || ( key === '$exprx' );
				copy[ key ] = with_now( Node[ key ], Now, inside );
			}
			return copy;
		}

		// A date, a regexp, a number and the rest are carried across as they are.
		return Node;
	}


	//---------------------------------------------------------------------
	return {
		Prepare: Prepare,
	};
};
