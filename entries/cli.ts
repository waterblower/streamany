import { run_ffmpeg } from "../core/relay.ts";
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

const cli_args = parseArgs(Deno.args);
console.log("cli args", cli_args);

const config_path = cli_args["c"] as string;
const config_file = await Deno.readTextFile(config_path);
const config_obj = JSON.parse(config_file) as { server: string; key: string }[];

const child_process = await run_ffmpeg(config_obj);
if (child_process instanceof Error) {
    console.error(child_process);
    Deno.exit(1);
}

const status = await child_process.status;
console.log(status.code, status.success, status.signal);
