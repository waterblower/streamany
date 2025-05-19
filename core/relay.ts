import * as path from "jsr:@std/path";

import { UI } from "../ui.tsx";
import { renderSSR } from "nano-jsx";

import { open } from "https://deno.land/x/open/index.ts";

// Opens the image in the default image viewer and waits for the opened app to quit.

const VERSION = "0.0.1";
const ffmpeg = await Deno.readFile(
    path.join(import.meta.dirname || "./", "/../assets/ffmpeg-mac"),
);

console.debug("deno executable:", Deno.execPath());

let ffmpeg_process: Deno.ChildProcess | undefined | Error;

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

const CONFIG_DIR = ".streamany-config";
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

async function run_ffmpeg(data: {
    server: string;
    key: string;
}[]) {
    if (data.length == 0) {
        return new Error("no server list");
    }

    const ffmpeg_path = path.join(config_path, "ffmpeg");
    await Deno.writeFile(ffmpeg_path, ffmpeg, {
        mode: 0o777,
    });

    const args = [
        "-listen",
        "1",
        "-i",
        "rtmp://localhost:1935/live",
        // "-c",
        // "copy",
        // "-f",
        // "flv",
        // "rtmp://a.rtmp.youtube.com/live2/6xxz-w4tg-qpqs-p17g-6mcr",
    ];

    for (const item of data) {
        args.push("-c", "copy", "-f", "flv", `${item.server}/${item.key}`);
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

const server = Deno.serve(async (req) => {
    const url = new URL(req.url);
    console.log(req.url, req.method, url.pathname);
    if (req.method == "POST") {
        const form = await req.formData();
        console.log(form);
        const server = form.get("server");
        const key = form.get("key");

        if (url.pathname == "/1") {
            console.log("setting item1");
            item1.server = server!.toString();
            item1.key = key!.toString();
        } else if (url.pathname == "/2") {
            console.log("setting item2");
            item2.server = server!.toString();
            item2.key = key!.toString();
        }
    } else if (req.method == "GET") {
        if (url.pathname == "/start") {
            if (ffmpeg_process == undefined) {
                ffmpeg_process = await run_ffmpeg([item1, item2]);
            }
        }
    }
    const ssr = renderSSR(() => {
        const d = UI(item1, item2, ffmpeg_process);
        return d;
    });
    // console.log(ssr);
    return new Response(ssr, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
        },
    });
});

// Opens the URL in the default browser.
await open("http://localhost:8000");
