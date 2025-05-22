import { assertEquals } from "jsr:@std/assert/equals";
import { byte_3_to_number, byte_4_to_number, Chunk, FMT } from "./rtmp.ts";
// Import AMF0 parsing utilities
import { encodeAMF0Command, parseAMF0Command } from "./amf.ts";
import { sendControlMessage, sendMessage } from "./chunk.ts";

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

    // Send the message using the chunk utility
    await sendControlMessage(
        conn,
        MessageType.WINDOW_ACKNOWLEDGEMENT_SIZE,
        payload,
    );

    console.log(`Sent Window Acknowledgement Size: ${windowSize}`);
}

/**
 * Sends a Set Peer Bandwidth message
 */
async function sendSetPeerBandwidth(
    conn: Deno.TcpConn,
    windowSize: number,
    limitType: number,
): Promise<void> {
    // Create a message with type 6 (Set Peer Bandwidth)
    const payload = new Uint8Array(5);
    payload[0] = (windowSize >> 24) & 0xFF;
    payload[1] = (windowSize >> 16) & 0xFF;
    payload[2] = (windowSize >> 8) & 0xFF;
    payload[3] = windowSize & 0xFF;
    payload[4] = limitType; // 0: Hard, 1: Soft, 2: Dynamic

    // Send the message using the chunk utility
    await sendControlMessage(conn, MessageType.SET_PEER_BANDWIDTH, payload);

    console.log(`Sent Set Peer Bandwidth: ${windowSize}, type: ${limitType}`);
}

/**
 * Sends a Stream Begin user control message
 */
async function sendStreamBegin(
    conn: Deno.TcpConn,
    streamId: number,
): Promise<void> {
    // Create a User Control message with event type 0 (Stream Begin)
    const payload = new Uint8Array(6);
    payload[0] = 0; // Event type: Stream Begin (high byte)
    payload[1] = 0; // Event type: Stream Begin (low byte)
    payload[2] = (streamId >> 24) & 0xFF;
    payload[3] = (streamId >> 16) & 0xFF;
    payload[4] = (streamId >> 8) & 0xFF;
    payload[5] = streamId & 0xFF;

    // Send the message using the chunk utility
    const { sendControlMessage } = await import("./chunk.ts");
    await sendControlMessage(conn, MessageType.USER_CONTROL, payload);

    console.log(`Sent Stream Begin for stream ID: ${streamId}`);
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
    // Create a ping response user control message (event type 7)
    const payload = new Uint8Array(2 + timestampData.length);
    payload[0] = 0; // Event type: Ping Response (high byte)
    payload[1] = 7; // Event type: Ping Response (low byte)
    payload.set(timestampData, 2);

    // Send the message using the chunk utility
    const { sendControlMessage } = await import("./chunk.ts");
    await sendControlMessage(conn, MessageType.USER_CONTROL, payload);

    console.log("Sent Ping Response");
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

    // Parse the command message payload
    const { commandName, transactionId, commandObject, additionalParams } =
        parseAMF0Command(message.payload);

    console.log(`Command: ${commandName}, TransactionID: ${transactionId}`);
    console.log("Command object:", commandObject);
    console.log("Additional parameters:", additionalParams);

    // Handle different commands
    switch (commandName) {
        case "connect":
            await handleConnectCommand(conn, transactionId, commandObject);
            break;

        case "createStream":
            await handleCreateStreamCommand(conn, transactionId);
            break;

        case "play":
            await handlePlayCommand(
                conn,
                transactionId,
                commandObject,
                additionalParams[0] as string,
            );
            break;

        case "deleteStream":
            await handleDeleteStreamCommand(
                conn,
                transactionId,
                additionalParams[0] as number,
            );
            break;

        case "closeStream":
            await handleCloseStreamCommand(conn);
            break;

        case "releaseStream":
            await handleReleaseStreamCommand(
                conn,
                transactionId,
                additionalParams[0] as string,
            );
            break;

        case "FCPublish":
            await handleFCPublishCommand(
                conn,
                transactionId,
                additionalParams[0] as string,
            );
            break;

        case "publish":
            await handlePublishCommand(
                conn,
                transactionId,
                additionalParams[0] as string,
                additionalParams[1] as string,
            );
            break;

        default:
            console.warn(`Unhandled command: ${commandName}`);
    }
}

/**
 * Handle "connect" command
 * Client requests to connect to the application
 */
async function handleConnectCommand(
    conn: Deno.TcpConn,
    transactionId: number,
    commandObject: Record<string, any>,
): Promise<void> {
    console.log("Handling connect command");

    // Send Window Acknowledgement Size
    await sendWindowAcknowledgementSize(conn, 2500000);

    // Send Set Peer Bandwidth
    await sendSetPeerBandwidth(conn, 2500000, 2);

    // Send Stream Begin user control message
    await sendStreamBegin(conn, 0);

    // Send _result command
    const resultCommandObj = {
        fmsVer: "FMS/3,0,1,123",
        capabilities: 31,
        mode: 1,
    };

    const infoObj = {
        level: "status",
        code: "NetConnection.Connect.Success",
        description: "Connection succeeded.",
        objectEncoding: commandObject.objectEncoding || 0,
    };

    console.log("------------");

    await sendCommandAMF0(
        conn,
        "_result",
        transactionId,
        resultCommandObj,
        infoObj,
    );

    console.log("Connect command response sent");
}

/**
 * Handle "createStream" command
 * Client requests to create a new stream
 */
async function handleCreateStreamCommand(
    conn: Deno.TcpConn,
    transactionId: number,
): Promise<void> {
    console.log("Handling createStream command");

    // Import AMF0 encoding utilities
    const { encodeAMF0Command } = await import("./amf.ts");

    try {
        // Send _result command with stream ID
        // For simplicity, we'll use stream ID 1
        const streamId = 1;

        await sendCommandAMF0(conn, "_result", transactionId, null, streamId);

        console.log(
            `CreateStream command response sent with stream ID: ${streamId}`,
        );
    } catch (error) {
        console.error("Error handling createStream command:", error);
    }
}

/**
 * Handle "play" command
 * Client requests to play a stream
 */
async function handlePlayCommand(
    conn: Deno.TcpConn,
    transactionId: number,
    commandObject: Record<string, any>,
    streamName: string,
): Promise<void> {
    console.log(`Handling play command for stream: ${streamName}`);

    // Import AMF0 encoding utilities
    const { encodeAMF0Command } = await import("./amf.ts");

    try {
        // Send Stream Begin user control message
        await sendStreamBegin(conn, 1);

        // Send onStatus command for NetStream.Play.Start
        const infoObj = {
            level: "status",
            code: "NetStream.Play.Start",
            description: `Started playing ${streamName}.`,
            details: streamName,
        };

        await sendCommandAMF0(conn, "onStatus", 0, null, infoObj);

        console.log(`Play command response sent for stream: ${streamName}`);
    } catch (error) {
        console.error("Error handling play command:", error);
    }
}

/**
 * Handle "deleteStream" command
 * Client requests to delete a stream
 */
async function handleDeleteStreamCommand(
    conn: Deno.TcpConn,
    transactionId: number,
    streamId: number,
): Promise<void> {
    console.log(`Handling deleteStream command for stream ID: ${streamId}`);

    // For now, we'll just log it. In a real implementation, you'd clean up resources.
    console.log(`Stream ${streamId} deleted`);
}

/**
 * Handle "closeStream" command
 * Client requests to close a stream
 */
async function handleCloseStreamCommand(
    conn: Deno.TcpConn,
): Promise<void> {
    console.log("Handling closeStream command");

    // For now, we'll just log it. In a real implementation, you'd clean up resources.
    console.log("Stream closed");
}

/**
 * Handle "releaseStream" command
 * Client releases a publishing stream name
 */
async function handleReleaseStreamCommand(
    conn: Deno.TcpConn,
    transactionId: number,
    streamName: string,
): Promise<void> {
    console.log(`Handling releaseStream command for stream: ${streamName}`);

    // Send a _result command
    await sendCommandAMF0(conn, "_result", transactionId, null, null);

    console.log(`Stream ${streamName} released`);
}

/**
 * Handle "FCPublish" command
 * Client sends this before publishing
 */
async function handleFCPublishCommand(
    conn: Deno.TcpConn,
    transactionId: number,
    streamName: string,
): Promise<void> {
    console.log(`Handling FCPublish command for stream: ${streamName}`);

    // Send a _result command
    await sendCommandAMF0(conn, "_result", transactionId, null, null);

    console.log(`FCPublish for stream ${streamName} acknowledged`);
}

/**
 * Handle "publish" command
 * Client requests to publish a stream
 */
async function handlePublishCommand(
    conn: Deno.TcpConn,
    transactionId: number,
    streamName: string,
    publishType: string,
): Promise<void> {
    console.log(
        `Handling publish command for stream: ${streamName}, type: ${publishType}`,
    );

    // Import AMF0 encoding utilities

    try {
        // Send Stream Begin user control message
        await sendStreamBegin(conn, 1);

        // Send onStatus command for NetStream.Publish.Start
        const infoObj = {
            level: "status",
            code: "NetStream.Publish.Start",
            description: `Started publishing ${streamName}.`,
            details: streamName,
        };

        await sendCommandAMF0(conn, "onStatus", 0, null, infoObj);

        console.log(`Publish command response sent for stream: ${streamName}`);
    } catch (error) {
        console.error("Error handling publish command:", error);
    }
}

/**
 * Send an AMF0 command
 */
async function sendCommandAMF0(
    conn: Deno.TcpConn,
    commandName: string,
    transactionId: number,
    commandObject: Record<string, any> | null,
    ...additionalParams: any[]
): Promise<void> {
    // Import AMF0 encoding utilities

    // Encode the command
    const payload = encodeAMF0Command(
        commandName,
        transactionId,
        commandObject,
        ...additionalParams,
    );

    // Send the command message using the chunk utility
    await sendMessage(
        conn,
        { type: MessageType.COMMAND_AMF0, payload },
        3, // Chunk stream ID 3 for commands
        1, // Message stream ID 1
        4096, // Larger chunk size for commands
    );

    console.log(
        `Sent command: ${commandName}, TransactionID: ${transactionId}`,
    );
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
