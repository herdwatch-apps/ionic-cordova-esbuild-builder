/** A script the app lists in its `scripts` option, grouped by the bundle name it is emitted under. */
export interface GlobalScriptsByBundleName {
  bundleName: string;
  paths: string[];
  inject: boolean;
}
