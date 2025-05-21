import { Chunk } from "./rtmp.ts";

export type Message = {
    header: MessageHeader
    payload: Uint8Array
}

// https://rtmp.veriskope.com/docs/spec/#611-message-header
type MessageHeader = {
    type: number,   // 1 byte
    payload_length: number // 3 bytes
    timestamp: number // 4 bytes
    message_stream_id: number // 3 bytes
}

export async function messagesFromChunks(chunks: AsyncIterable<Chunk>) {
    const messages = new Map()
    for await (const chunk of chunks) {
        console.log(
            "chunk header:",
            chunk.header,
            "chunk data:",
            chunk.data?.length,
        );
    }
}
