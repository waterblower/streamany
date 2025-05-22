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
    // Track message state for each chunk stream ID
    const messageStreams = new Map<number, {
        messageHeader?: MessageHeader;
        totalLength: number;
        collectedLength: number;
        chunks: Chunk[];
    }>();

    for await (const chunk of chunks) {
        console.log(
            "chunk header:",
            chunk.header,
            "chunk data:",
            chunk.data?.length,
        );

        const chunkStreamId = chunk.header.chunk_stream_id;

        // Get or create message stream tracking object
        let messageStream = messageStreams.get(chunkStreamId);

        // Process based on chunk format type
        if (chunk.header.message_header.type === FMT.Type0) {
            // Type 0 chunks start new messages
            const header = chunk.header.message_header;

            // If we have a pending message, we should yield it first (this shouldn't happen with proper chunking)
            if (messageStream && messageStream.collectedLength > 0) {
                const message = assembleMessage(messageStream);
                if (message) {
                    yield message;
                }
            }

            // Start a new message
            messageStream = {
                messageHeader: {
                    type: header.message_type_id,
                    payload_length: header.message_length,
                    timestamp: header.timestamp,
                    message_stream_id: header.message_stream_id,
                },
                totalLength: header.message_length,
                collectedLength: 0,
                chunks: [],
            };
            messageStreams.set(chunkStreamId, messageStream);
        } else if (!messageStream) {
            // For non-Type0 chunks, we should already have a message stream
            console.error(
                "Received non-Type0 chunk without prior Type0 chunk for stream:",
                chunkStreamId,
            );
            continue;
        }

        // Add chunk to the current message stream
        messageStream.chunks.push(chunk);
        messageStream.collectedLength += chunk.data.length;

        // Check if we've collected a complete message
        if (messageStream.collectedLength >= messageStream.totalLength) {
            const message = assembleMessage(messageStream);
            if (message) {
                yield message;
            }

            // Reset for the next message in this stream
            messageStreams.set(chunkStreamId, {
                messageHeader: messageStream.messageHeader,
                totalLength: 0,
                collectedLength: 0,
                chunks: [],
            });
        }
    }
}

function assembleMessage(messageStream: {
    messageHeader?: MessageHeader;
    totalLength: number;
    collectedLength: number;
    chunks: Chunk[];
}): Message | null {
    if (!messageStream.messageHeader) {
        console.error("Cannot assemble message without a header");
        return null;
    }

    // Create buffer for the assembled payload
    const payload = new Uint8Array(messageStream.totalLength);
    let offset = 0;

    // Copy all chunk data into the payload buffer
    for (const chunk of messageStream.chunks) {
        const dataToWrite = Math.min(
            chunk.data.length,
            messageStream.totalLength - offset,
        );
        payload.set(chunk.data.subarray(0, dataToWrite), offset);
        offset += dataToWrite;

        if (offset >= messageStream.totalLength) {
            break;
        }
    }

    if (offset !== messageStream.totalLength) {
        console.warn(
            `Payload size mismatch: expected ${messageStream.totalLength}, got ${offset}`,
        );
    }

    return {
        header: messageStream.messageHeader,
        payload,
    };
}

/**
 * Enum for standard RTMP message types
 * See: https://rtmp.veriskope.com/docs/spec/#5-protocol-messages
 */
export enum MessageType {
    // Protocol Control Messages
    SET_CHUNK_SIZE = 1,
    ABORT = 2,
    ACKNOWLEDGEMENT = 3,
    USER_CONTROL = 4,
    WINDOW_ACKNOWLEDGEMENT_SIZE = 5,
    SET_PEER_BANDWIDTH = 6,

    // RTMP Command Messages
    COMMAND_AMF0 = 20,
    COMMAND_AMF3 = 17,

    // Data Messages
    DATA_AMF0 = 18,
    DATA_AMF3 = 15,

    // Shared Object Messages
    SHARED_OBJECT_AMF0 = 19,
    SHARED_OBJECT_AMF3 = 16,

    // Audio/Video Messages
    AUDIO = 8,
    VIDEO = 9,
}

/**
 * Handles an RTMP message based on its type and updates connection state accordingly
 * @param conn The TCP connection
 * @param message The RTMP message to handle
 * @param chunkSizeRef Reference to the current chunk size value
 * @returns Any values that may need to be returned from handling the message
 */
export async function handleMessage(
    conn: Deno.TcpConn,
    message: Message,
    chunkSizeRef: { value: number },
): Promise<void> {
    console.log(`Handling message type: ${message.header.type}`);

    switch (message.header.type) {
        case MessageType.SET_CHUNK_SIZE:
            handleSetChunkSize(message, chunkSizeRef);
            break;

        case MessageType.ABORT:
            handleAbortMessage(message);
            break;

        case MessageType.ACKNOWLEDGEMENT:
            handleAcknowledgement(message);
            break;

        case MessageType.WINDOW_ACKNOWLEDGEMENT_SIZE:
            handleWindowAcknowledgementSize(message, conn);
            break;

        case MessageType.SET_PEER_BANDWIDTH:
            handleSetPeerBandwidth(message, conn);
            break;

        case MessageType.USER_CONTROL:
            handleUserControlMessage(message, conn);
            break;

        case MessageType.COMMAND_AMF0:
        case MessageType.COMMAND_AMF3:
            await handleCommandMessage(message, conn);
            break;

        case MessageType.DATA_AMF0:
        case MessageType.DATA_AMF3:
            handleDataMessage(message);
            break;

        case MessageType.AUDIO:
            handleAudioMessage(message);
            break;

        case MessageType.VIDEO:
            handleVideoMessage(message);
            break;

        default:
            console.warn(`Unhandled message type: ${message.header.type}`);
    }
}

/**
 * Handles Set Chunk Size message (type 1)
 * Updates the chunk size for reading subsequent chunks
 */
function handleSetChunkSize(
    message: Message,
    chunkSizeRef: { value: number },
): void {
    // The first 4 bytes of the message payload contain the new chunk size
    if (message.payload.length < 4) {
        console.error("Invalid Set Chunk Size message: payload too short");
        return;
    }

    // Big-endian format
    const newChunkSize = (message.payload[0] << 24) |
        (message.payload[1] << 16) |
        (message.payload[2] << 8) |
        message.payload[3];

    console.log(
        `Updating chunk size from ${chunkSizeRef.value} to ${newChunkSize}`,
    );
    chunkSizeRef.value = newChunkSize;
}

/**
 * Handles Abort Message (type 2)
 * Client instructs the server to discard any partially received message
 */
function handleAbortMessage(message: Message): void {
    if (message.payload.length < 4) {
        console.error("Invalid Abort message: payload too short");
        return;
    }

    // Extract the chunk stream ID to abort
    const chunkStreamId = (message.payload[0] << 24) |
        (message.payload[1] << 16) |
        (message.payload[2] << 8) |
        message.payload[3];

    console.log(`Abort message received for chunk stream ID: ${chunkStreamId}`);
    // Here you would discard any partially received message with this chunk stream ID
}

/**
 * Handles Acknowledgement message (type 3)
 * Client acknowledges receipt of a specific number of bytes
 */
function handleAcknowledgement(message: Message): void {
    if (message.payload.length < 4) {
        console.error("Invalid Acknowledgement message: payload too short");
        return;
    }

    const sequenceNumber = (message.payload[0] << 24) |
        (message.payload[1] << 16) |
        (message.payload[2] << 8) |
        message.payload[3];

    console.log(
        `Acknowledgement received for sequence number: ${sequenceNumber}`,
    );
}

/**
 * Handles Window Acknowledgement Size message (type 5)
 * Sets the window size for the connection
 */
function handleWindowAcknowledgementSize(
    message: Message,
    conn: Deno.TcpConn,
): void {
    if (message.payload.length < 4) {
        console.error(
            "Invalid Window Acknowledgement Size message: payload too short",
        );
        return;
    }

    const windowSize = (message.payload[0] << 24) |
        (message.payload[1] << 16) |
        (message.payload[2] << 8) |
        message.payload[3];

    console.log(`Window Acknowledgement Size set to: ${windowSize}`);

    // You might need to store this value to determine when to send acknowledgements
}

/**
 * Handles Set Peer Bandwidth message (type 6)
 * Sets the bandwidth limit for the connection
 */
function handleSetPeerBandwidth(message: Message, conn: Deno.TcpConn): void {
    if (message.payload.length < 5) {
        console.error("Invalid Set Peer Bandwidth message: payload too short");
        return;
    }

    const windowSize = (message.payload[0] << 24) |
        (message.payload[1] << 16) |
        (message.payload[2] << 8) |
        message.payload[3];

    const limitType = message.payload[4];

    console.log(`Set Peer Bandwidth: size=${windowSize}, type=${limitType}`);

    // Respond with a Window Acknowledgement Size message
    sendWindowAcknowledgementSize(conn, windowSize);
}

/**
 * Sends a Window Acknowledgement Size message
 */
async function sendWindowAcknowledgementSize(
    conn: Deno.TcpConn,
    windowSize: number,
): Promise<void> {
    // Create a message with type 5 (Window Acknowledgement Size)
    const payload = new Uint8Array(4);
    payload[0] = (windowSize >> 24) & 0xFF;
    payload[1] = (windowSize >> 16) & 0xFF;
    payload[2] = (windowSize >> 8) & 0xFF;
    payload[3] = windowSize & 0xFF;

    // In a real implementation, you would wrap this in a proper RTMP chunk
    // For now, we'll just log it
    console.log(`Sending Window Acknowledgement Size: ${windowSize}`);
}

/**
 * Handles User Control Message (type 4)
 * Contains various event types
 */
function handleUserControlMessage(message: Message, conn: Deno.TcpConn): void {
    if (message.payload.length < 2) {
        console.error("Invalid User Control message: payload too short");
        return;
    }

    // First 2 bytes are the event type
    const eventType = (message.payload[0] << 8) | message.payload[1];

    switch (eventType) {
        case 0: // Stream Begin
            if (message.payload.length < 6) break;
            const streamId = (message.payload[2] << 24) |
                (message.payload[3] << 16) |
                (message.payload[4] << 8) |
                message.payload[5];
            console.log(`Stream Begin event for stream ID: ${streamId}`);
            break;

        case 1: // Stream EOF
            console.log("Stream EOF event");
            break;

        case 2: // Stream Dry
            console.log("Stream Dry event");
            break;

        case 3: // Set Buffer Length
            console.log("Set Buffer Length event");
            break;

        case 4: // Stream Is Recorded
            console.log("Stream Is Recorded event");
            break;

        case 6: // Ping Request
            // Respond with Ping Response
            sendPingResponse(conn, message.payload.slice(2));
            break;

        case 7: // Ping Response
            console.log("Ping Response received");
            break;

        default:
            console.log(`Unknown User Control event type: ${eventType}`);
    }
}

/**
 * Sends a Ping Response message
 */
async function sendPingResponse(
    conn: Deno.TcpConn,
    timestampData: Uint8Array,
): Promise<void> {
    // Create a ping response user control message
    // In a real implementation, you would wrap this in a proper RTMP chunk
    console.log("Sending Ping Response");
}

/**
 * Handles Command Message (type 20 for AMF0, type 17 for AMF3)
 * Contains NetConnection and NetStream commands
 */
async function handleCommandMessage(
    message: Message,
    conn: Deno.TcpConn,
): Promise<void> {
    console.log("Command message received");

    // In a real implementation, you would parse the AMF data
    // and handle commands like connect, createStream, play, etc.

    // For example:
    // const commandName = parseAMFString(message.payload, 0);
    // console.log(`Command: ${commandName}`);

    // Respond based on the command
    // if (commandName === "connect") {
    //     sendConnectResponse(conn);
    // }
}

/**
 * Handles Data Message (type 18 for AMF0, type 15 for AMF3)
 * Contains metadata information
 */
function handleDataMessage(message: Message): void {
    console.log("Data message received");

    // In a real implementation, you would parse the AMF data
    // and extract metadata like video dimensions, framerate, etc.
}

/**
 * Handles Audio Message (type 8)
 * Contains audio data
 */
function handleAudioMessage(message: Message): void {
    console.log(`Audio data received: ${message.payload.length} bytes`);

    // Process or forward audio data
}

/**
 * Handles Video Message (type 9)
 * Contains video data
 */
function handleVideoMessage(message: Message): void {
    console.log(`Video data received: ${message.payload.length} bytes`);

    // Process or forward video data
}
