/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />

import "$std/dotenv/load.ts";
import { setup_ffmpeg_binary } from "../../core/relay.ts";

import { start } from "$fresh/server.ts";
import manifest from "./fresh.gen.ts";
import config from "./fresh.config.ts";

console.log("before start");
const ffmpeg_path = await setup_ffmpeg_binary();

await start(manifest, config);
console.log("after start");
