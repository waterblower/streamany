import { h } from "nano-jsx";

type Item = {
    server: string;
    key: string;
};

export function UI(
    item1: Item,
    item2: Item,
    ffmpeg_process: Deno.ChildProcess | undefined | Error,
) {
    console.log(item1, item2, ffmpeg_process);
    return (
        <html>
            <head>
                <meta charset="UTF-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0"
                />
                <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">
                </script>
            </head>
            <body>
                <div class="text-3xl">
                    <ServerItem {...item1} id={1}></ServerItem>
                    <ServerItem {...item2} id={2}></ServerItem>
                </div>
                {ffmpeg_process instanceof Deno.ChildProcess
                    ? <div>running</div>
                    : undefined}
                {ffmpeg_process instanceof Error
                    ? <div>{ffmpeg_process.message}</div>
                    : undefined}
                {ffmpeg_process == undefined
                    ? (
                        <form action="/start">
                            <button class="m-4 border">
                                <input type="submit" value="开启转播" />
                            </button>
                        </form>
                    )
                    : undefined}
            </body>
        </html>
    );
}

function ServerItem(d: { id: 1 | 2; server: string; key: string }) {
    return (
        <form
            action={d.id}
            method="post"
            class="form-example"
        >
            <div class="m-4">
                <label for="server">Server</label>
                <input
                    type="text"
                    name="server"
                    class="border"
                    required
                    value={d.server}
                />
            </div>
            <div class="m-4">
                <label for="key">Stream Key</label>
                <input
                    type="text"
                    name="key"
                    class="border"
                    required
                    value={d.key}
                />
            </div>
            <button class="m-4 border">
                <input type="submit" value="确定" />
            </button>
        </form>
    );
}

