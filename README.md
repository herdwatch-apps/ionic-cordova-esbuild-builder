# @herdwatch/ionic-cordova-esbuild-builder

An Angular builder, `cordova-serve-esbuild`, that runs the esbuild (`@angular/build`) dev server with Cordova assets, so live reload works in a Cordova app built with the esbuild application builder.

It is the builder from [ionic-team/angular-toolkit#529](https://github.com/ionic-team/angular-toolkit/pull/529) (which adds `cordova-serve-esbuild` next to the webpack-based `cordova-serve`), kept here on its own because that pull request has not been merged. Only the builder and the two helpers it needs are carried; the webpack builders and schematics of `@ionic/cordova-builders` are not. Licence: MIT, as upstream (see `LICENSE`, copyright Ionic).

## Use

```json
"ionic-cordova-serve": {
  "builder": "@herdwatch/ionic-cordova-esbuild-builder:cordova-serve-esbuild",
  "options": { "cordovaBuildTarget": "app:ionic-cordova-build", "devServerTarget": "app:serve" }
}
```

The options are in `src/cordova-serve-esbuild/schema.json`. Needs Angular 21 (`@angular/build`).

## Publishing

A push to `main` publishes to npm (`.github/workflows/publish.yaml`, OIDC trusted publishing): raise `version` in `package.json` first, or the publish fails on a version that already exists.
