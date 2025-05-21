import { assertEquals } from "jsr:@std/assert/equals";
import { byte_3_to_number, byte_4_to_number, Chunk, FMT } from "./rtmp.ts";

export type Message = {
    header: MessageHeader;
    payload: Uint8Array;
};

// https://rtmp.veriskope.com/docs/spec/#611-message-header
type MessageHeader = {
    type: number; // 1 byte
    payload_length: number; // 3 bytes
    timestamp: number; // 4 bytes
    message_stream_id: number; // 3 bytes
};

// https://rtmp.veriskope.com/docs/spec/#53chunking
export async function* messagesFromChunks(chunks: AsyncIterable<Chunk>) {
    /**
     * After handshaking, the connection multiplexes one or more chunk streams.
     * Each chunk stream carries messages of one type from one message stream.
     * Each chunk that is created has a unique ID associated with it
     * called chunk stream ID.
     * The chunks are transmitted over the network.
     * While transmitting, each chunk must be sent in full before the next chunk.
     * At the receiver end, the chunks are assembled into messages
     * based on the chunk stream ID.
     */
    const messages = new Map<number, {
        total_length: number;
        chunks: Chunk[];
    }>();
    for await (const chunk of chunks) {
        console.log(
            "chunk header:",
            chunk.header,
            "chunk data:",
            chunk.data?.length,
        );

        let chunks = messages.get(chunk.header.chunk_stream_id);
        if (chunks) {
            chunks.chunks.push(chunk);
        } else {
            if (chunk.header.message_header.type == FMT.Type0) {
                chunks = {
                    total_length: chunk.header.message_header.message_length,
                    chunks: [chunk],
                };
                messages.set(chunk.header.chunk_stream_id, chunks);
            } else {
                throw "impossible";
            }
        }
        let size = 0;
        for (const chunk of chunks.chunks) {
            size += chunk.data.length;
        }
        if (size == chunks.total_length) {
            const message = assembleChunksToMessage(
                chunks.chunks,
                chunks.total_length,
            );
            console.log("message:", message.length);

            // parse message into object
            const type = message.slice(0, 1);
            console.log(message.slice(0, 11));
            const payload_len = byte_3_to_number(message.slice(1, 4));
            const timestamp = byte_4_to_number(message.slice(4, 8));
            const message_stream_id = byte_3_to_number(message.slice(8, 11));
            const payload = message.slice(11);
            assertEquals(payload_len, payload.byteLength);
        }
    }
}

function assembleChunksToMessage(chunks: Chunk[], total_length: number) {
    const buf = new Uint8Array(total_length);
    let offset = 0;
    for (const chunk of chunks) {
        console.log("chunk.data", chunk.data.length);
        buf.set(chunk.data, offset);
        offset += chunk.data.length;
    }
    return buf;
}
