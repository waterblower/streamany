import { Chunk } from "./rtmp.ts";

export async function messagesFromChunks(chunks: AsyncIterable<Chunk>) {
    for await (const chunk of chunks) {
        console.log(
            "chunk header:",
            chunk.header,
            "chunk data:",
            chunk.data?.length,
        );
    }
}
