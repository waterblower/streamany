import { Signal, useSignal } from "@preact/signals";
import { PageProps } from "$fresh/server.ts";
import { Item } from "../routes/restream.tsx";

export function RestreamConfig(props: { data: Item[] }) {
    const item1 = useSignal(props.data[0]);
    const item2 = useSignal(props.data[1]);
    const item3 = useSignal(props.data[2]);
    const relayIsRunning = useSignal(false);

    return (
        <div class="bg-white rounded-xl shadow-lg p-8 w-full max-w-lg">
            <h1 class="text-2xl font-semibold text-center text-blue-700 mb-8">
                转播配置
            </h1>

            <div>
                <h2 class="text-lg font-medium text-blue-700 mb-3">
                    平台1
                </h2>
                <ServerAndKey item={item1} />

                <div class="border-t border-gray-100 my-8"></div>

                <h2 class="text-lg font-medium text-blue-700 mb-3">
                    平台2
                </h2>
                <ServerAndKey item={item2} />

                <div class="border-t border-gray-100 my-8"></div>

                <h2 class="text-lg font-medium text-blue-700 mb-3">
                    平台3
                </h2>
                <ServerAndKey item={item3} />

                <button
                    onClick={submitTheForm([
                        item1.value,
                        item2.value,
                        item3.value,
                    ])}
                    class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md transition duration-300 ease-in-out transform hover:-translate-y-1 hover:shadow-md mt-6"
                >
                    保存
                </button>
                <button
                    disabled={relayIsRunning.value == true}
                    onClick={startTheRelay([
                        item1.value,
                        item2.value,
                        item3.value,
                    ], relayIsRunning)}
                    class={`w-full bg-blue-600
                        text-white font-medium py-3 px-4 rounded-md
                        transition duration-300 ease-in-out transform
                        mt-6 ${
                        relayIsRunning.value
                            ? ""
                            : "hover:-translate-y-1 hover:shadow-md hover:bg-blue-700"
                    }`}
                >
                    开启转播器
                </button>
            </div>
        </div>
    );
}

function ServerAndKey(props: { item: Signal<Item> }) {
    return (
        <div class="flex flex-col md:flex-row gap-4 mb-6">
            <div class="flex-1">
                <label class="block text-gray-600 font-medium mb-2">
                    直播地址
                </label>
                <input
                    type="text"
                    required
                    value={props.item.value.server}
                    onInput={(e) => {
                        console.log(e);
                        props.item.value = {
                            // @ts-ignore
                            server: e.target.value,
                            key: props.item.value.key,
                        };
                    }}
                    class="w-full px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
            </div>
            <div class="flex-1">
                <label class="block text-gray-600 font-medium mb-2">
                    直播码
                </label>
                <input
                    value={props.item.value.key}
                    onInput={(e) => {
                        props.item.value = {
                            server: props.item.value.server,
                            // @ts-ignore
                            key: e.target.value,
                        };
                    }}
                    type="text"
                    required
                    class="w-full px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
            </div>
        </div>
    );
}

const submitTheForm = (data: Item[]) => async () => {
    await fetch("/api/save_restream_config", {
        method: "POST",
        body: JSON.stringify({
            item1: data[0],
            item2: data[1],
            item3: data[2],
        }),
    });
};

const startTheRelay =
    (data: Item[], relayIsRunning: Signal<boolean>) => async () => {
        const res = await fetch("/api/startTheRelay", {
            method: "POST",
            body: JSON.stringify({
                item1: data[0],
                item2: data[1],
                item3: data[2],
            }),
        });
        if (res.status != 200) {
            relayIsRunning.value = false;
        }
        relayIsRunning.value = true;
        console.log("relayIsRunning", relayIsRunning.value);
    };
