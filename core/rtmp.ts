import { equals } from "jsr:@std/bytes/equals";
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { handleMessage, messagesFromChunks, MessageType } from "./messages.ts";

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
        const chunk = await readChunk(conn, chunkSizeRef);
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

    await conn.write(s1_time);
    await conn.write(s1_zero);
    await conn.write(s1_random);

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
    await conn.write(c1_time);
    await conn.write(c1_time);
    await conn.write(c1_randome);
    console.log("Ack Sent");

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

async function readChunk(
    conn: Deno.TcpConn,
    chunkSizeRef: { value: number },
): Promise<Chunk | null> {
    console.log("readChunk: begin");
    const chunk_header = await readChunkHeader(conn);
    console.log("readChunkHeader: Done");

    // Determine the actual size to read
    // For Type 0 chunks, use the message length if it's smaller than the chunk size
    let sizeToRead = chunkSizeRef.value;
    if (
        chunk_header.message_header.type === FMT.Type0 &&
        chunk_header.message_header.message_length < chunkSizeRef.value
    ) {
        sizeToRead = chunk_header.message_header.message_length;
    }

    // read chunk data
    const message = await read(conn, sizeToRead);
    if (message == null) {
        console.warn("readChunk: no chunk data");
        return null;
    }

    return {
        header: chunk_header,
        data: message,
    };
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
    type: FMT.Type0;
    timestamp: number;
    message_length: number;
    message_type_id: number;
    message_stream_id: number; // 4 bytes
} | {
    type: FMT.Type1;
    timestamp: number;
    message_length: number;
    message_type_id: number;
} | {
    type: FMT.Type2;
    timestamp: number;
} | {
    type: FMT.Type3;
};

async function readChunkHeader(conn: Deno.TcpConn): Promise<ChunkHeader> {
    /**
    Chunking https://rtmp.veriskope.com/docs/spec/#531chunk-format
    */
    // read Chunk Basic Header
    const { fmt, chunk_stream_id } = await readBasicHeader(conn);
    console.log("readBasicHeader: done");
    const message_header = await readMessageHeader(conn, fmt);
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

async function readBasicHeader(conn: Deno.TcpConn) {
    const header_1 = await read(conn, 1);
    if (header_1 == null) {
        throw "";
    }
    // console.log(byteToBinaryString(header_1[0]));

    let chunk_stream_id = header_1[0];

    const fmt: FMT = header_1[0] >> 6;
    console.log("fmt is", fmt, header_1[0]);
    if (header_1[0] == 0) { // 2 bytes
    } else if (header_1[0] == 1) { // 3 bytes
    } else { // 1 byte
        chunk_stream_id = header_1[0] & 0b0011_1111;
    }
    console.log("fmt:", fmt, "chunk_stream_id:", chunk_stream_id);
    return { fmt, chunk_stream_id };
}

async function readMessageHeader(conn: Deno.TcpConn, fmt: FMT) {
    /**
        read Chunk Message Header
        https://rtmp.veriskope.com/docs/spec/#5312-chunk-message-header
        */
    let message_header: MessageHeader;
    let timestamp: Uint8Array = new Uint8Array([0xff, 0xff, 0xff]);
    if (fmt == FMT.Type0) {
        console.log("fmt", fmt);
        const header = await read(conn, 11);
        if (header == null) throw "";

        console.log("!");
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
        if (header == null) throw "";
        timestamp = header.slice(0, 3);
        const message_len = header.slice(3, 6);
        const message_type_id = header.slice(6, 7);
        message_header = {
            type: fmt,
            timestamp: byte_3_to_number(timestamp),
            message_length: byte_3_to_number(message_len),
            message_type_id: message_type_id[0],
        };
    } else if (fmt == FMT.Type2) {
        const header = await read(conn, 7);
        if (header == null) throw "";
        timestamp = header.slice(0, 3);
        message_header = {
            type: fmt,
            timestamp: byte_3_to_number(timestamp),
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
    const buf = new Uint8Array(size);
    const read_n = await conn.read(buf);
    if (read_n == null) {
        return null;
    }
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
