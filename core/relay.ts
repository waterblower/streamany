import * as path from "jsr:@std/path";
import { exec } from "https://deno.land/x/exec/mod.ts";


const VERSION = "0.0.1";
const ffmpeg = await Deno.readFile(
    path.join(import.meta.dirname || "./", "/../assets/ffmpeg-mac"),
);

const CONFIG_DIR = ".streamany-config";

export async function setup_ffmpeg_binary() {
    const config_path = path.join(Deno.env.get("HOME") || "~", CONFIG_DIR);
    try {
        await Deno.mkdir(config_path);
    } catch (e) {
        /** could be
            {
                name: "AlreadyExists",
                code: "EEXIST"
            }
         */
        if (e instanceof Error && e.name == "AlreadyExists") {
            // pass
        } else {
            console.error(e);
        }
    }

    const ffmpeg_path = path.join(config_path, "ffmpeg");
    await Deno.writeFile(ffmpeg_path, ffmpeg, {
        mode: 0o777,
    });
    console.log("successfully setup ffmpeg at", ffmpeg_path)
    await exec(`ls -l ${ffmpeg_path}`);
    return ffmpeg_path
}

export async function run_ffmpeg(ffmpeg_path: string, data: Item[]) {
    if (data.length == 0) {
        return new Error("no server list");
    }

    const args = [
        "-listen",
        "1",
        "-i",
        "rtmp://localhost:1935/live",
    ];

    for (const item of data) {
        if(item.server) {
            const url = parseURL(item.server)
            if(url instanceof URL && url.protocol == "rtmp:") {
                args.push("-c", "copy", "-f", "flv", `${item.server}/${item.key}`);
            }
        }
    }

    const ffmpeg_command = new Deno.Command(ffmpeg_path, {
        args,
        stdin: "piped",
        stdout: "inherit",
    });
    const ffmpeg_process = ffmpeg_command.spawn();

    // open a file and pipe the subprocess output to it.

    // manually close stdin
    ffmpeg_process.stdin.close();
    return ffmpeg_process;
}

type Item = {
    server: string,
    key: string
}

export async function get_relay_config() {
    const kv = await Deno.openKv();

    // Fetch data from KV store
    // This example fetches all entries with the prefix "restream:"
    const server1 = await kv.get<string>(["item1", "server"]);
    const key1 = await kv.get<string>(["item1", "key"]);

    const server2 = await kv.get<string>(["item2", "server"]);
    const key2 = await kv.get<string>(["item2", "key"]);

    const server3 = await kv.get<string>(["item3", "server"]);
    const key3 = await kv.get<string>(["item3", "key"]);

    // Process the entries
    const data: Item[] = [{
        server: server1.value || "",
        key: key1.value || "",
    }, {
        server: server2.value || "",
        key: key2.value || "",
    }, {
        server: server3.value || "",
        key: key3.value || "",
    }];

    kv.close();
    return data
}

function parseURL(url: string) {
    try {
        return new URL(url)
    } catch (e) {
        return e as Error
    }
}
