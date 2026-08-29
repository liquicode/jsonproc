# @liquicode/jsonproc


# Browser Usage

The `dist/jsonproc.min.js` file is a UMD bundle of the entire library.

***jsongin is not inside it.***
The bundle keeps its `require` and resolves it to the global `jsongin` publishes, so a page
  loads the two scripts in order and both libraries then share ***one*** engine.
Bundling a copy would have given the page two engines, and an operator registered through one
  would have been invisible to the other.


## Include jsonproc using UNPKG

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

To pin a version rather than tracking the latest, name it in the URL:

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

> ***Order matters.*** `jsonproc.min.js` reads `window.jsongin` as it loads, so a page which
  loads it first gets an undefined engine rather than an error which says so.


## Use jsonproc in your Page

Loading the script defines two globals.
Both refer to the same library and you can use whichever you prefer.

```html
<script>
  // The library's own namespace:
  var jsonproc = window.liquicode.jsonproc;

  // Or the bundle's global, which is the same instance:
  var jsonproc = window.jsonproc;

  console.log( 'Loaded: ' + jsonproc.Library.name + ', v' + jsonproc.Library.version );
</script>
```

Both of these are ready-to-use instances with logging turned off.


## Create an Instance with Custom Settings

To configure the runtime, use the `NewJsonproc( Settings )` factory method.
In the browser it is found at `window.liquicode.NewJsonproc`.

```html
<script>
  var jsonproc = window.liquicode.NewJsonproc( {
    jsongin: window.liquicode.jsongin,
    OpLog: console.log,
    OpError: console.error,
  } );
</script>
```


## See Also

- [NodeJS Usage](./Usage-NodeJS.md)
- [Library Guide](./Library-Guide.md)
