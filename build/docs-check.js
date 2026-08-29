'use strict';

/*
	Checks the documentation for the kinds of defect which are cheap to detect and expensive
	to find by reading.

	Uses only Node's own modules, so this adds no dependency.

	Usage:
		npm run check-docs
		npm run check-docs -- --verbose      (list every finding rather than the first few)

	Six checks are performed:

		fences      Every ```js block must parse as Javascript.
		            A result belongs in a comment, not in a bare expression, so that what sits
		            inside a code fence is code. Enforcing this is what caught a wrong operator
		            name, a missing colon, an array declared with braces, and four headline
		            examples which inverted operator and field.
		            A block which is not Javascript - program output, the shape of a value, a
		            method signature - carries no language tag and is not checked.

		links       Every local markdown link must resolve to a file which exists.
		            A link beginning with '/' resolves from the docs root, the way docsify
		            resolves it. Every other link resolves relative to the file it appears in,
		            which is what docsify's relativePath setting and GitHub both do.

		anchors     Every link which names a '#fragment' must find it in the page it points
		            at, whether that is another page or the same one. The links check reads
		            only the file half of a target, so five links to headings which did not
		            exist yet passed it; a link into a page is only as good as the anchor.

		            A page's anchors are its explicit <a id="..."> tags plus the slug docsify
		            derives from each of its headings, numbered on a repeat the way docsify
		            numbers them.

		orphans     Every page under docs/ must be reachable from another page, so that a
		            document cannot be written and then quietly left unlinked.

		operators   Every registered operator must carry an /*md block describing its usage,
		            so that an operator cannot be added without being written up.

		examples    Every ```js block is executed against the engine, and the claims its
		            comments make are checked:

		                // returns <value>   the statement must produce that value
		                // throws            the statement must throw
		                expression === value the expression must be true

		            Parsing is not enough. `jsongin.BsonType( 1700000000000 ) === 16` parses
		            perfectly and is false, and documentation drifts from the engine exactly
		            this way: every stale claim this check has caught was a behavior which
		            changed while the page describing it did not.

		            A fence which shows the shape of a call the reader completes with their
		            own values cannot run. It opts out with a `// docs-check: skip` comment
		            and is still parsed by the fences check.

	Exits with a non-zero status when anything fails, so that a build can depend on it.
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );
const LIB_VM = require( 'vm' );
const LIB_JSONGIN = require( '@liquicode/jsongin' );
const LIB_JSONPROC = require( '../src/jsonproc.js' );

const REPO = LIB_PATH.resolve( __dirname, '..' );
const DOCS = LIB_PATH.join( REPO, 'docs' );
const TEMPLATES = LIB_PATH.join( DOCS, 'templates' );

// A page which the site loads directly, rather than reaching through a link.
const ENTRY_POINTS = [ '_sidebar.md', '_coverpage.md', '_404.md' ];

const VERBOSE = process.argv.includes( '--verbose' );
const PREVIEW_COUNT = 12;


//---------------------------------------------------------------------
// Returns every markdown file within a folder.
function find_markdown_files( Folder, Found = [] )
{
	let entries = LIB_FS.readdirSync( Folder, { withFileTypes: true } );
	for ( let index = 0; index < entries.length; index++ )
	{
		let entry = entries[ index ];
		let full_path = LIB_PATH.join( Folder, entry.name );
		if ( entry.isDirectory() )
		{
			find_markdown_files( full_path, Found );
		}
		else if ( entry.name.endsWith( '.md' ) )
		{
			Found.push( full_path );
		}
	}
	return Found;
}


//---------------------------------------------------------------------
// Reads a file as an array of lines. Note that most files here use CRLF endings.
function read_lines( Filename )
{
	return LIB_FS.readFileSync( Filename, 'utf8' ).split( /\r?\n/ );
}


//---------------------------------------------------------------------
// Returns the fenced code blocks of a file, as { Language, Line, Code }.
function find_fences( Filename )
{
	let lines = read_lines( Filename );
	let fences = [];
	let start = -1;
	let language = null;

	for ( let index = 0; index < lines.length; index++ )
	{
		let match = lines[ index ].match( /^\s*```(\w*)\s*$/ );
		if ( match === null ) { continue; }
		if ( start < 0 )
		{
			start = index;
			language = match[ 1 ];
			continue;
		}
		fences.push( {
			Language: language,
			Line: start + 2,
			Code: lines.slice( start + 1, index ).join( '\n' ),
		} );
		start = -1;
		language = null;
	}
	return fences;
}


//---------------------------------------------------------------------
// Returns the link targets found in a file.
function find_links( Filename )
{
	let text = LIB_FS.readFileSync( Filename, 'utf8' );

	// ***A commented-out link is not a link.*** Blanked rather than removed, so that the line
	// numbers below still describe the file on disk. _coverpage.md sets its background with
	// docsify's `![color](#cceeff)` syntax, kept in a comment, which is not a link to an
	// anchor named cceeff - and would be reported as one by every check which reads this.
	text = text.replace( /<!--[\s\S]*?-->/g, function ( Comment )
	{
		return Comment.replace( /[^\n]/g, ' ' );
	} );

	let links = [];
	let expression = /\]\(([^)\s]+)\)/g;
	let match = expression.exec( text );

	// The matches arrive in order, so one cursor walking forward counts the lines for all of
	// them. Counting newlines from the start for each match separately is the obvious way and
	// is quadratic on a page with several hundred links, which the operator pages are.
	let line = 1;
	let cursor = 0;

	while ( match !== null )
	{
		while ( cursor < match.index )
		{
			if ( text[ cursor ] === '\n' ) { line++; }
			cursor++;
		}
		links.push( { Target: match[ 1 ], Line: line } );
		match = expression.exec( text );
	}
	return links;
}


//---------------------------------------------------------------------
// Resolves a link target to a path on disk, or null when it addresses somewhere else.
function resolve_link( Filename, Target )
{
	if ( /^(https?:|mailto:|#)/.test( Target ) ) { return null; }
	let target = decodeURIComponent( Target.split( '#' )[ 0 ] );
	if ( target.length === 0 ) { return null; }
	if ( target.startsWith( '/' ) )
	{
		// Root absolute, the way docsify resolves it.
		let path = target.slice( 1 );
		// Mirror the docsify alias in docs/index.html, which rewrites /docs/(.*) to /$1.
		// A /docs/... link routes within the site as /..., which is docs/... on disk.
		// Without this, /docs/guides/... would look up docs/docs/guides/... and fail.
		if ( path.startsWith( 'docs/' ) ) { path = path.slice( 'docs/'.length ); }
		return LIB_PATH.resolve( DOCS, path );
	}
	return LIB_PATH.resolve( LIB_PATH.dirname( Filename ), target );
}


//---------------------------------------------------------------------
// Every ```js block must parse as Javascript.
function check_fences( Files )
{
	let findings = [];
	let checked = 0;

	for ( let index = 0; index < Files.length; index++ )
	{
		let file = Files[ index ];
		let fences = find_fences( file );
		for ( let fence_index = 0; fence_index < fences.length; fence_index++ )
		{
			let fence = fences[ fence_index ];
			let language = fence.Language.toLowerCase();
			if ( ( language !== 'js' ) && ( language !== 'javascript' ) ) { continue; }
			checked++;
			try
			{
				new LIB_VM.Script( fence.Code );
			}
			catch ( error )
			{
				findings.push( {
					Path: LIB_PATH.relative( REPO, file ),
					Line: fence.Line,
					Detail: error.message.split( '\n' )[ 0 ],
				} );
			}
		}
	}
	return { Checked: checked, Findings: findings, Unit: 'js fences' };
}


//---------------------------------------------------------------------
// Every local link must resolve to a file which exists.
function check_links( Files )
{
	let findings = [];
	let checked = 0;

	for ( let index = 0; index < Files.length; index++ )
	{
		let file = Files[ index ];
		let links = find_links( file );
		for ( let link_index = 0; link_index < links.length; link_index++ )
		{
			let link = links[ link_index ];
			let resolved = resolve_link( file, link.Target );
			if ( resolved === null ) { continue; }
			checked++;
			if ( LIB_FS.existsSync( resolved ) ) { continue; }
			findings.push( {
				Path: LIB_PATH.relative( REPO, file ),
				Line: link.Line,
				Detail: link.Target,
			} );
		}
	}
	return { Checked: checked, Findings: findings, Unit: 'local links' };
}


//---------------------------------------------------------------------
// Derives the id docsify gives a heading.
//
// This mirrors docsify's own slugify rather than inventing one, because the anchor a reader's
// link has to match is the one docsify emits. Lowercase, html removed, every run of anything
// else replaced by a dash, dashes trimmed from the ends, and a leading digit prefixed with an
// underscore because an id may not begin with one.
function heading_slug( Text )
{
	let slug = Text.toLowerCase();
	slug = slug.replace( /<[^>]+>/g, '' );
	slug = slug.replace( /[^a-z0-9\u00c0-\uffff]+/g, '-' );
	slug = slug.replace( /^-+|-+$/g, '' );
	if ( /^[0-9]/.test( slug ) ) { slug = '_' + slug; }
	return slug;
};


//---------------------------------------------------------------------
// The anchors a page offers: its explicit tags, and the slug of every heading.
//
// ***Both heading forms count.*** The operator pages write their entries as setext headings -
// a line of text underlined by dashes - and docsify gives those an id exactly as it does an
// atx '## heading'. Reading only the '#' form would miss every operator entry.
//
// Read once per page and remembered, because a page which is linked to five hundred times is
// otherwise parsed five hundred times.
const ANCHORS_BY_PAGE = {};

function page_anchors( Filename )
{
	if ( typeof ANCHORS_BY_PAGE[ Filename ] !== 'undefined' ) { return ANCHORS_BY_PAGE[ Filename ]; }

	let text = LIB_FS.readFileSync( Filename, 'utf8' );
	let anchors = {};

	let explicit = /<a\s+id=["']([^"']+)["']/g;
	let match = explicit.exec( text );
	while ( match !== null )
	{
		anchors[ match[ 1 ] ] = true;
		match = explicit.exec( text );
	}

	// docsify numbers a repeated slug rather than dropping it, so the second 'Example' heading
	// is 'example-1'. Reproduced here so that a link to one is not reported as missing.
	let seen = {};
	function add_heading( Text )
	{
		let slug = heading_slug( Text );
		if ( slug.length === 0 ) { return; }
		let count = seen[ slug ] || 0;
		seen[ slug ] = count + 1;
		anchors[ ( count === 0 ) ? slug : ( slug + '-' + count ) ] = true;
	};

	let lines = text.split( '\n' );
	let fenced = false;
	for ( let index = 0; index < lines.length; index++ )
	{
		let line = lines[ index ];

		// A '#' inside a fence is a shell comment, not a heading.
		if ( line.trim().startsWith( '```' ) ) { fenced = !fenced; continue; }
		if ( fenced === true ) { continue; }

		let atx = /^#{1,6}\s+(.*)$/.exec( line );
		if ( atx !== null ) { add_heading( atx[ 1 ] ); continue; }

		// A setext heading is a line of text underlined by dashes or equals. A rule is the
		// same thing with nothing above it, and a table divider begins with a pipe.
		if ( /^(-{2,}|={2,})\s*$/.test( line ) === false ) { continue; }
		let above = ( index > 0 ) ? lines[ index - 1 ] : '';
		if ( above.trim().length === 0 ) { continue; }
		if ( above.trim().startsWith( '|' ) ) { continue; }
		if ( above.trim().startsWith( '#' ) ) { continue; }
		add_heading( above );
	}

	ANCHORS_BY_PAGE[ Filename ] = anchors;
	return anchors;
};


//---------------------------------------------------------------------
// Every '#fragment' a link names must exist in the page it points at.
//
// ***The links check cannot see this.*** It resolves the file half of a target and stops, so
// a link to a heading which was never written passes it. That is not hypothetical: the five
// Operator Reference rows flipped for the variable scope family pointed at operator entries
// which had not been written yet, and check-docs stayed green for two commits.
function check_anchors( Files )
{
	let findings = [];
	let checked = 0;

	for ( let index = 0; index < Files.length; index++ )
	{
		let file = Files[ index ];
		let links = find_links( file );

		for ( let link_index = 0; link_index < links.length; link_index++ )
		{
			let link = links[ link_index ];
			let hash = link.Target.indexOf( '#' );
			if ( hash < 0 ) { continue; }

			let fragment = decodeURIComponent( link.Target.slice( hash + 1 ) );
			if ( fragment.length === 0 ) { continue; }

			// A target which is only a fragment names this same page. Docsify reads '#/path'
			// as a route to another page rather than as an anchor, so those are not anchors.
			let target = file;
			if ( hash > 0 )
			{
				let resolved = resolve_link( file, link.Target );
				if ( resolved === null ) { continue; }
				target = resolved;
			}
			else if ( fragment.startsWith( '/' ) ) { continue; }

			if ( target.endsWith( '.md' ) === false ) { continue; }

			// A target file which does not exist is the links check's finding, not this one.
			if ( LIB_FS.existsSync( target ) === false ) { continue; }

			checked++;
			if ( page_anchors( target )[ fragment ] === true ) { continue; }

			findings.push( {
				Path: LIB_PATH.relative( REPO, file ),
				Line: link.Line,
				Detail: `${link.Target} - the page has no anchor [${fragment}].`,
			} );
		}
	}
	return { Checked: checked, Findings: findings, Unit: 'link anchors' };
};


//---------------------------------------------------------------------
// Every page under docs/ must be reachable from another page.
function check_orphans( Files )
{
	let linked = {};
	for ( let index = 0; index < Files.length; index++ )
	{
		let file = Files[ index ];
		let links = find_links( file );
		for ( let link_index = 0; link_index < links.length; link_index++ )
		{
			let resolved = resolve_link( file, links[ link_index ].Target );
			if ( resolved !== null ) { linked[ resolved ] = true; }
		}
	}

	let findings = [];
	let checked = 0;
	for ( let index = 0; index < Files.length; index++ )
	{
		let file = Files[ index ];
		if ( !file.startsWith( DOCS ) ) { continue; }
		if ( ENTRY_POINTS.indexOf( LIB_PATH.basename( file ) ) >= 0 ) { continue; }
		checked++;
		if ( linked[ file ] ) { continue; }
		findings.push( {
			Path: LIB_PATH.relative( REPO, file ),
			Line: 0,
			Detail: 'not linked from any page',
		} );
	}
	return { Checked: checked, Findings: findings, Unit: 'pages' };
}


//---------------------------------------------------------------------
// Every operator must carry an /*md block describing its usage.
//
// Operator-Authoring.md presents this as the convention, and a convention nothing enforces
// drifts: it stood at 56 of 85 operators before this check existed, with two whole kinds of
// operator ignoring it entirely. That is the same lesson `OperatorType` and `ArgCount` taught
// when they were deleted for being declared and never read.
//
// Helper modules, whose names begin with an underscore, are not operators and are skipped.
function check_operator_blocks()
{
	let root = LIB_PATH.join( REPO, 'src', 'Operators' );

	function find_operator_files( Folder, Found )
	{
		let entries = LIB_FS.readdirSync( Folder, { withFileTypes: true } );
		for ( let index = 0; index < entries.length; index++ )
		{
			let entry = entries[ index ];
			let full = LIB_PATH.join( Folder, entry.name );
			if ( entry.isDirectory() ) { find_operator_files( full, Found ); continue; }
			if ( !entry.name.endsWith( '.js' ) ) { continue; }
			if ( entry.name.startsWith( '_' ) ) { continue; }
			Found.push( full );
		}
		return Found;
	}

	let files = find_operator_files( root, [] );
	let findings = [];

	for ( let index = 0; index < files.length; index++ )
	{
		let file = files[ index ];
		let text = LIB_FS.readFileSync( file, 'utf8' );
		if ( text.includes( '/*md' ) ) { continue; }
		findings.push( {
			Path: LIB_PATH.relative( REPO, file ),
			Line: 0,
			Detail: 'operator has no /*md block. See docs/guides/Operator-Authoring.md.',
		} );
	}

	return { Checked: files.length, Findings: findings, Unit: 'operators' };
}


//---------------------------------------------------------------------
// True when a fragment compiles on its own.
function compiles( Text )
{
	try
	{
		new LIB_VM.Script( Text );
		return true;
	}
	catch ( error )
	{
		return false;
	}
}


//---------------------------------------------------------------------
// True when every bracket opened within a fragment has also been closed.
function brackets_balanced( Text )
{
	let depth = 0;
	let in_string = null;
	for ( let index = 0; index < Text.length; index++ )
	{
		let character = Text[ index ];
		if ( in_string !== null )
		{
			if ( character === '\\' ) { index++; continue; }
			if ( character === in_string ) { in_string = null; }
			continue;
		}
		if ( ( character === '\'' ) || ( character === '"' ) || ( character === '`' ) )
		{
			in_string = character;
			continue;
		}
		if ( '([{'.includes( character ) ) { depth++; }
		if ( ')]}'.includes( character ) ) { depth--; }
	}
	return ( depth === 0 );
}


//---------------------------------------------------------------------
// Takes the leading javascript value out of a claim, discarding any prose written after
// it. Returns null when the claim does not begin with a value.
function claim_value( Text )
{
	let text = Text.trim();
	let open = text[ 0 ];
	if ( ( open === '[' ) || ( open === '{' ) )
	{
		let close = ( open === '[' ) ? ']' : '}';
		let depth = 0;
		let in_string = null;
		for ( let index = 0; index < text.length; index++ )
		{
			let character = text[ index ];
			if ( in_string !== null )
			{
				if ( character === '\\' ) { index++; continue; }
				if ( character === in_string ) { in_string = null; }
				continue;
			}
			if ( ( character === '\'' ) || ( character === '"' ) ) { in_string = character; continue; }
			if ( character === open ) { depth++; }
			else if ( character === close )
			{
				depth--;
				if ( depth === 0 ) { return text.slice( 0, index + 1 ); }
			}
		}
		return null;
	}
	if ( ( open === '\'' ) || ( open === '"' ) )
	{
		let end = text.indexOf( open, 1 );
		if ( end < 0 ) { return null; }
		return text.slice( 0, end + 1 );
	}
	let token = text.split( /[\s,]/ )[ 0 ];
	if ( /^(-?[0-9.]+|true|false|null|undefined|NaN|Infinity)$/.test( token ) ) { return token; }
	return null;
}


//---------------------------------------------------------------------
// Splits a fence into statements, each paired with the comment which claims something
// about it. A claim is written after the statement, or above it for a refusal.
function fence_statements( Code )
{
	let lines = Code.split( '\n' );
	let statements = [];
	let buffer = '';
	let pending = null;

	for ( let index = 0; index < lines.length; index++ )
	{
		let line = lines[ index ];
		let bare = line.trim();
		if ( bare === '' ) { continue; }
		if ( bare.startsWith( '//' ) )
		{
			if ( ( statements.length > 0 ) && ( buffer === '' ) && !statements[ statements.length - 1 ].Claim )
			{
				statements[ statements.length - 1 ].Claim = bare;
				continue;
			}
			if ( /^\/\/\s*throws/i.test( bare ) && ( buffer === '' ) ) { pending = bare; }
			continue;
		}

		buffer += ( buffer ? '\n' : '' ) + line;

		// Balanced brackets are not enough: `module.exports = function ( x )` balances
		// before its body has been seen. A statement is finished when it also compiles.
		if ( brackets_balanced( buffer ) && compiles( buffer ) )
		{
			let claim = pending;
			let trailing = buffer.match( /\s*(\/\/[^\n]*)$/ );
			if ( trailing !== null ) { claim = trailing[ 1 ].trim(); }
			statements.push( { Code: buffer, Claim: claim } );
			buffer = '';
			pending = null;
		}
	}
	return statements;
}


//---------------------------------------------------------------------
// Every ```js block is executed and the claims its comments make are checked.
function check_examples( Files )
{
	let findings = [];
	let checked = 0;

	for ( let file_index = 0; file_index < Files.length; file_index++ )
	{
		let file = Files[ file_index ];
		let relative = LIB_PATH.relative( REPO, file );
		let fences = find_fences( file );
		let claims = [];
		let parts = [];

		for ( let fence_index = 0; fence_index < fences.length; fence_index++ )
		{
			let fence = fences[ fence_index ];
			let language = fence.Language.toLowerCase();
			if ( ( language !== 'js' ) && ( language !== 'javascript' ) ) { continue; }
			if ( fence.Code.includes( 'docs-check: skip' ) ) { continue; }

			let statements = fence_statements( fence.Code );
			for ( let index = 0; index < statements.length; index++ )
			{
				let statement = statements[ index ];
				let code = statement.Code.replace( /\/\/.*$/gm, '' ).trim().replace( /;$/, '' ).trim();
				if ( code === '' ) { continue; }
				let claim = statement.Claim || '';
				let label = code.split( '\n' )[ 0 ].trim();

				// A declaration whose initializer is documented to throw is a claim, not code
				// to run: `let x = jsongin.Flatten( 3.14 );  // throws`.
				if ( /^\/\/\s*throws/i.test( claim ) )
				{
					let expression = code.replace( /^(let|const|var)\s+[A-Za-z_$][\w$]*\s*=\s*/, '' );
					claims.push( { Line: fence.Line, Label: label } );
					parts.push( `__expect_throw( ${claims.length - 1}, function () { return ( ${expression} ); } );` );
					continue;
				}
				// Any other declaration is code to keep in scope, never a claim to check.
				if ( /^(let|const|var|function|class)\s/.test( code ) )
				{
					parts.push( statement.Code );
					continue;
				}
				let returns = claim.match( /^\/\/\s*returns\s+(.+)$/ );
				let value = returns ? claim_value( returns[ 1 ] ) : null;
				if ( value !== null )
				{
					claims.push( { Line: fence.Line, Label: label } );
					parts.push( `__expect_value( ${claims.length - 1}, function () { return ( ${code} ); }, function () { return ( ${value} ); } );` );
					continue;
				}
				// A statement which opens with a keyword is not an expression, so it cannot be
				// wrapped in a return even when its condition happens to contain an ===.
				let is_statement = /^(if|for|while|switch|try|do|return|throw)\b/.test( code );
				if ( code.includes( ' === ' ) && !is_statement )
				{
					claims.push( { Line: fence.Line, Label: label } );
					parts.push( `__expect_true( ${claims.length - 1}, function () { return ( ${code} ); } );` );
					continue;
				}
				parts.push( statement.Code.replace( /$/, ';' ) );
			}
		}

		if ( parts.length === 0 ) { continue; }

		// The fences of a page share their declarations, and a page may declare the same
		// name twice, so let/const become var.
		let script = parts.join( '\n' ).replace( /^(\s*)(let|const)\s/gm, '$1var ' );

		function note( Index, Detail )
		{
			findings.push( {
				Path: relative,
				Line: claims[ Index ].Line,
				Detail: `${claims[ Index ].Label}  ${Detail}`,
			} );
		}
		function __expect_true( Index, Fn )
		{
			checked++;
			let result = null;
			try { result = Fn(); }
			catch ( error ) { note( Index, `threw: ${error.message}` ); return; }
			if ( result !== true ) { note( Index, `is ${JSON.stringify( result )}, not true` ); }
		}
		function __expect_value( Index, Fn, ExpectedFn )
		{
			checked++;
			let result = null;
			let expected = null;
			try { result = Fn(); }
			catch ( error ) { note( Index, `threw: ${error.message}` ); return; }
			try { expected = ExpectedFn(); }
			catch ( error ) { note( Index, `the claim does not evaluate: ${error.message}` ); return; }
			if ( JSON.stringify( result ) !== JSON.stringify( expected ) )
			{
				note( Index, `returns ${JSON.stringify( result )}, claimed ${JSON.stringify( expected )}` );
			}
		}
		function __expect_throw( Index, Fn )
		{
			checked++;
			try { Fn(); }
			catch ( error ) { return; }
			note( Index, 'did not throw' );
		}
		function doc_require( Name )
		{
			// A page may show the require() a reader would write.
			if ( String( Name ).includes( 'jsonproc' ) ) { return LIB_JSONPROC; }
			if ( String( Name ).includes( 'jsongin' ) ) { return LIB_JSONGIN; }
			return require( Name );
		}

		// An example may print, and a page which demonstrates the OpLog certainly does.
		// That output belongs to the example, not to this report.
		let real_log = console.log;
		let real_error = console.error;
		try
		{
			console.log = function () { };
			console.error = function () { };
			let run = new Function( 'jsonproc', 'jsongin', 'require', '__expect_true', '__expect_value', '__expect_throw', script );
			run( LIB_JSONPROC, LIB_JSONGIN, doc_require, __expect_true, __expect_value, __expect_throw );
		}
		catch ( error )
		{
			findings.push( {
				Path: relative,
				Line: null,
				Detail: `the page's examples could not run: ${error.message}`,
			} );
		}
		finally
		{
			console.log = real_log;
			console.error = real_error;
		}
	}
	return { Checked: checked, Findings: findings, Unit: 'example claims' };
}


//---------------------------------------------------------------------
function report( Name, Result )
{
	let count = Result.Findings.length;
	let status = ( count === 0 ) ? 'ok' : 'FAILED';
	console.log( `${Name.padEnd( 10 )} ${String( Result.Checked ).padStart( 4 )} ${Result.Unit.padEnd( 12 )} ${status}` );
	if ( count === 0 ) { return 0; }

	let shown = VERBOSE ? count : Math.min( count, PREVIEW_COUNT );
	for ( let index = 0; index < shown; index++ )
	{
		let finding = Result.Findings[ index ];
		let where = finding.Line ? `${finding.Path}:${finding.Line}` : finding.Path;
		console.log( `             ${where}` );
		console.log( `               ${finding.Detail}` );
	}
	if ( shown < count )
	{
		console.log( `             ... and ${count - shown} more. Run with --verbose to see them all.` );
	}
	return count;
}


//---------------------------------------------------------------------
function main()
{
	// Templates are excluded. They are generated into place, so their links are checked
	// where the generated file lands rather than where the template sits.
	let doc_files = find_markdown_files( DOCS ).filter(
		function ( Filename ) { return !Filename.startsWith( TEMPLATES ); } );

	let root_files = LIB_FS.readdirSync( REPO )
		.filter( function ( Name ) { return Name.endsWith( '.md' ); } )
		.map( function ( Name ) { return LIB_PATH.join( REPO, Name ); } );

	let all_files = doc_files.concat( root_files );

	console.log( '' );
	let failures = 0;
	failures += report( 'fences', check_fences( all_files ) );
	failures += report( 'links', check_links( all_files ) );
	failures += report( 'anchors', check_anchors( all_files ) );
	failures += report( 'orphans', check_orphans( doc_files ) );
	failures += report( 'operators', check_operator_blocks() );
	failures += report( 'examples', check_examples( all_files ) );
	console.log( '' );

	if ( failures > 0 )
	{
		console.log( `${failures} problem(s) found.` );
		process.exit( 1 );
	}
	console.log( 'Documentation checks passed.' );
	return;
}


main();
