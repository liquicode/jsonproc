# @liquicode/jsonproc


# Browser Usage

`dist/jsonproc.min.js` is a UMD bundle of the library.

***It does not contain jsongin.*** Load `jsongin.min.js` first.
The bundle uses the `jsongin` global, so both libraries share one engine.


## Load from UNPKG

```html
<script
  type="text/javascript"
  src="https://unpkg.com/@liquicode/jsongin@latest/dist/jsongin.min.js"
></script>
<script
  type="text/javascript"
  src="https://unpkg.com/@liquicode/jsonproc@latest/dist/jsonproc.min.js"
></script>
```

To use a specific version, put it in the URL:

```html
<script
  type="text/javascript"
  src="https://unpkg.com/@liquicode/jsongin@0.1.0/dist/jsongin.min.js"
></script>
<script
  type="text/javascript"
  src="https://unpkg.com/@liquicode/jsonproc@0.1.0/dist/jsonproc.min.js"
></script>
```

> ***Order matters.*** If `jsonproc.min.js` loads before jsongin, it loads without an error, but
  its runtime has no engine and the first call throws.


## Use it in a Page

The script defines two globals for the same runtime:

```html
<script>
  var jsonproc = window.jsonproc;
  // or
  var jsonproc = window.liquicode.jsonproc;

  console.log( 'Loaded: ' + jsonproc.Library.name + ', v' + jsonproc.Library.version );
</script>
```

This runtime has logging turned off.


## Create a Runtime with Settings

In the browser, `NewJsonproc( Settings )` is at `window.liquicode.NewJsonproc`:

```html
<script>
  var jsonproc = window.liquicode.NewJsonproc( {
    jsongin: window.jsongin,
    OpLog: console.log,
    OpError: console.error,
  } );
</script>
```


## See Also

- [NodeJS Usage](./Usage-NodeJS.md)
- [Library Guide](./Library-Guide.md)
