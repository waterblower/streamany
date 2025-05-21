import { equals } from "jsr:@std/bytes/equals";
import { assertEquals, assertNotEquals } from "jsr:@std/assert";

enum FMT {
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

    const chunk = await readChunk(conn);
    console.log(chunk.header)
}

async function readChunk(conn: Deno.TcpConn): Promise<Chunk> {
    console.log("Read Chunk");
    const chunk_header = await readChunkHeader(conn);
    let message: undefined | Uint8Array

    console.log("chunk_header.message_header.type", chunk_header.message_header.type)
    if (chunk_header.message_header.type == FMT.Type0) {
        const len = chunk_header.message_header.message_length
        const data = await read(conn, len)
        if (data == null) throw ""
        message = data
    } else if (chunk_header.message_header.type == FMT.Type1) {
        const len = chunk_header.message_header.message_length
        const data = await read(conn, len)
        if (data == null) throw ""
        message = data
    } else if (chunk_header.message_header.type == FMT.Type2) {

    } else if (chunk_header.message_header.type == FMT.Type3) {

    }

    return {
        header: chunk_header,
        data: message
    }

    // https://rtmp.veriskope.com/docs/spec/#54-protocol-control-messages
    // if (
    //     chunk_stream_id == 1 ||
    //     chunk_stream_id == 2 ||
    //     chunk_stream_id == 3 ||
    //     chunk_stream_id == 5 ||
    //     chunk_stream_id == 6
    // ) {
    //     console.log("read protocol-control-messages");
    //     if (chunk_stream_id == 3) {
    //         const sequence_number = await read(conn, 4);
    //         if (sequence_number == null) throw "";
    //         console.log(
    //             sequence_number,
    //             new DataView(sequence_number.buffer).getUint32(0, true),
    //             new DataView(sequence_number.buffer).getUint32(0, false),
    //         );
    //         const xx = await read(conn, 1024 * 1024 * 1024);
    //         console.log("length", xx?.length);
    //     } else {
    //         throw "not implemented";
    //     }
    // }
}

type Chunk = {
    header: ChunkHeader,
    data: Uint8Array | undefined
}

type ChunkHeader = {
    chunk_stream_id: number;    // basic header
    message_header: MessageHeader
    extended_timestamp: number | undefined;
};

type MessageHeader = {
    type: FMT.Type0;
    timestamp: number;
    message_length: number;
    message_type_id: number;
    message_stream_id: number;
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
    const {fmt, chunk_stream_id} = await readBasicHeader(conn)
    const messageHeader = await readMessageHeader(conn, fmt)

    // https://rtmp.veriskope.com/docs/spec/#5313-extended-timestamp
    // should parse Extended Timestamp?
    const extended_timestamp: undefined | number
    if (equals(timestamp, new Uint8Array([0xff, 0xff, 0xff]))) {
        throw "not implemented";
    }

    return {
        chunk_stream_id,
        extended_timestamp,
        message_header
    }
}

async function readBasicHeader(conn: Deno.TcpConn) {
    const header_1 = await read(conn, 1);
    if (header_1 == null) {
        throw "";
    }
    // console.log(byteToBinaryString(header_1[0]));

    let chunk_stream_id = header_1[0];
    const fmt: FMT = header_1[0] & 0b1100_0000;
    if (header_1[0] == 0) { // 2 bytes
    } else if (header_1[0] == 1) { // 3 bytes
    } else { // 1 byte
        chunk_stream_id = header_1[0] & 0b0011_1111;
    }
    console.log("fmt:", fmt, "chunk_stream_id:", chunk_stream_id);
    return {fmt, chunk_stream_id}
}

async function readMessageHeader(conn: Deno.TcpConn, fmt: FMT) {
/**
    read Chunk Message Header
    https://rtmp.veriskope.com/docs/spec/#5312-chunk-message-header
    */
    let message_header: MessageHeader
    let timestamp: Uint8Array = new Uint8Array([0xff, 0xff, 0xff]);
    if (fmt == FMT.Type0) {
        const header = await read(conn, 11);
        if (header == null) throw "";
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

        console.log("timestamp", timestamp);
        console.log("message_len", message_len);
        console.log("message_type_id", message_type_id);
        console.log("message_stream_id", message_stream_id);
    } else if (fmt == FMT.Type1) {
        const header = await read(conn, 7);
        if (header == null) throw "";
        timestamp = header.slice(0, 3);
        const message_len = header.slice(3, 6);
        const message_type_id = header.slice(6, 7);
    } else if (fmt == FMT.Type2) {
        const header = await read(conn, 7);
        if (header == null) throw "";
        timestamp = header.slice(0, 3);
    } else {
        console.log(fmt, "no Chunk Message Header");
    }
    return message_header
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
    return byte.toString(2).padStart(8, "0");
}

// function uint8Array3ToNumberLE(bytes: Uint8Array) {
//   return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
// }

function byte_3_to_number(bytes: Uint8Array) {
    assertEquals(bytes.length, 3)
    return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
}

function byte_4_to_number(bytes: Uint8Array) {
    assertEquals(bytes.length, 4)
    return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
}
