import { assertEquals } from "jsr:@std/assert";

/**
 * AMF0 Data Types
 * https://rtmp.veriskope.com/pdf/amf0-file-format-specification.pdf
 */
export enum AMF0DataType {
    NUMBER = 0x00,
    BOOLEAN = 0x01,
    STRING = 0x02,
    OBJECT = 0x03,
    MOVIECLIP = 0x04, // Reserved, not supported
    NULL = 0x05,
    UNDEFINED = 0x06,
    REFERENCE = 0x07,
    ECMA_ARRAY = 0x08,
    OBJECT_END = 0x09,
    STRICT_ARRAY = 0x0A,
    DATE = 0x0B,
    LONG_STRING = 0x0C,
    UNSUPPORTED = 0x0D,
    RECORDSET = 0x0E, // Reserved, not supported
    XML_DOCUMENT = 0x0F,
    TYPED_OBJECT = 0x10,
    AVMPLUS_OBJECT = 0x11, // Switch to AMF3
}

export type AMF0Value =
    | number
    | boolean
    | string
    | { [key: string]: AMF0Value }
    | null
    | undefined
    | AMF0Value[]
    | Date;

/**
 * Parse an AMF0 value from a buffer at a given position
 * Returns the parsed value and the new position in the buffer
 */
export function parseAMF0Value(
    buffer: Uint8Array,
    position: number,
): { value: AMF0Value; newPosition: number } {
    const type = buffer[position];
    position++;

    switch (type) {
        case AMF0DataType.NUMBER: {
            // AMF0 numbers are 8-byte double-precision floating-point values
            // Extract the bytes and convert to a float64
            const view = new DataView(
                buffer.buffer,
                buffer.byteOffset + position,
                8,
            );
            const value = view.getFloat64(0, false); // false = big-endian
            return { value, newPosition: position + 8 };
        }

        case AMF0DataType.BOOLEAN: {
            const value = buffer[position] !== 0;
            return { value, newPosition: position + 1 };
        }

        case AMF0DataType.STRING: {
            // String length is a 2-byte integer
            const stringLength = (buffer[position] << 8) | buffer[position + 1];
            position += 2;

            // Extract the string data
            const stringData = buffer.slice(position, position + stringLength);
            const value = new TextDecoder().decode(stringData);
            return { value, newPosition: position + stringLength };
        }

        case AMF0DataType.OBJECT: {
            const obj: { [key: string]: AMF0Value } = {};

            // Parse property names and values until we reach an OBJECT_END marker
            while (true) {
                // Read property name (string)
                const propertyNameLength = (buffer[position] << 8) |
                    buffer[position + 1];
                position += 2;

                // If property name length is 0 and the next byte is OBJECT_END, we're done
                if (
                    propertyNameLength === 0 &&
                    buffer[position] === AMF0DataType.OBJECT_END
                ) {
                    position += 1; // Skip the OBJECT_END marker
                    break;
                }

                // Extract the property name
                const propertyNameData = buffer.slice(
                    position,
                    position + propertyNameLength,
                );
                const propertyName = new TextDecoder().decode(propertyNameData);
                position += propertyNameLength;

                // Parse the property value
                const { value, newPosition } = parseAMF0Value(buffer, position);
                obj[propertyName] = value;
                position = newPosition;
            }

            return { value: obj, newPosition: position };
        }

        case AMF0DataType.NULL:
            return { value: null, newPosition: position };

        case AMF0DataType.UNDEFINED:
            return { value: undefined, newPosition: position };

        case AMF0DataType.ECMA_ARRAY: {
            // ECMA array starts with a 4-byte count, but we'll ignore it
            // and just parse until we reach an OBJECT_END marker
            position += 4; // Skip count

            const obj: { [key: string]: AMF0Value } = {};

            // Parse property names and values until we reach an OBJECT_END marker
            while (true) {
                // Read property name (string)
                const propertyNameLength = (buffer[position] << 8) |
                    buffer[position + 1];
                position += 2;

                // If property name length is 0 and the next byte is OBJECT_END, we're done
                if (
                    propertyNameLength === 0 &&
                    buffer[position] === AMF0DataType.OBJECT_END
                ) {
                    position += 1; // Skip the OBJECT_END marker
                    break;
                }

                // Extract the property name
                const propertyNameData = buffer.slice(
                    position,
                    position + propertyNameLength,
                );
                const propertyName = new TextDecoder().decode(propertyNameData);
                position += propertyNameLength;

                // Parse the property value
                const { value, newPosition } = parseAMF0Value(buffer, position);
                obj[propertyName] = value;
                position = newPosition;
            }

            return { value: obj, newPosition: position };
        }

        case AMF0DataType.STRICT_ARRAY: {
            // Array length is a 4-byte integer
            const arrayLength = (buffer[position] << 24) |
                (buffer[position + 1] << 16) |
                (buffer[position + 2] << 8) |
                buffer[position + 3];
            position += 4;

            const array: AMF0Value[] = [];

            // Parse array elements
            for (let i = 0; i < arrayLength; i++) {
                const { value, newPosition } = parseAMF0Value(buffer, position);
                array.push(value);
                position = newPosition;
            }

            return { value: array, newPosition: position };
        }

        case AMF0DataType.DATE: {
            // Date is a double-precision timestamp (milliseconds since epoch)
            // followed by a 2-byte timezone offset (unused)
            const view = new DataView(
                buffer.buffer,
                buffer.byteOffset + position,
                8,
            );
            const timestamp = view.getFloat64(0, false); // false = big-endian
            position += 8;

            // Skip timezone offset (2 bytes, unused)
            position += 2;

            const value = new Date(timestamp);
            return { value, newPosition: position };
        }

        case AMF0DataType.LONG_STRING: {
            // Long string length is a 4-byte integer
            const stringLength = (buffer[position] << 24) |
                (buffer[position + 1] << 16) |
                (buffer[position + 2] << 8) |
                buffer[position + 3];
            position += 4;

            // Extract the string data
            const stringData = buffer.slice(position, position + stringLength);
            const value = new TextDecoder().decode(stringData);
            return { value, newPosition: position + stringLength };
        }

        default:
            console.warn(`Unsupported AMF0 type: ${type}`);
            return { value: null, newPosition: position };
    }
}

/**
 * Parse an RTMP command message in AMF0 format
 * Returns the command name, transaction ID, command object, and any additional parameters
 */
export function parseAMF0Command(buffer: Uint8Array): {
    commandName: string;
    transactionId: number;
    commandObject: Record<string, AMF0Value>;
    additionalParams: AMF0Value[];
} {
    let position = 0;

    // Parse command name (string)
    const { value: commandName, newPosition: pos1 } = parseAMF0Value(
        buffer,
        position,
    );
    position = pos1;

    // Parse transaction ID (number)
    const { value: transactionId, newPosition: pos2 } = parseAMF0Value(
        buffer,
        position,
    );
    position = pos2;

    // Parse command object (object)
    const { value: commandObject, newPosition: pos3 } = parseAMF0Value(
        buffer,
        position,
    );
    position = pos3;

    // Parse any additional parameters
    const additionalParams: AMF0Value[] = [];

    while (position < buffer.length) {
        const { value, newPosition } = parseAMF0Value(buffer, position);
        additionalParams.push(value);
        position = newPosition;
    }

    return {
        commandName: commandName as string,
        transactionId: transactionId as number,
        commandObject: commandObject as Record<string, AMF0Value>,
        additionalParams,
    };
}

/**
 * Encode an AMF0 value to a buffer
 * Returns a Uint8Array containing the encoded value
 */
export function encodeAMF0Value(value: AMF0Value): Uint8Array {
    if (typeof value === "number") {
        // Number: 1 byte type marker + 8 bytes double
        const buffer = new Uint8Array(9);
        buffer[0] = AMF0DataType.NUMBER;

        const view = new DataView(buffer.buffer, buffer.byteOffset + 1, 8);
        view.setFloat64(0, value, false); // false = big-endian

        return buffer;
    }

    if (typeof value === "boolean") {
        // Boolean: 1 byte type marker + 1 byte value
        const buffer = new Uint8Array(2);
        buffer[0] = AMF0DataType.BOOLEAN;
        buffer[1] = value ? 1 : 0;

        return buffer;
    }

    if (typeof value === "string") {
        const stringBytes = new TextEncoder().encode(value);

        if (stringBytes.length <= 65535) {
            // Regular string: 1 byte type marker + 2 bytes length + string data
            const buffer = new Uint8Array(3 + stringBytes.length);
            buffer[0] = AMF0DataType.STRING;
            buffer[1] = (stringBytes.length >> 8) & 0xFF;
            buffer[2] = stringBytes.length & 0xFF;
            buffer.set(stringBytes, 3);

            return buffer;
        } else {
            // Long string: 1 byte type marker + 4 bytes length + string data
            const buffer = new Uint8Array(5 + stringBytes.length);
            buffer[0] = AMF0DataType.LONG_STRING;
            buffer[1] = (stringBytes.length >> 24) & 0xFF;
            buffer[2] = (stringBytes.length >> 16) & 0xFF;
            buffer[3] = (stringBytes.length >> 8) & 0xFF;
            buffer[4] = stringBytes.length & 0xFF;
            buffer.set(stringBytes, 5);

            return buffer;
        }
    }

    if (value === null) {
        // Null: 1 byte type marker
        return new Uint8Array([AMF0DataType.NULL]);
    }

    if (value === undefined) {
        // Undefined: 1 byte type marker
        return new Uint8Array([AMF0DataType.UNDEFINED]);
    }

    if (Array.isArray(value)) {
        // Strict array: 1 byte type marker + 4 bytes length + array elements
        const buffers: Uint8Array[] = [];

        // Type marker and array length
        const header = new Uint8Array(5);
        header[0] = AMF0DataType.STRICT_ARRAY;
        header[1] = (value.length >> 24) & 0xFF;
        header[2] = (value.length >> 16) & 0xFF;
        header[3] = (value.length >> 8) & 0xFF;
        header[4] = value.length & 0xFF;

        buffers.push(header);

        // Array elements
        for (const element of value) {
            buffers.push(encodeAMF0Value(element));
        }

        // Combine all buffers
        const totalLength = buffers.reduce(
            (sum, buffer) => sum + buffer.length,
            0,
        );
        const result = new Uint8Array(totalLength);

        let position = 0;
        for (const buffer of buffers) {
            result.set(buffer, position);
            position += buffer.length;
        }

        return result;
    }

    if (value instanceof Date) {
        // Date: 1 byte type marker + 8 bytes timestamp + 2 bytes timezone (set to 0)
        const buffer = new Uint8Array(11);
        buffer[0] = AMF0DataType.DATE;

        const timestamp = value.getTime();
        const view = new DataView(buffer.buffer, buffer.byteOffset + 1, 8);
        view.setFloat64(0, timestamp, false); // false = big-endian

        // Timezone (always set to 0)
        buffer[9] = 0;
        buffer[10] = 0;

        return buffer;
    }

    if (typeof value === "object") {
        // Object or ECMA array
        const buffers: Uint8Array[] = [];

        // Type marker
        buffers.push(new Uint8Array([AMF0DataType.OBJECT]));

        // Object properties
        for (const [key, propValue] of Object.entries(value)) {
            // Property name (string without type marker)
            const keyBytes = new TextEncoder().encode(key);
            const keyBuffer = new Uint8Array(2 + keyBytes.length);
            keyBuffer[0] = (keyBytes.length >> 8) & 0xFF;
            keyBuffer[1] = keyBytes.length & 0xFF;
            keyBuffer.set(keyBytes, 2);

            buffers.push(keyBuffer);

            // Property value
            buffers.push(encodeAMF0Value(propValue));
        }

        // End marker (empty string followed by OBJECT_END byte)
        buffers.push(new Uint8Array([0, 0, AMF0DataType.OBJECT_END]));

        // Combine all buffers
        const totalLength = buffers.reduce(
            (sum, buffer) => sum + buffer.length,
            0,
        );
        const result = new Uint8Array(totalLength);

        let position = 0;
        for (const buffer of buffers) {
            result.set(buffer, position);
            position += buffer.length;
        }

        return result;
    }

    // Fallback
    console.warn(`Unsupported AMF0 value type: ${typeof value}`);
    return new Uint8Array([AMF0DataType.NULL]);
}

/**
 * Encode an RTMP command message in AMF0 format
 * Returns a Uint8Array containing the encoded command
 */
export function encodeAMF0Command(
    commandName: string,
    transactionId: number,
    commandObject: Record<string, AMF0Value> | null,
    ...additionalParams: AMF0Value[]
): Uint8Array {
    const buffers: Uint8Array[] = [];

    // Command name
    buffers.push(encodeAMF0Value(commandName));

    // Transaction ID
    buffers.push(encodeAMF0Value(transactionId));

    // Command object
    buffers.push(encodeAMF0Value(commandObject || null));

    // Additional parameters
    for (const param of additionalParams) {
        buffers.push(encodeAMF0Value(param));
    }

    // Combine all buffers
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const result = new Uint8Array(totalLength);

    let position = 0;
    for (const buffer of buffers) {
        result.set(buffer, position);
        position += buffer.length;
    }

    return result;
}
