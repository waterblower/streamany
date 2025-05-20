import { Head } from "$fresh/runtime.ts";
import { Handlers, PageProps } from "$fresh/server.ts";
import { get_relay_config } from "../../../core/relay.ts";
import { RestreamConfig } from "../islands/Restream.tsx";

// Define the data structure
export interface Item {
    server: string;
    key: string;
}

export const handler: Handlers<Item[]> = {
    async GET(req, ctx) {
        const data = await get_relay_config()
        // Render the page with the data
        return ctx.render(data);
    },
};

export default function Home({ data }: PageProps<Item[]>) {
    return (
        <div class="fixed h-full w-full flex items-center justify-center">
            <RestreamConfig data={data}></RestreamConfig>
        </div>
    );
}
