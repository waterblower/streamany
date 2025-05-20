import { FreshContext } from "$fresh/server.ts";
import { get_relay_config, run_ffmpeg, setup_ffmpeg_binary } from "../../../../core/relay.ts";

export const handler = async (
    _req: Request,
    _ctx: FreshContext,
): Promise<Response> => {
    const data = await get_relay_config()
    const ffmpeg_path = await setup_ffmpeg_binary()
    const child_p = await run_ffmpeg(ffmpeg_path, data);
    if(child_p instanceof Error) {
        console.error(child_p);
        new Response(child_p.message, {status: 400});
    }
    
    return new Response();
};
