'use strict';

//---------------------------------------------------------------------
// The browser bundle's size, read from the file rather than remembered. publish_version
// runs webpack before build_docs, so a release always reports the bundle it is shipping.
// A missing bundle is not an error: the docs still have to build in a fresh clone.
//
// ***The number lags one build behind when build_docs runs webpack itself***, because this
// is measured at module load, before any task runs. jsongin's build has the same property
// and the same cause; the fix, if it is ever worth it, is to run webpack in a separate
// process ahead of the docs build.
const BUNDLE_SIZE = measure_bundle_size();

function measure_bundle_size()
{
	const LIB_FS = require( 'fs' );
	const LIB_PATH = require( 'path' );
	const LIB_ZLIB = require( 'zlib' );

	let filename = LIB_PATH.resolve( __dirname, '..', 'dist', 'jsonproc.min.js' );
	if ( !LIB_FS.existsSync( filename ) ) { return { Kb: 0, CompressedKb: 0 }; }

	let content = LIB_FS.readFileSync( filename );
	let compressed = LIB_ZLIB.gzipSync( content, { level: 9 } );

	// A CDN serves the bundle compressed, so both numbers are worth saying.
	return {
		Kb: Math.round( content.length / 1000 ),
		CompressedKb: Math.round( compressed.length / 1000 ),
	};
}


module.exports = {

	Context: {
		Package: require( '../package.json' ),
		Bundle: BUNDLE_SIZE,
		AWS_ProfileName: 'admin',
		AWS_BucketName: 'jsonproc.liquicode.com',
	},

	run_tests: [

		// Run tests and capture the output.
		// Runs the unit tests and the invariant check as two separate invocations, each
		// with its own heading and summary. The shared script is also what `npm test`
		// runs, so the two stay in sync.
		{
			$Shell: {
				command: 'node build/run-tests.js',
				out: { filename: 'tests.md' },
				err: { console: true },
			}
		},
		{ $PrependTextFile: { filename: 'tests.md', value: '# ${Package.name}\n\n> Version: ${Package.version}\n\n# Test Results\n' } },

	],

	build_docs: [

		// Generate: _coverpage.md
		{
			$ExecuteEjs: {
				ejs_file: 'docs/templates/_coverpage.md',
				use_eval: true,
				out: { filename: 'docs/_coverpage.md' },
			}
		},

		// Generate: readme.md
		{
			$ExecuteEjs: {
				ejs_file: 'docs/templates/readme.md',
				use_eval: true,
				out: { filename: 'readme.md' },
			}
		},

		// Generate: version.md
		{
			$ExecuteEjs: {
				ejs_string: '<%- Context.Package.version %>',
				use_eval: true,
				out: { filename: 'version.md' },
			}
		},

		// Copy other files to the docs external area.
		{ $EnsureFolder: { folder: 'docs/external' } },
		{ $CopyFile: { from: 'readme.md', to: 'docs/external/readme.md' } },
		{ $CopyFile: { from: 'version.md', to: 'docs/external/version.md' } },
		{ $CopyFile: { from: 'license.md', to: 'docs/external/license.md' } },
		{ $CopyFile: { from: 'history.md', to: 'docs/external/history.md' } },
		{ $CopyFile: { from: 'tests.md', to: 'docs/external/tests.md' } },

		// Rebuild the browser bundle, so that the size reported by the next build is the
		// size of the code this one is describing.
		{ $RunTask: { task: 'run_webpack' } },

		// Check the generated docs.
		// Halts the build on a code fence which does not parse, a link which does not
		// resolve, or a page which nothing links to.
		{
			$Shell: {
				command: 'node build/docs-check.js',
				out: { console: true },
				err: { console: true },
			}
		},

	],

	run_webpack: [

		// Run webpack.
		// Halts on error. This is the first step of publish_version, so a bundle which
		// fails to build must stop the release rather than let the previous bundle ship
		// against a new version number.
		{
			$Shell: {
				command: 'npx webpack-cli --config build/webpack.config.js',
				out: { console: true },
				err: { console: true },
			}
		},

	],

	update_aws_docs: [

		// Update aws s3 bucket with package docs.
		// The tilde excludes keep any local-only file out of the published site, the way
		// `.gitignore` keeps it out of source control. `aws s3 sync` reads neither
		// `.gitignore` nor anything like it, so this has to be said here. The first
		// pattern covers a nested file, the second one at the top.
		{
			$Shell: {
				command: 'set "AWS_PROFILE=${AWS_ProfileName}" & aws s3 sync docs s3://${AWS_BucketName} --exclude "*/~*" --exclude "~*"',
				out: { console: true },
				err: { console: true },
			},
		},

	],

	npm_publish_version: [

		// Update npmjs.com with new package.
		{
			$Shell: {
				command: 'npm publish . --access public',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},

	],

	git_publish_version: [

		// Update github and finalize the version.
		{
			$Shell: {
				command: 'git add .',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},
		{
			$Shell: {
				command: 'git commit --quiet -m "Finalization for v${Package.version}"',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},
		{
			$Shell: {
				command: 'git push --quiet origin main',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},
		// Tag the existing version
		{
			$Shell: {
				command: 'git tag -a v${Package.version} -m "Version v${Package.version}"',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},
		{
			$Shell: {
				command: 'git push --quiet origin v${Package.version}',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},

	],

	publish_version: [

		// Finalize and publish the existing version.
		{ $RunTask: { task: 'run_webpack' } },
		{ $RunTask: { task: 'run_tests' } },
		{ $RunTask: { task: 'build_docs' } },
		{ $RunTask: { task: 'update_aws_docs' } },
		{ $RunTask: { task: 'git_publish_version' } },
		{ $RunTask: { task: 'npm_publish_version' } },

	],

	start_new_version: [

		// Increment and update the official package version.
		{ $SemverInc: { context: 'Package.version' } },
		{
			$PrintContext: {
				context: 'Package',
				out: { as: 'json-friendly', filename: 'package.json' },
			}
		},

		// Reload the package file.
		{
			$ReadJsonFile: {
				filename: 'package.json',
				out: { context: 'Package' },
			}
		},

		// Rebuild the docs.
		{ $RunTask: { task: 'build_docs' } },

		// Update github with the new version.
		{
			$Shell: {
				command: 'git add .',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},
		{
			$Shell: {
				command: 'git commit --quiet -m "Initialization for v${Package.version}"',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},
		{
			$Shell: {
				command: 'git push --quiet origin main',
				out: { console: true },
				err: { console: true },
				halt_on_error: false
			}
		},

	],

};
