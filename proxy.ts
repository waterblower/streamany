// rtmp_proxy.ts

/**
 * Simple RTMP proxy for forwarding streams from local sources to remote streaming platforms
 *
 * Usage:
 * deno run --allow-net rtmp_proxy.ts [target_url]
 *
 * Example:
 * deno run --allow-net rtmp_proxy.ts rtmp://a.rtmp.youtube.com/live2/your-stream-key
 */

// Configuration
const LOCAL_PORT = 1935;
const LOCAL_HOST = "localhost";
const DEFAULT_TARGET = "rtmp://a.rtmp.youtube.com/live2/your-stream-key"; // Replace with your actual target

// Parse target URL from arguments or use default
const targetUrl = Deno.args[0] || DEFAULT_TARGET;
console.log(`RTMP Proxy starting...`);
console.log(`Local endpoint: rtmp://${LOCAL_HOST}:${LOCAL_PORT}/live/stream`);
console.log(`Target endpoint: ${targetUrl}`);

// Start listening for incoming connections
const listener = Deno.listen({
  port: LOCAL_PORT,
  hostname: LOCAL_HOST,
});
console.log(`Listening at ${LOCAL_HOST}:${LOCAL_PORT}`);

// Process each incoming connection
for await (const incomingConn of listener) {
  // Handle connection in a new task to allow multiple concurrent connections
  handleConnection(incomingConn, targetUrl);
}

/**
 * Handle a client connection by establishing a connection to the target
 * and forwarding data in both directions
 */
async function handleConnection(incomingConn: Deno.Conn, targetUrl: string) {

  try {
    // Parse the target URL to get hostname and port
    const url = new URL(targetUrl);
    const host = url.hostname;
    const port = url.port ? parseInt(url.port) : 1935; // RTMP default port

    console.log(`Connecting to target: ${host}:${port}`);

    // Connect to the target RTMP server
    const outgoingConn = await Deno.connect({
      hostname: host,
      port: port,
    });

    console.log(`Connected to target: ${host}:${port}`);

    // Set up two-way data forwarding
    const forward1 = forwardData(incomingConn, outgoingConn, "client -> target");
    const forward2 = forwardData(outgoingConn, incomingConn, "target -> client");

    // Wait for either forwarding direction to complete
    await Promise.race([forward1, forward2]);

    console.log("Connection closed");
  } catch (error) {
    console.error(`Error handling connection:`, error);
    incomingConn.close();
  }
}

/**
 * Forward data from source to destination
 */
async function forwardData(source: Deno.Conn, destination: Deno.Conn, label: string) {
  const buffer = new Uint8Array(8192); // 8KB buffer

  try {
    // Keep reading and forwarding until connection closes
    while (true) {
      const bytesRead = await source.read(buffer);
      if (bytesRead === null) {
        console.log(`${label}: Connection closed by source`);
        break;
      }

      // Forward the data to the destination
      const data = buffer.subarray(0, bytesRead);
      await destination.write(data);

      // Log summary of forwarded data
      console.log(`${label}: Forwarded ${bytesRead} bytes`);
    }
  } catch (error) {
    console.error(`${label}: Error forwarding data:`, error);
  } finally {
    // Close both connections when forwarding ends
    try { source.close(); } catch {}
    try { destination.close(); } catch {}
  }
}
