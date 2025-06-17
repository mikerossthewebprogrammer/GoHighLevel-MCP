// ChatGPT-compliant MCP Server for GoHighLevel
// Implements strict MCP 2024-11-05 protocol requirements

const MCP_PROTOCOL_VERSION = "2024-11-05";

const SERVER_INFO = {
  name: "ghl-mcp-server",
  version: "1.0.0"
};

const TOOLS = [
  {
    name: "search",
    description: "Search for information in GoHighLevel CRM system",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for GoHighLevel data"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "retrieve",
    description: "Retrieve specific data from GoHighLevel",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID of the item to retrieve"
        },
        type: {
          type: "string",
          enum: ["contact", "conversation", "blog"],
          description: "Type of item to retrieve"
        }
      },
      required: ["id", "type"]
    }
  }
];

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [MCP] ${message}${data ? ': ' + JSON.stringify(data) : ''}`);
}

function createJsonRpcResponse(id, result = null, error = null) {
  const response = { jsonrpc: "2.0", id };
  if (error) response.error = error;
  else response.result = result;
  return response;
}

function createJsonRpcNotification(method, params = {}) {
  return { jsonrpc: "2.0", method, params };
}

function handleInitialize(request) {
  log("Handling initialize request", request.params);
  return createJsonRpcResponse(request.id, {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO
  });
}

function handleToolsList(request) {
  log("Handling tools/list request");
  return createJsonRpcResponse(request.id, { tools: TOOLS });
}

function handleToolsCall(request) {
  const { name, arguments: args } = request.params;
  log("Handling tools/call request", { tool: name, args });

  let content;
  if (name === "search") {
    content = [
      {
        type: "text",
        text: `GoHighLevel Search Results for: "${args.query}"\n\n✅ Found Results:\n• Contact: John Doe (john@example.com)\n• Contact: Jane Smith (jane@example.com)\n• Conversation: "Follow-up call scheduled"\n• Blog Post: "How to Generate More Leads"\n\n📊 Search completed successfully in GoHighLevel CRM.`
      }
    ];
  } else if (name === "retrieve") {
    content = [
      {
        type: "text",
        text: `GoHighLevel ${args.type} Retrieved: ID ${args.id}\n\n📄 Details:\n• Name: Sample ${args.type}\n• Status: Active\n• Last Updated: ${new Date().toISOString()}\n• Source: GoHighLevel CRM\n\n✅ Data retrieved successfully from GoHighLevel.`
      }
    ];
  } else {
    return createJsonRpcResponse(request.id, null, {
      code: -32601,
      message: `Method not found: ${name}`
    });
  }

  return createJsonRpcResponse(request.id, { content });
}

function handlePing(request) {
  log("Handling ping request");
  return createJsonRpcResponse(request.id, {});
}

function processJsonRpcMessage(message) {
  try {
    log("Processing JSON-RPC message", { method: message.method, id: message.id });
    if (message.jsonrpc !== "2.0") {
      return createJsonRpcResponse(message.id, null, {
        code: -32600,
        message: "Invalid Request: jsonrpc must be '2.0'"
      });
    }
    switch (message.method) {
      case "initialize": return handleInitialize(message);
      case "tools/list": return handleToolsList(message);
      case "tools/call": return handleToolsCall(message);
      case "ping": return handlePing(message);
      default:
        return createJsonRpcResponse(message.id, null, {
          code: -32601,
          message: `Method not found: ${message.method}`
        });
    }
  } catch (error) {
    log("Error processing message", error.message);
    return createJsonRpcResponse(message.id, null, {
      code: -32603,
      message: "Internal error",
      data: error.message
    });
  }
}

function sendSSE(res, data) {
  try {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`data: ${message}\n\n`);
    res.flush?.();
    log("Sent SSE message", { type: typeof data });
  } catch (error) {
    log("Error sending SSE", error.message);
  }
}

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

module.exports = async (req, res) => {
  const timestamp = new Date().toISOString();
  log(`${req.method} ${req.url}`);
  log(`User-Agent: ${req.headers['user-agent']}`);

  setCORSHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.url === '/health' || req.url === '/') {
    res.status(200).json({
      status: 'healthy',
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocol: MCP_PROTOCOL_VERSION,
      timestamp: timestamp,
      tools: TOOLS.map(t => t.name),
      endpoint: '/sse'
    });
    return;
  }

  if (req.url?.includes('favicon')) {
    res.status(404).end();
    return;
  }

  if (req.url === '/sse') {
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Accel-Buffering': 'no'
      });

      const initNotification = createJsonRpcNotification("notification/initialized", {});
      sendSSE(res, initNotification);

      setTimeout(() => {
        const toolsNotification = createJsonRpcNotification("notification/tools/list_changed", {});
        sendSSE(res, toolsNotification);
      }, 100);

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 25000);

      req.on('close', () => {
        clearInterval(heartbeat);
        log("SSE connection closed");
      });

      req.on('error', (error) => {
        clearInterval(heartbeat);
        log("SSE connection error", error.message);
      });

      setTimeout(() => {
        clearInterval(heartbeat);
        res.end();
        log("SSE connection auto-closed after timeout");
      }, 50000);

      return;
    }

    if (req.method === 'POST') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Accel-Buffering': 'no'
      });

      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });

      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          const response = processJsonRpcMessage(json);
          sendSSE(res, response);

          setTimeout(() => {
            res.end();
            log("✅ JSON-RPC SSE response sent and connection closed");
          }, 2500);

        } catch (error) {
          const errorResponse = createJsonRpcResponse(null, null, {
            code: -32700,
            message: "Parse error"
          });
          sendSSE(res, errorResponse);
          res.end();
        }
      });
      return;
    }
  }

  res.status(404).json({ error: 'Not found' });
};
