import { run_ffmpeg, setup_ffmpeg_binary } from "../core/relay.ts";
import { parseArgs } from "jsr:@std/cli/parse-args";

const item1: {
    server: string;
    key: string;
} = {
    server: "",
    key: "",
};

const item2: {
    server: string;
    key: string;
} = {
    key: "",
    server: "",
};

// parse cli arguments
const cli_args = parseArgs(Deno.args);
console.log("cli args", cli_args);

const config_path = cli_args["c"] as string;
if (!config_path) {
    console.error("-c config is not provided");
    Deno.exit(1);
}
const config_file = await Deno.readTextFile(config_path);
const config_obj = JSON.parse(config_file) as { server: string; key: string }[];

//
const ffmpeg_path = await setup_ffmpeg_binary();
const child_process = await run_ffmpeg(ffmpeg_path, config_obj);
if (child_process instanceof Error) {
    console.error(child_process);
    Deno.exit(1);
}

const status = await child_process.status;
console.log(status.code, status.success, status.signal);
