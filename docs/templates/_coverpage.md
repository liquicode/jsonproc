<!-- _coverpage.md -->

# <%- Context.Package.name %> <small>(v<%- Context.Package.version %>)</small>

<hr>

> <%- Context.Package.description %>

> Define a process as JSON, run it a step at a time, store it half-finished, and pick it up
  somewhere else.

<hr>

<div class="cover-features">
	<ul class="cover-feature-list">
		<li>A process is a JSON document. A run is a JSON value.</li>
		<li>The runtime holds nothing between calls.</li>
		<li>A run can be written down and read back, exactly.</li>
		<li>Eight invariants, checked on every step of every fixture.</li>
		<li>Expressions and queries are MongoDB's, by way of jsongin.</li>
		<li>Nothing throws. A failure is a run you can look at.</li>
	</ul>
</div>

<hr>

[GitHub](https://github.com/liquicode/jsonproc)
[NPM](https://www.npmjs.com/package/@liquicode/jsonproc)
[Get Started](external/readme.md)
