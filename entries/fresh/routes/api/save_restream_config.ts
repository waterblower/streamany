import { FreshContext } from "$fresh/server.ts";

export const handler = async (
    _req: Request,
    _ctx: FreshContext,
): Promise<Response> => {
    const obj = await _req.json();
    console.log(obj);
    const kv = await Deno.openKv();
    {
        await kv.set(["item1", "server"], obj.item1.server);
        await kv.set(["item1", "key"], obj.item1.key);

        await kv.set(["item2", "server"], obj.item2.server);
        await kv.set(["item2", "key"], obj.item2.key);

        await kv.set(["item3", "server"], obj.item3.server);
        await kv.set(["item3", "key"], obj.item3.key);
    }
    kv.close();
    return new Response();
};
