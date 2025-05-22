import { FMT } from "./rtmp.ts";
import { Message } from "./messages.ts";

/**
 * Sends a message as one or more RTMP chunks over a TCP connection
 * @param conn The TCP connection to send the message over
 * @param message The RTMP message to send
 * @param chunkStreamId The chunk stream ID to use
 * @param messageStreamId The message stream ID to use
 * @param chunkSize The maximum chunk size to use
 */
export async function sendMessage(
    conn: Deno.TcpConn,
    message: {
        type: number;
        payload: Uint8Array;
    },
    chunkStreamId: number,
    messageStreamId: number,
    chunkSize: number,
): Promise<void> {
    const { type, payload } = message;
    const totalLength = payload.length;

    // Split the payload into chunks of maximum size chunkSize
    for (let offset = 0; offset < totalLength; offset += chunkSize) {
        const isFirstChunk = offset === 0;
        const chunkData = payload.slice(offset, offset + chunkSize);

        // Create and send the appropriate chunk
        if (isFirstChunk) {
            // First chunk - use Type 0 format with full header
            await sendChunk(conn, {
                fmt: FMT.Type0,
                chunkStreamId,
                timestamp: 0, // You might want to use a proper timestamp
                messageLength: totalLength,
                messageTypeId: type,
                messageStreamId,
                data: chunkData,
            });
        } else {
            // Continuation chunk - use Type 3 format (no header)
            await sendChunk(conn, {
                fmt: FMT.Type3,
                chunkStreamId,
                data: chunkData,
            });
        }
    }
}

/**
 * Sends a single RTMP chunk over a TCP connection
 */
export async function sendChunk(
    conn: Deno.TcpConn,
    chunk: {
        fmt: FMT;
        chunkStreamId: number;
        timestamp?: number;
        messageLength?: number;
        messageTypeId?: number;
        messageStreamId?: number;
        data: Uint8Array;
    },
): Promise<void> {
    const { fmt, chunkStreamId, data } = chunk;

    // Create the basic header
    let basicHeader: Uint8Array;
    if (chunkStreamId < 64) {
        // 1 byte format
        basicHeader = new Uint8Array(1);
        basicHeader[0] = (fmt << 6) | chunkStreamId;
    } else if (chunkStreamId < 320) {
        // 2 byte format
        basicHeader = new Uint8Array(2);
        basicHeader[0] = (fmt << 6) | 0;
        basicHeader[1] = chunkStreamId - 64;
    } else {
        // 3 byte format
        basicHeader = new Uint8Array(3);
        basicHeader[0] = (fmt << 6) | 1;
        basicHeader[1] = (chunkStreamId - 64) & 0xFF;
        basicHeader[2] = ((chunkStreamId - 64) >> 8) & 0xFF;
    }

    // Create the message header based on chunk format type
    let messageHeader: Uint8Array;

    switch (fmt) {
        case FMT.Type0:
            // Full header - 11 bytes
            messageHeader = new Uint8Array(11);

            // Timestamp (3 bytes)
            const timestamp = chunk.timestamp || 0;
            messageHeader[0] = (timestamp >> 16) & 0xFF;
            messageHeader[1] = (timestamp >> 8) & 0xFF;
            messageHeader[2] = timestamp & 0xFF;

            // Message length (3 bytes)
            const messageLength = chunk.messageLength || data.length;
            messageHeader[3] = (messageLength >> 16) & 0xFF;
            messageHeader[4] = (messageLength >> 8) & 0xFF;
            messageHeader[5] = messageLength & 0xFF;

            // Message type ID (1 byte)
            messageHeader[6] = chunk.messageTypeId || 0;

            // Message stream ID (4 bytes) - little endian
            const messageStreamId = chunk.messageStreamId || 0;
            messageHeader[7] = messageStreamId & 0xFF;
            messageHeader[8] = (messageStreamId >> 8) & 0xFF;
            messageHeader[9] = (messageStreamId >> 16) & 0xFF;
            messageHeader[10] = (messageStreamId >> 24) & 0xFF;
            break;

        case FMT.Type1:
            // 7 bytes - timestamp delta, message length, message type ID
            messageHeader = new Uint8Array(7);

            // Timestamp delta (3 bytes)
            const timestampDelta = chunk.timestamp || 0;
            messageHeader[0] = (timestampDelta >> 16) & 0xFF;
            messageHeader[1] = (timestampDelta >> 8) & 0xFF;
            messageHeader[2] = timestampDelta & 0xFF;

            // Message length (3 bytes)
            const msgLength = chunk.messageLength || data.length;
            messageHeader[3] = (msgLength >> 16) & 0xFF;
            messageHeader[4] = (msgLength >> 8) & 0xFF;
            messageHeader[5] = msgLength & 0xFF;

            // Message type ID (1 byte)
            messageHeader[6] = chunk.messageTypeId || 0;
            break;

        case FMT.Type2:
            // 3 bytes - timestamp delta only
            messageHeader = new Uint8Array(3);

            // Timestamp delta (3 bytes)
            const timeDelta = chunk.timestamp || 0;
            messageHeader[0] = (timeDelta >> 16) & 0xFF;
            messageHeader[1] = (timeDelta >> 8) & 0xFF;
            messageHeader[2] = timeDelta & 0xFF;
            break;

        case FMT.Type3:
            // No header
            messageHeader = new Uint8Array(0);
            break;

        default:
            throw new Error(`Invalid chunk format type: ${fmt}`);
    }

    // Combine everything and send
    const buffer = new Uint8Array(
        basicHeader.length + messageHeader.length + data.length,
    );
    buffer.set(basicHeader, 0);
    buffer.set(messageHeader, basicHeader.length);
    buffer.set(data, basicHeader.length + messageHeader.length);

    await conn.write(buffer);
}

/**
 * Creates an RTMP message
 */
export function createMessage(
    type: number,
    payload: Uint8Array,
): { type: number; payload: Uint8Array } {
    return { type, payload };
}

/**
 * Sends a control message
 */
export async function sendControlMessage(
    conn: Deno.TcpConn,
    messageType: number,
    payload: Uint8Array,
    chunkStreamId: number = 2,
    messageStreamId: number = 0,
    chunkSize: number = 128,
): Promise<void> {
    await sendMessage(
        conn,
        { type: messageType, payload },
        chunkStreamId,
        messageStreamId,
        chunkSize,
    );
}
