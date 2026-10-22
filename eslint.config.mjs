import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // electron/ is the Mac app's main process: CommonJS by design, run by Electron rather than built by Next.
  globalIgnores([".next/**", "out/**", "build/**", "release/**", "electron/**", "next-env.d.ts"]),
]);
