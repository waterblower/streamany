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
                    message_stream_id: header.message_stream_id
                },
                totalLength: header.message_length,
                collectedLength: 0,
                chunks: []
            };
            messageStreams.set(chunkStreamId, messageStream);
        } else if (!messageStream) {
            // For non-Type0 chunks, we should already have a message stream
            console.error("Received non-Type0 chunk without prior Type0 chunk for stream:", chunkStreamId);
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
                chunks: []
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
        const dataToWrite = Math.min(chunk.data.length, messageStream.totalLength - offset);
        payload.set(chunk.data.subarray(0, dataToWrite), offset);
        offset += dataToWrite;
        
        if (offset >= messageStream.totalLength) {
            break;
        }
    }
    
    if (offset !== messageStream.totalLength) {
        console.warn(`Payload size mismatch: expected ${messageStream.totalLength}, got ${offset}`);
    }
    
    return {
        header: messageStream.messageHeader,
        payload
    };
}
