// Copies Excalidraw fonts into the build so drawings work offline.
import { cpSync } from "node:fs";
cpSync("node_modules/@excalidraw/excalidraw/dist/prod/fonts", "dist/fonts", { recursive: true });
console.log("fonts copied to dist/fonts");
