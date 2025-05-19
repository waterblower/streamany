import * as path from "jsr:@std/path";

// Opens the image in the default image viewer and waits for the opened app to quit.

const VERSION = "0.0.1";
const ffmpeg = await Deno.readFile(
    path.join(import.meta.dirname || "./", "/../assets/ffmpeg-mac"),
);

console.debug("deno executable:", Deno.execPath());

let ffmpeg_process: Deno.ChildProcess | undefined | Error;

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

export async function run_ffmpeg(data: {
    server: string;
    key: string;
}[]) {
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
        const url = new URL(`${item.server}/${item.key}`);
        if (url.protocol != "rtmp:") {
            return new Error(`${item.server} protocol is not rtmp`);
        }
        args.push("-c", "copy", "-f", "flv", url.toString());
    }

    const ffmpeg_path = path.join(config_path, "ffmpeg");
    await Deno.writeFile(ffmpeg_path, ffmpeg, {
        mode: 0o777,
    });

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
