module.exports =
{
	entry: './src/jsonproc.js',
	mode: 'production',
	output: {
		path: __dirname,
		filename: `../dist/jsonproc.min.js`,

		library: 'jsonproc',
		libraryTarget: 'umd',

		// Fix to get umd to work; see: https://github.com/webpack/webpack/issues/6784
		globalObject: 'typeof self !== \'undefined\' ? self : this',

	},

	// This bundle is the browser artifact advertised by readme.md and Usage-Browser.md,
	// so it is built for the web.
	target: 'web',

	// ***jsongin is not bundled.***
	//
	// A page which loaded a jsonproc bundle with jsongin baked into it, alongside the jsongin
	// bundle it already uses, would hold two engines. The operator registries belong to an
	// instance, so an operator the page registered through window.jsongin would be invisible
	// to the engine a process evaluates against - which is the same trap jsongin's own browser
	// block was written to avoid.
	//
	// So the bundle keeps the require and resolves it to the global jsongin publishes. A page
	// loads jsongin.min.js first; see docs/guides/Usage-Browser.md.
	externals: {
		'@liquicode/jsongin': {
			root: 'jsongin',
			commonjs: '@liquicode/jsongin',
			commonjs2: '@liquicode/jsongin',
			amd: '@liquicode/jsongin',
		},
	},
};
