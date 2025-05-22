import { equals } from "jsr:@std/bytes/equals";
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { handleMessage, messagesFromChunks, MessageType } from "./messages.ts";

const chunkStreamStates = new Map<number, {
    messageLength: number;
    messageTypeId: number;
    messageStreamId: number;
    timestamp: number;
}>();

export enum FMT {
    Type0 = 0,
    Type1 = 1,
    Type2 = 2,
    Type3 = 3,
}

const listener = Deno.listen({
    port: 1935,
    hostname: "localhost",
});
console.log("listening at", listener.addr);

let chunkSizeRef = { value: 128 };
async function* chunkStream(
    conn: Deno.TcpConn,
    chunkSizeRef: { value: number },
) {
    let i = 0;
    while (true) {
        console.log("readChunk: begin------------", i++);
        const chunk = await readChunk(conn, chunkSizeRef, chunkStreamStates);
        if (!chunk) {
            console.log("No chunk received, connection may be closed");
            break;
        }
        yield chunk;
    }
}

for await (const conn of listener) {
    // https://rtmp.veriskope.com/docs/spec/#522c0-and-s0-format

    ///////////////////
    // Uninitialized //
    //
    /**
    read c0
    */
    const c0 = await read(conn, 1);
    if (c0 == null || c0[0] != 3) {
        console.error("version is not 3:", c0);
        conn.close();
        break;
    }

    /**
    send s0, s1
    */
    // send s0
    await conn.write(new Uint8Array([3]));
    console.log("Version Sent");

    // send s1
    const s1_time = new Uint8Array(4);
    crypto.getRandomValues(s1_time);

    const s1_zero = new Uint8Array([0, 0, 0, 0]);

    const s1_random = new Uint8Array(1528);
    crypto.getRandomValues(s1_random);

    console.log(
        `[HANDSHAKE] Sending S1 - Time: ${
            Array.from(s1_time).map((b) => b.toString(16).padStart(2, "0"))
                .join(" ")
        }`,
    );
    await conn.write(s1_time);
    await conn.write(s1_zero);
    await conn.write(s1_random);
    console.log(`[HANDSHAKE] S1 sent (${4 + 4 + 1528} bytes)`);

    /**
    read c1 https://rtmp.veriskope.com/docs/spec/#523c1-and-s1-format
    */
    const c1_time = await read(conn, 4);
    if (c1_time == null) {
        conn.close();
        break;
    }
    console.log("c1 time", c1_time);

    const c1_zero = await read(conn, 4);
    if (c1_zero == null) {
        conn.close();
        break;
    }
    console.log("c1 zero", c1_zero);
    if (equals(c1_zero, new Uint8Array([0, 0, 0, 0])) == false) {
        console.warn("c1_zero is not 0", c1_zero);
    }
    const c1_randome = await read(conn, 1528);
    if (c1_randome == null) {
        conn.close();
        break;
    }

    // send s2
    console.log(`[HANDSHAKE] Sending S2 (echoing C1 data)`);
    await conn.write(c1_time);
    await conn.write(c1_time);
    await conn.write(c1_randome);
    console.log("Ack Sent");
    console.log(`[HANDSHAKE] S2 sent (${4 + 4 + 1528} bytes)`);

    /**
    read c2 https://rtmp.veriskope.com/docs/spec/#524-c2-and-s2-format
    */
    console.log("reading c2");
    const c2 = await read(conn, 1536);
    if (c2 == null) {
        conn.close();
        break;
    }
    assertEquals(c2.slice(0, 4), s1_time);
    assertEquals(c2.slice(4, 8), s1_zero);
    assertEquals(c2.slice(8, 1536), s1_random);

    console.log("Handshake Done");

    console.log("[CONNECTION] Starting to process chunks after handshake");
    const chunks = chunkStream(conn, chunkSizeRef);
    for await (const message of messagesFromChunks(chunks)) {
        console.log(
            "Received message:",
            message.header,
            message.payload.length,
        );

        // Process the message
        await handleMessage(conn, message, chunkSizeRef);
    }
}

// todo: don't use module level global state

async function readChunk(
    conn: Deno.TcpConn,
    chunkSizeRef: { value: number },
    chunkStreamStates: Map<number, {
        messageLength: number;
        messageTypeId: number;
        messageStreamId: number;
        timestamp: number;
    }>,
): Promise<Chunk | null> {
    try {
        console.log("readChunk: begin");
        console.log(`[CHUNK] Current chunk size: ${chunkSizeRef.value}`);
        console.log(`[CHUNK] Active chunk streams: ${chunkStreamStates.size}`);
        const chunk_header = await readChunkHeader(conn);
        console.log("readChunkHeader: Done");

        // Get or create the state for this chunk stream
        let state = chunkStreamStates.get(chunk_header.chunk_stream_id);

        // Update state based on the header type
        if (chunk_header.message_header.type === FMT.Type0) {
            // For Type 0, we have a new message, so update all state
            state = {
                messageLength: chunk_header.message_header.message_length,
                messageTypeId: chunk_header.message_header.message_type_id,
                messageStreamId: chunk_header.message_header.message_stream_id,
                timestamp: chunk_header.message_header.timestamp,
            };
            chunkStreamStates.set(chunk_header.chunk_stream_id, state);
        } else if (chunk_header.message_header.type === FMT.Type1) {
            // For Type 1, update length, type ID and timestamp
            if (state) {
                state.messageLength =
                    chunk_header.message_header.message_length;
                state.messageTypeId =
                    chunk_header.message_header.message_type_id;
                state.timestamp = chunk_header.message_header.timestamp;
            } else {
                console.warn("Received Type1 chunk without previous state");
                return null;
            }
        } else if (chunk_header.message_header.type === FMT.Type2) {
            // For Type 2, only update timestamp
            if (state) {
                state.timestamp = chunk_header.message_header.timestamp;
            } else {
                console.warn("Received Type2 chunk without previous state");
                return null;
            }
        } else if (!state) {
            // For Type 3, if we have no state, we can't continue
            console.warn("Received Type3 chunk without previous state");
            return null;
        }

        // Determine the actual size to read (using the stored state for Type 1-3)
        let sizeToRead = chunkSizeRef.value;
        if (state && state.messageLength < chunkSizeRef.value) {
            sizeToRead = state.messageLength;
        }

        // Read chunk data
        console.log(
            `[CHUNK] Reading chunk data, size to read: ${sizeToRead} (message length: ${
                state?.messageLength || "unknown"
            })`,
        );
        const message = await read(conn, sizeToRead);
        if (message == null) {
            console.warn("readChunk: no chunk data");
            return null;
        }
        console.log(
            `[CHUNK] Successfully read chunk data, received ${message.length} bytes`,
        );

        // For Type 1-3, enhance the header with the stored state
        if (chunk_header.message_header.type !== FMT.Type0 && state) {
            chunk_header.message_header.message_length = state.messageLength;
            chunk_header.message_header.message_type_id = state.messageTypeId;
            chunk_header.message_header.message_stream_id =
                state.messageStreamId;
        }

        return {
            header: chunk_header,
            data: message,
        };
    } catch (error) {
        console.error("Error reading chunk:", error);
        return null;
    }
}

export type Chunk = {
    header: ChunkHeader;
    data: Uint8Array;
};

type ChunkHeader = {
    chunk_stream_id: number; // basic header
    message_header: MessageHeader;
    extended_timestamp: number | undefined;
};

type MessageHeader = {
    type: FMT;
    timestamp: number;
    message_length: number;
    message_type_id: number;
    message_stream_id: number; // 4 bytes
} | {
    type: FMT.Type1;
    timestamp: number;
    message_length: number;
    message_type_id: number;
    message_stream_id?: number; // 4 bytes
} | {
    type: FMT.Type2;
    timestamp: number;
    message_length?: number;
    message_type_id?: number;
    message_stream_id?: number; // 4 bytes
} | {
    type: FMT.Type3;
    message_length?: number;
    message_type_id?: number;
    message_stream_id?: number; // 4 bytes
};

async function readChunkHeader(conn: Deno.TcpConn): Promise<ChunkHeader> {
    /**
    Chunking https://rtmp.veriskope.com/docs/spec/#531chunk-format
    */
    // read Chunk Basic Header
    const basic_header = await readBasicHeader(conn);
    if (basic_header instanceof Error) throw basic_header;
    console.log("readBasicHeader: done");
    const { fmt, chunk_stream_id } = basic_header;
    const message_header = await readMessageHeader(conn, fmt);
    if (message_header instanceof Error) throw message_header;
    console.log("readMessageHeader: done");

    // https://rtmp.veriskope.com/docs/spec/#5313-extended-timestamp
    // should parse Extended Timestamp?
    const extended_timestamp: undefined | number = undefined;
    if (message_header.type != FMT.Type3) {
        if (message_header.timestamp == 0xffffff) {
            throw "not implemented";
        }
    }

    return {
        chunk_stream_id,
        extended_timestamp,
        message_header,
    };
}

/**
 * https://rtmp.veriskope.com/docs/spec/#5311-chunk-basic-header
 */
async function readBasicHeader(conn: Deno.TcpConn) {
    console.log("readBasicHeader: start");
    console.log("[BASIC_HEADER] Attempting to read first byte...");
    const header_1 = await read(conn, 1);
    if (header_1 == null) {
        console.log(
            "[BASIC_HEADER] Failed to read first byte, connection may be closed",
        );
        return new Error("Failed to read basic header first byte");
    }
    console.log("readBasicHeader: 1st byte is", header_1);
    console.log(
        `[BASIC_HEADER] First byte hex: 0x${
            header_1[0].toString(16)
        }, binary: ${header_1[0].toString(2).padStart(8, "0")}`,
    );

    // Extract the format from the first 2 bits (upper 2 bits)
    const fmt: FMT = header_1[0] >> 6;

    // Extract the chunk stream ID using the format type
    let chunk_stream_id: number;

    // The lower 6 bits of the first byte represent the chunk stream ID
    const first_byte_csid = header_1[0] & 0b0011_1111;

    if (first_byte_csid === 0) {
        // 2 bytes - csid range from 64-319
        const second_byte = await read(conn, 1);
        if (second_byte === null) {
            return new Error("Failed to read basic header second byte");
        }
        chunk_stream_id = second_byte[0] + 64;
    } else if (first_byte_csid === 1) {
        // 3 bytes - csid range from 64-65599
        const extra_bytes = await read(conn, 2);
        if (extra_bytes === null) {
            return new Error("Failed to read basic header extra bytes");
        }
        chunk_stream_id = extra_bytes[0] + (extra_bytes[1] << 8) + 64;
    } else {
        // 1 byte - csid range from 2-63
        chunk_stream_id = first_byte_csid;
    }

    console.log("fmt:", fmt, "chunk_stream_id:", chunk_stream_id);
    return { fmt, chunk_stream_id };
}

async function readMessageHeader(conn: Deno.TcpConn, fmt: FMT) {
    /**
     * Read Chunk Message Header
     * https://rtmp.veriskope.com/docs/spec/#5312-chunk-message-header
     */
    let message_header: MessageHeader;
    console.log("readMessageHeader: fmt", fmt);
    console.log(`[MESSAGE_HEADER] Reading header for format type ${fmt}`);
    if (fmt == FMT.Type0) {
        const header = await read(conn, 11);
        if (header == null) {
            return new Error("Failed to read Type0 message header");
        }

        const timestamp = header.slice(0, 3);
        const message_len = header.slice(3, 6);
        const message_type_id = header.slice(6, 7);
        const message_stream_id = header.slice(7, 11);

        message_header = {
            type: fmt,
            timestamp: byte_3_to_number(timestamp),
            message_length: byte_3_to_number(message_len),
            message_type_id: message_type_id[0],
            message_stream_id: byte_4_to_number(message_stream_id),
        };
    } else if (fmt == FMT.Type1) {
        const header = await read(conn, 7);
        if (header == null) {
            return new Error("Failed to read Type1 message header");
        }

        const timestamp = header.slice(0, 3);
        const message_len = header.slice(3, 6);
        const message_type_id = header.slice(6, 7);

        message_header = {
            type: fmt,
            timestamp: byte_3_to_number(timestamp),
            message_length: byte_3_to_number(message_len),
            message_type_id: message_type_id[0],
        };
    } else if (fmt == FMT.Type2) {
        const header = await read(conn, 3); // Just read the timestamp delta for Type2
        if (header == null) {
            return new Error("Failed to read Type2 message header");
        }

        message_header = {
            type: fmt,
            timestamp: byte_3_to_number(header),
        };
    } else {
        message_header = {
            type: fmt,
        };
        console.log(fmt, "no Chunk Message Header");
    }
    return message_header;
}

async function read(conn: Deno.TcpConn, size: number) {
    console.log(`[READ] Attempting to read ${size} bytes...`);
    const buf = new Uint8Array(size);
    console.log(`[READ] Waiting for connection.read() to return...`);
    const read_n = await conn.read(buf);
    if (read_n == null) {
        console.log(`[READ] Read returned null, connection likely closed`);
        return null;
    }
    console.log(
        `[READ] Successfully read ${read_n} bytes of ${size} requested`,
    );
    return buf.slice(0, read_n);
}

function byteToBinaryString(byte: ArrayBuffer) {
    // Ensure the value is treated as 8 bits
    // @ts-ignore
    return byte.toString(2).padStart(8, "0");
}

// function uint8Array3ToNumberLE(bytes: Uint8Array) {
//   return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
// }

export function byte_3_to_number(bytes: Uint8Array) {
    assertEquals(bytes.length, 3);
    return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
}

export function byte_4_to_number(bytes: Uint8Array) {
    assertEquals(bytes.length, 4);
    return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
}
