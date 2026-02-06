# Slack MCP Server - Logical Flow & Architecture

## Table of Contents
1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Core Components](#core-components)
4. [Application Startup Flow](#application-startup-flow)
5. [Request Handling Flow](#request-handling-flow)
6. [Tool Execution Flow](#tool-execution-flow)
7. [Channel Caching Mechanism](#channel-caching-mechanism)
8. [Transport Layer Details](#transport-layer-details)
9. [Authentication & Authorization](#authentication--authorization)
10. [Session Management](#session-management)
11. [Data Flow Diagrams](#data-flow-diagrams)
12. [Error Handling](#error-handling)

---

## Overview

The Slack MCP (Model Context Protocol) Server is a TypeScript-based application that provides a standardized interface for AI models to interact with Slack workspaces. It acts as a bridge between AI systems and Slack's API, exposing various Slack operations as MCP tools.

**Key Purpose**: Enable AI models to:
- Search for Slack channels
- Post messages and replies
- Add reactions
- Retrieve message history
- Manage user information

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Client/Consumer                      │
│              (Claude, GPT, or other AI models)               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   Transport Layer (stdio/HTTP) │
        └──────────────┬─────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │      MCP Server (McpServer)   │
        │    - Tool Registration         │
        │    - Request Routing           │
        │    - Schema Validation (Zod)   │
        └──────────────┬─────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │      SlackClient              │
        │    - API Communication         │
        │    - Channel Caching           │
        │    - Request Execution         │
        └──────────────┬─────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │      Slack Web API            │
        │    (api.slack.com)            │
        └──────────────────────────────┘
```

---

## Core Components

### 1. **SlackClient Class**
- **Responsibility**: Manages all direct communication with Slack's Web API
- **Key Features**:
  - Maintains OAuth bot token for authentication
  - Implements channel caching for fast lookups
  - Provides methods for all Slack operations
  - Handles HTTP requests to Slack API endpoints

**Key Properties**:
```typescript
- botHeaders: Authorization and content-type headers
- channelCache: Map<string, any[]> - Indexed by channel name
- channelCacheById: Map<string, any> - Indexed by channel ID
- cacheInitialized: boolean - Cache initialization status
```

### 2. **McpServer (MCP SDK)**
- **Responsibility**: Implements the Model Context Protocol specification
- **Key Features**:
  - Tool registration and management
  - Input validation using Zod schemas
  - Request/response handling
  - Protocol-compliant communication

### 3. **Transport Layer**
Two transport mechanisms are supported:

#### a) **StdioServerTransport**
- Communication via standard input/output streams
- Best for: Command-line tools, local integrations
- Synchronous, direct process communication

#### b) **StreamableHTTPServerTransport**
- Communication via HTTP/REST endpoints
- Best for: Remote servers, web-based integrations
- Supports Server-Sent Events (SSE) for bidirectional streaming
- Session-based with UUID session IDs

### 4. **Express Application (HTTP Mode Only)**
- **Responsibility**: HTTP server for Streamable HTTP transport
- **Endpoints**:
  - `POST /mcp` - Client-to-server messages
  - `GET /mcp` - Server-to-client notifications (SSE)
  - `DELETE /mcp` - Session termination
  - `GET /health` - Health check (no auth required)

---

## Application Startup Flow

### Initialization Sequence

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Parse Command Line Arguments                              │
│    - Transport type (stdio/http)                             │
│    - Port (for HTTP transport)                               │
│    - Auth token (for HTTP transport)                         │
└──────────────────┬────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Validate Environment Variables                            │
│    - SLACK_BOT_TOKEN (required)                              │
│    - SLACK_TEAM_ID (required)                                │
│    - SLACK_CHANNEL_IDS (optional)                            │
│    - AUTH_TOKEN (optional, HTTP only)                        │
└──────────────────┬────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Instantiate SlackClient                                    │
│    - Configure bot authorization headers                      │
│    - Initialize empty cache maps                              │
└──────────────────┬────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Initialize Channel Cache                                  │
│    - Fetch all channels via pagination                       │
│    - Populate channelCache (by name)                          │
│    - Populate channelCacheById (by ID)                        │
│    - Set cacheInitialized = true                              │
└──────────────────┬────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Setup Transport & Start Server                            │
│    STDIO: Connect McpServer to StdioServerTransport          │
│    HTTP: Start Express server, setup MCP endpoints           │
└──────────────────┬────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Setup Graceful Shutdown Handlers                          │
│    - Register SIGINT, SIGTERM, SIGQUIT handlers              │
│    - Ensure clean shutdown of HTTP server if applicable       │
└──────────────────────────────────────────────────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │ Server Ready  │
            └──────────────┘
```

### Detailed Initialization Steps

#### Step 1: Argument Parsing (`parseArgs()`)
```typescript
Reads process.argv to extract:
  --transport <stdio|http>  (default: stdio)
  --port <number>           (default: 3000)
  --token <string>          (optional)
  --help / -h               (shows usage)
```

#### Step 2: Environment Validation
```typescript
Required:
  - SLACK_BOT_TOKEN: OAuth bot token (starts with xoxb-)
  - SLACK_TEAM_ID: Workspace team ID (starts with T)

Optional:
  - SLACK_CHANNEL_IDS: Comma-separated predefined channel IDs
  - AUTH_TOKEN: Bearer token for HTTP auth (if not using --token)
```

#### Step 3: SlackClient Instantiation
```typescript
const slackClient = new SlackClient(botToken);
// Sets up authorization headers:
{
  Authorization: `Bearer ${botToken}`,
  "Content-Type": "application/json"
}
```

#### Step 4: Channel Cache Initialization
**Critical for Performance**: This step loads all workspace channels into memory.

**Process**:
1. Check if `SLACK_CHANNEL_IDS` environment variable is set
   - **If set**: Fetch only specific channels via `conversations.info` API
   - **If not set**: Fetch all channels via `conversations.list` API with pagination

2. Pagination loop (when fetching all channels):
   ```typescript
   do {
     response = await getChannels(limit=200, cursor)
     allChannels.push(...response.channels)
     cursor = response.response_metadata?.next_cursor
   } while (cursor)
   ```

3. Populate cache maps:
   ```typescript
   For each channel:
     - Normalize name: lowercase, strip # prefix
     - channelCache.set(normalizedName, [...existingChannels, channel])
     - channelCacheById.set(channel.id, channel)
   ```

**Why Cache?**
- Eliminates API calls for channel searches
- Enables fast, partial-match searches
- Supports case-insensitive matching
- No rate limit concerns for search operations

#### Step 5: Transport Setup

**STDIO Mode**:
```typescript
server = createSlackServer(slackClient)
transport = new StdioServerTransport()
await server.connect(transport)
// Listens on stdin, writes to stdout
```

**HTTP Mode**:
```typescript
app = express()
app.use(express.json())
app.post('/mcp', authMiddleware, handleMcpRequest)
app.get('/mcp', authMiddleware, handleSessionRequest)
app.delete('/mcp', authMiddleware, handleSessionRequest)
app.get('/health', healthCheck)
app.listen(port)
```

---

## Request Handling Flow

### STDIO Transport Flow

```
AI Client
   │
   ├─ Writes JSON-RPC request to stdin
   │
   ▼
StdioServerTransport
   │
   ├─ Parses JSON-RPC message
   │
   ▼
McpServer
   │
   ├─ Validates request schema
   ├─ Routes to appropriate tool handler
   │
   ▼
Tool Handler (async function)
   │
   ├─ Extracts validated parameters
   ├─ Calls SlackClient method
   │
   ▼
SlackClient
   │
   ├─ Makes HTTP request to Slack API
   ├─ Returns JSON response
   │
   ▼
Tool Handler
   │
   ├─ Formats response as MCP content
   │
   ▼
McpServer
   │
   ├─ Wraps in JSON-RPC response
   │
   ▼
StdioServerTransport
   │
   ├─ Writes JSON-RPC response to stdout
   │
   ▼
AI Client receives response
```

### HTTP Transport Flow

#### First Request (Initialization)

```
AI Client
   │
   ├─ POST /mcp (no session ID)
   │  Body: { method: "initialize", ... }
   │  Headers: { Authorization: "Bearer <token>" }
   │
   ▼
Express App
   │
   ├─ authMiddleware validates token
   │
   ▼
POST /mcp Handler
   │
   ├─ No session ID found
   ├─ method === "initialize" detected
   │
   ▼
Create New Transport
   │
   ├─ transport = new StreamableHTTPServerTransport({
   │     sessionIdGenerator: () => randomUUID()
   │   })
   │
   ▼
Session Initialization Callback
   │
   ├─ transports[sessionId] = transport
   │
   ▼
Create & Connect MCP Server
   │
   ├─ server = createSlackServer(slackClient)
   ├─ await server.connect(transport)
   │
   ▼
Handle Request
   │
   ├─ await transport.handleRequest(req, res, body)
   │
   ▼
Response to Client
   │
   ├─ Headers: { "mcp-session-id": "<uuid>" }
   ├─ Body: JSON-RPC response with server capabilities
   │
   ▼
AI Client stores session ID
```

#### Subsequent Requests (With Session)

```
AI Client
   │
   ├─ POST /mcp
   │  Headers: { 
   │    Authorization: "Bearer <token>",
   │    "mcp-session-id": "<uuid>"
   │  }
   │  Body: { method: "tools/call", params: {...} }
   │
   ▼
Express App
   │
   ├─ authMiddleware validates token
   │
   ▼
POST /mcp Handler
   │
   ├─ Extract session ID from headers
   ├─ Lookup: transport = transports[sessionId]
   │
   ▼
Reuse Existing Transport
   │
   ├─ await transport.handleRequest(req, res, body)
   │
   ▼
McpServer processes request
   │
   ├─ Routes to tool handler
   ├─ Executes Slack operation
   ├─ Returns result
   │
   ▼
Response to Client
   │
   ├─ Body: JSON-RPC response with tool result
   │
   ▼
AI Client receives result
```

#### Server-to-Client Notifications (SSE)

```
AI Client
   │
   ├─ GET /mcp
   │  Headers: { 
   │    "mcp-session-id": "<uuid>",
   │    Authorization: "Bearer <token>"
   │  }
   │
   ▼
Express App
   │
   ├─ authMiddleware validates token
   │
   ▼
GET /mcp Handler
   │
   ├─ Lookup transport by session ID
   │
   ▼
StreamableHTTPServerTransport
   │
   ├─ Establishes Server-Sent Events stream
   ├─ Connection stays open
   ├─ Sends events as they occur:
   │    - Progress updates
   │    - Notifications
   │    - Server-initiated messages
   │
   ▼
AI Client receives real-time updates
```

---

## Tool Execution Flow

All tools follow a similar pattern. Here's a detailed breakdown:

### Example: `slack_post_message` Tool

#### 1. Tool Registration (During Server Creation)

```typescript
server.registerTool(
  "slack_post_message",           // Tool name
  {
    title: "Post Slack Message",
    description: "Post a new message to a Slack channel or direct message to user",
    inputSchema: {
      channel_id: z.string().describe("The ID of the channel or user to post to"),
      text: z.string().describe("The message text to post"),
    },
  },
  async ({ channel_id, text }) => {  // Handler function
    const response = await slackClient.postMessage(channel_id, text);
    return {
      content: [{ type: "text", text: JSON.stringify(response) }],
    };
  }
);
```

#### 2. Execution Flow

```
┌────────────────────────────────────────────────────────────┐
│ AI Client Calls Tool                                        │
│ {                                                           │
│   method: "tools/call",                                     │
│   params: {                                                 │
│     name: "slack_post_message",                             │
│     arguments: {                                            │
│       channel_id: "C12345678",                              │
│       text: "Hello, Slack!"                                 │
│     }                                                        │
│   }                                                          │
│ }                                                            │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ McpServer Receives Request                                  │
│ - Parses JSON-RPC message                                   │
│ - Identifies tool: "slack_post_message"                     │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Schema Validation (Zod)                                     │
│ - Validates channel_id is string                            │
│ - Validates text is string                                  │
│ - Throws error if validation fails                          │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Tool Handler Invocation                                     │
│ async ({ channel_id, text }) => {                           │
│   // Validated arguments are passed here                    │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ SlackClient.postMessage() Call                              │
│ - Constructs Slack API request:                             │
│   POST https://slack.com/api/chat.postMessage               │
│   Headers: { Authorization: "Bearer xoxb-..." }             │
│   Body: { channel: "C12345678", text: "Hello, Slack!" }     │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Slack API Processes Request                                 │
│ - Validates bot permissions                                 │
│ - Posts message to channel                                  │
│ - Returns response:                                         │
│   {                                                          │
│     ok: true,                                                │
│     channel: "C12345678",                                    │
│     ts: "1234567890.123456",                                 │
│     message: { ... }                                         │
│   }                                                           │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ SlackClient Returns JSON Response                           │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Tool Handler Formats Response                               │
│ return {                                                     │
│   content: [                                                 │
│     {                                                        │
│       type: "text",                                          │
│       text: JSON.stringify(response)                         │
│     }                                                        │
│   ]                                                          │
│ }                                                            │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ McpServer Wraps in JSON-RPC Response                        │
│ {                                                            │
│   jsonrpc: "2.0",                                            │
│   id: <request_id>,                                          │
│   result: {                                                  │
│     content: [...]                                           │
│   }                                                          │
│ }                                                            │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Transport Sends Response to AI Client                       │
└────────────────────────────────────────────────────────────┘
```

---

## Channel Caching Mechanism

### Purpose
The channel cache eliminates the need for API calls when searching for channels by name, providing instant search results with partial matching.

### Cache Structure

```typescript
class SlackClient {
  private channelCache: Map<string, any[]>
  // Key: Normalized channel name (lowercase, no # prefix)
  // Value: Array of channel objects (handles name collisions)
  
  private channelCacheById: Map<string, any>
  // Key: Channel ID (e.g., "C12345678")
  // Value: Single channel object
}
```

### Cache Population Flow

```
┌────────────────────────────────────────────────────────────┐
│ initializeChannelCache() Called                             │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Check if SLACK_CHANNEL_IDS is Set                          │
└────────────────┬───────────────────────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
         ▼                ▼
  [Predefined]      [Fetch All]
         │                │
         │                ▼
         │     ┌────────────────────────────────┐
         │     │ Pagination Loop                 │
         │     │ - Start with no cursor          │
         │     │ - Fetch 200 channels per page   │
         │     │ - Continue until no next_cursor │
         │     └───────────┬────────────────────┘
         │                │
         │                ▼
         │     ┌────────────────────────────────┐
         │     │ API Call: conversations.list   │
         │     │ Params:                        │
         │     │ - types: public/private        │
         │     │ - exclude_archived: true       │
         │     │ - limit: 200                   │
         │     │ - team_id: <workspace_id>      │
         │     │ - cursor: <pagination_cursor>  │
         │     └───────────┬────────────────────┘
         │                │
         ▼                ▼
┌────────────────────────────────────────────────────────────┐
│ For Each Channel Object                                     │
│ {                                                            │
│   id: "C12345678",                                           │
│   name: "general",                                           │
│   is_private: false,                                         │
│   ...                                                        │
│ }                                                            │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Normalize Channel Name                                      │
│ "General" → "general"                                        │
│ "#engineering" → "engineering"                               │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Update channelCache                                         │
│ - Get or create array for normalizedName                    │
│ - Push channel object to array                              │
│ channelCache.set("general", [channelObj, ...])              │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Update channelCacheById                                     │
│ channelCacheById.set("C12345678", channelObj)               │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Set cacheInitialized = true                                 │
└────────────────────────────────────────────────────────────┘
```

### Cache Usage: `slack_search_channels` Tool

```
┌────────────────────────────────────────────────────────────┐
│ AI Client Searches: "eng"                                   │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ searchChannelsByName("eng") Called                          │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Normalize Query                                             │
│ "eng" → "eng"                                               │
│ "#Eng" → "eng"                                              │
│ "Engineering" → "engineering"                               │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Iterate Through channelCache                                │
│ For each (name, channels) pair:                             │
│   if name.includes("eng"):                                  │
│     results.push(...channels)                               │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Matches Found:                                              │
│ - "engineering"    → [channel1]                             │
│ - "frontend-eng"   → [channel2]                             │
│ - "general-eng"    → [channel3]                             │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Return Results (No API Call Made!)                          │
│ {                                                            │
│   ok: true,                                                  │
│   channels: [channel1, channel2, channel3],                 │
│   count: 3                                                   │
│ }                                                            │
└────────────────────────────────────────────────────────────┘
```

### Cache Benefits

1. **Performance**: Instant search results (no network latency)
2. **Rate Limits**: No Slack API calls consumed for searches
3. **User Experience**: Fast, responsive searches
4. **Partial Matching**: Find "general" by searching "gen"
5. **Case Insensitivity**: "Engineering" = "engineering" = "ENGINEERING"

### Cache Limitations

1. **No Auto-Refresh**: Cache is built once on startup
2. **Memory Overhead**: All channels stored in memory
3. **Stale Data**: New channels created after startup won't appear
4. **Manual Refresh Required**: Restart server to refresh cache

> **Note**: The code includes a TODO comment for implementing TTL-based cache refresh in the future.

---

## Transport Layer Details

### STDIO Transport

**Architecture**:
```
┌─────────────────────────────────────────────────────────────┐
│                        Host Process                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Slack MCP Server Process                   │ │
│  │                                                          │ │
│  │  stdin  ◄────── StdioServerTransport ◄────── McpServer │ │
│  │  stdout ────────► StdioServerTransport ──────► McpServer│ │
│  │                                                          │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Communication Protocol**:
- **Format**: JSON-RPC 2.0 over newline-delimited JSON
- **Input**: Each line on stdin is a JSON-RPC request
- **Output**: Each line on stdout is a JSON-RPC response

**Example Exchange**:
```
stdin  ← {"jsonrpc":"2.0","method":"tools/list","id":1}
stdout → {"jsonrpc":"2.0","result":{"tools":[...]},"id":1}

stdin  ← {"jsonrpc":"2.0","method":"tools/call","params":{...},"id":2}
stdout → {"jsonrpc":"2.0","result":{...},"id":2}
```

**Use Cases**:
- Local AI assistants (Claude Desktop, etc.)
- Command-line tools
- Direct process integration
- Low-latency, high-throughput scenarios

---

### Streamable HTTP Transport

**Architecture**:
```
┌──────────────────────────────────────────────────────────────┐
│                      AI Client (Remote)                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  HTTP Client                                             │ │
│  │  - POST /mcp    (send requests)                          │ │
│  │  - GET  /mcp    (receive notifications via SSE)          │ │
│  │  - DELETE /mcp  (terminate session)                      │ │
│  └─────────────────────────────────────────────────────────┘ │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         │ HTTP/1.1 + SSE
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                    Express HTTP Server                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Middleware Stack                                        │ │
│  │  1. express.json()        (parse JSON bodies)            │ │
│  │  2. authMiddleware        (validate Bearer token)        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Route Handlers                                          │ │
│  │  - POST /mcp    → Create/use session, handle request    │ │
│  │  - GET  /mcp    → Stream server events to client        │ │
│  │  - DELETE /mcp  → Terminate session, cleanup            │ │
│  │  - GET  /health → Health check (no auth)                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Session Management                                      │ │
│  │  transports: { [sessionId]: StreamableHTTPServerTransport}│ │
│  └─────────────────────────────────────────────────────────┘ │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────────┐
         │  StreamableHTTPServerTransport    │
         │  - Session ID: UUID               │
         │  - Bidirectional communication    │
         │  - SSE for server→client          │
         └───────────────┬───────────────────┘
                         │
                         ▼
                 ┌───────────────┐
                 │   McpServer    │
                 └───────────────┘
```

**Request Flow Details**:

#### POST /mcp (Client → Server)

**Headers**:
```
Authorization: Bearer <token>
mcp-session-id: <uuid>       (optional on first request)
Content-Type: application/json
```

**Body** (JSON-RPC):
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "slack_post_message",
    "arguments": {
      "channel_id": "C12345678",
      "text": "Hello!"
    }
  },
  "id": 1
}
```

**Response**:
```
Headers:
  mcp-session-id: <uuid>       (set on first response)
  
Body:
{
  "jsonrpc": "2.0",
  "result": { ... },
  "id": 1
}
```

#### GET /mcp (Server → Client via SSE)

**Headers**:
```
Authorization: Bearer <token>
mcp-session-id: <uuid>       (required)
```

**Response** (Server-Sent Events):
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: message
data: {"type":"notification","notification":{...}}

event: message
data: {"type":"progress","progress":{...}}
```

**Connection Lifecycle**:
- Client establishes long-lived connection
- Server pushes events as they occur
- Client processes events in real-time
- Connection can be re-established if dropped

#### DELETE /mcp (Session Termination)

**Headers**:
```
Authorization: Bearer <token>
mcp-session-id: <uuid>       (required)
```

**Effect**:
1. Closes transport connection
2. Removes session from `transports` map
3. Cleans up resources
4. Returns 200 OK

---

## Authentication & Authorization

### Bearer Token Authentication (HTTP Transport Only)

#### Token Priority

```
1. Command Line Argument: --token <value>
   └─ Highest priority, explicit user intent

2. Environment Variable: AUTH_TOKEN=<value>
   └─ Fallback if --token not provided

3. Auto-Generated: randomUUID()
   └─ Used if neither above is set
   └─ Logged to console for user reference
```

#### Token Validation Flow

```
┌────────────────────────────────────────────────────────────┐
│ HTTP Request Arrives                                        │
│ Headers: { Authorization: "Bearer abc123..." }              │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ authMiddleware(req, res, next)                              │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
         ┌───────┴────────┐
         │ authToken set? │
         └───────┬────────┘
                 │
        ┌────────┴─────────┐
        │ No               │ Yes
        ▼                  ▼
  ┌──────────┐      ┌─────────────────────┐
  │ Skip     │      │ Check Authorization │
  │ Auth     │      │ Header              │
  └────┬─────┘      └──────────┬──────────┘
       │                       │
       ▼                       ▼
  ┌─────────┐         ┌────────────────┐
  │ next()  │         │ Missing/Invalid│
  └─────────┘         │ Header?        │
                      └────┬───────────┘
                           │
                  ┌────────┴──────────┐
                  │ Yes               │ No
                  ▼                   ▼
           ┌─────────────┐     ┌──────────────┐
           │ Return 401  │     │ Extract Token│
           │ Unauthorized│     │ (remove       │
           └─────────────┘     │ "Bearer ")   │
                               └──────┬───────┘
                                      │
                                      ▼
                               ┌──────────────┐
                               │ Compare Token│
                               └──────┬───────┘
                                      │
                           ┌──────────┴──────────┐
                           │ Match?              │
                           └──────────┬──────────┘
                                      │
                           ┌──────────┴──────────┐
                           │ No                  │ Yes
                           ▼                     ▼
                    ┌─────────────┐       ┌──────────┐
                    │ Return 401  │       │ next()   │
                    │ Invalid Token│      └──────────┘
                    └─────────────┘
```

#### Excluded Endpoints

The `/health` endpoint bypasses authentication:
```typescript
app.get('/health', (req, res) => {
  // No authMiddleware applied
  res.status(200).json({ ... });
});
```

---

## Session Management

### Session Lifecycle (HTTP Transport)

```
┌────────────────────────────────────────────────────────────┐
│ 1. Session Creation                                         │
│                                                              │
│ Client → POST /mcp (no session ID, method: "initialize")    │
│                                                              │
│ Server:                                                      │
│   ├─ Creates StreamableHTTPServerTransport                  │
│   ├─ Generates session ID: randomUUID()                     │
│   ├─ Stores in transports map                               │
│   └─ Returns session ID in response headers                 │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ 2. Session Usage                                            │
│                                                              │
│ Client → POST /mcp (with session ID header)                 │
│                                                              │
│ Server:                                                      │
│   ├─ Looks up transport: transports[sessionId]              │
│   ├─ Reuses existing MCP server connection                  │
│   └─ Processes request with full context                    │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│ 3. Session Termination                                      │
│                                                              │
│ Client → DELETE /mcp (with session ID)                      │
│                                                              │
│ Server:                                                      │
│   ├─ Closes transport                                        │
│   ├─ Removes from transports map                            │
│   └─ Cleans up resources                                    │
└────────────────────────────────────────────────────────────┘
```

### Session State Storage

```typescript
// Server-side session map
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Session creation
transport.onsessioninitialized = (sessionId) => {
  transports[sessionId] = transport;
};

// Session cleanup
transport.onclose = () => {
  if (transport.sessionId) {
    delete transports[transport.sessionId];
  }
};
```

### Session Context

Each session maintains:
- **Transport instance**: Dedicated StreamableHTTPServerTransport
- **MCP server instance**: One McpServer per transport
- **SlackClient reference**: Shared across all sessions
- **Request history**: Managed by MCP SDK

**Important**: The `SlackClient` (including channel cache) is shared across all sessions, while each session has its own transport and MCP server instance.

---

## Data Flow Diagrams

### Complete End-to-End Flow: Posting a Slack Message

```
┌─────────────────────────────────────────────────────────────────────────┐
│ AI Model (e.g., Claude)                                                  │
│ "Post 'Meeting at 3pm' to #general channel"                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ AI Client Software                                                       │
│ 1. Calls slack_search_channels("general")                               │
│ 2. Gets channel_id: "C12345678"                                          │
│ 3. Calls slack_post_message(channel_id, "Meeting at 3pm")               │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │ Transport Layer      │
                      │ (stdio or HTTP)      │
                      └──────────┬───────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ MCP Server - Tool Routing                                                │
│                                                                           │
│ Request 1: slack_search_channels                                         │
│   ├─ Validate: { query: "general" }                                      │
│   ├─ Route to: searchChannelsByName()                                    │
│   ├─ Execute: Cache lookup (no API call)                                 │
│   └─ Return: { channels: [{ id: "C12345678", name: "general", ... }] }  │
│                                                                           │
│ Request 2: slack_post_message                                            │
│   ├─ Validate: { channel_id: "C12345678", text: "Meeting at 3pm" }      │
│   └─ Route to: postMessage()                                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SlackClient.postMessage()                                                │
│                                                                           │
│ Constructs HTTP Request:                                                 │
│   POST https://slack.com/api/chat.postMessage                            │
│   Headers: {                                                             │
│     Authorization: "Bearer xoxb-...",                                    │
│     Content-Type: "application/json"                                     │
│   }                                                                       │
│   Body: {                                                                │
│     channel: "C12345678",                                                │
│     text: "Meeting at 3pm"                                               │
│   }                                                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Slack Web API                                                            │
│                                                                           │
│ 1. Validates bot token                                                   │
│ 2. Checks bot has permission to post in #general                         │
│ 3. Creates message in channel                                            │
│ 4. Returns response:                                                     │
│    {                                                                     │
│      ok: true,                                                           │
│      channel: "C12345678",                                               │
│      ts: "1234567890.123456",                                            │
│      message: {                                                          │
│        type: "message",                                                  │
│        user: "U98765432",                                                │
│        text: "Meeting at 3pm",                                           │
│        ts: "1234567890.123456"                                           │
│      }                                                                   │
│    }                                                                     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Response Flows Back Through Layers                                       │
│                                                                           │
│ SlackClient → MCP Server → Transport → AI Client → AI Model             │
│                                                                           │
│ AI Model receives confirmation:                                          │
│ "Successfully posted message 'Meeting at 3pm' to #general"              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tool Comparison: Cached vs API Call

#### Cached Tool: `slack_search_channels`

```
AI Request
   │
   ▼
MCP Server (validate)
   │
   ▼
SlackClient.searchChannelsByName()
   │
   ├─ Normalize query
   ├─ Search in-memory cache
   └─ Return results
   │
   ▼
Response (< 1ms)
```

**No Slack API Call Made!**

#### API Call Tool: `slack_post_message`

```
AI Request
   │
   ▼
MCP Server (validate)
   │
   ▼
SlackClient.postMessage()
   │
   ├─ Construct HTTP request
   ├─ Send to Slack API
   ├─ Wait for response
   └─ Return result
   │
   ▼
Response (~100-500ms)
```

**Slack API Call Required**

---

## Error Handling

### Error Handling Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Transport Layer                                     │
│                                                               │
│ Catches:                                                      │
│ - Network errors                                              │
│ - Invalid JSON                                                │
│ - Connection failures                                         │
│                                                               │
│ Response:                                                     │
│ - 500 Internal Server Error (HTTP)                           │
│ - JSON-RPC error response (stdio)                            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: MCP Server                                          │
│                                                               │
│ Catches:                                                      │
│ - Unknown tool names                                          │
│ - Invalid JSON-RPC format                                     │
│ - Protocol violations                                         │
│                                                               │
│ Response:                                                     │
│ - JSON-RPC error with code -32601 (method not found)         │
│ - JSON-RPC error with code -32600 (invalid request)          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Schema Validation (Zod)                             │
│                                                               │
│ Catches:                                                      │
│ - Missing required parameters                                 │
│ - Wrong parameter types                                       │
│ - Invalid parameter values                                    │
│                                                               │
│ Response:                                                     │
│ - JSON-RPC error with validation details                     │
│ - Includes field name and expected type                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Tool Handler                                        │
│                                                               │
│ Catches:                                                      │
│ - Cache not initialized                                       │
│ - Runtime errors                                              │
│                                                               │
│ Response:                                                     │
│ - Throws Error, caught by MCP Server                         │
│ - Returns error in tool result                               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: SlackClient                                         │
│                                                               │
│ Catches:                                                      │
│ - Slack API errors (ok: false)                               │
│ - Network failures                                            │
│ - Rate limiting                                               │
│                                                               │
│ Response:                                                     │
│ - Returns Slack error response as-is                         │
│ - Error bubbles up through layers                            │
└─────────────────────────────────────────────────────────────┘
```

### Example Error Scenarios

#### Scenario 1: Invalid Tool Name

**Request**:
```json
{
  "method": "tools/call",
  "params": { "name": "slack_invalid_tool", "arguments": {} }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32601,
    "message": "Method not found: slack_invalid_tool"
  },
  "id": 1
}
```

#### Scenario 2: Missing Required Parameter

**Request**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "slack_post_message",
    "arguments": { "channel_id": "C12345678" }
    // Missing "text" parameter
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params: Required field 'text' is missing"
  },
  "id": 1
}
```

#### Scenario 3: Slack API Error

**Request**: Post to channel where bot isn't a member

**Slack API Response**:
```json
{
  "ok": false,
  "error": "not_in_channel"
}
```

**Tool Response** (passes through):
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"ok\":false,\"error\":\"not_in_channel\"}"
    }]
  },
  "id": 1
}
```

**Note**: Slack API errors are returned as successful tool calls, but with `ok: false` in the response. The AI client must check the `ok` field.

#### Scenario 4: Unauthorized HTTP Request

**Request**:
```
POST /mcp
Authorization: Bearer wrong_token
```

**Response**:
```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Unauthorized: Invalid token"
  },
  "id": null
}
```

#### Scenario 5: Cache Not Initialized

**Request**: Search channels before cache is ready

**Error Thrown**:
```typescript
throw new Error("Channel cache not initialized. Call initializeChannelCache() first.");
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Channel cache not initialized. Call initializeChannelCache() first."
  },
  "id": 1
}
```

---

## Available Tools Summary

| Tool Name | Cached? | API Endpoint | Primary Use Case |
|-----------|---------|--------------|------------------|
| `slack_search_channels` | ✅ Yes | - | Find channels by name |
| `slack_post_message` | ❌ No | `chat.postMessage` | Send new messages |
| `slack_reply_to_thread` | ❌ No | `chat.postMessage` | Reply to threads |
| `slack_add_reaction` | ❌ No | `reactions.add` | React to messages |
| `slack_get_channel_history` | ❌ No | `conversations.history` | Retrieve messages |
| `slack_get_thread_replies` | ❌ No | `conversations.replies` | Get thread messages |
| `slack_get_users` | ❌ No | `users.list` | List workspace users |
| `slack_get_user_profile` | ❌ No | `users.profile.get` | Get user details |

---

## Performance Characteristics

### Startup Performance

| Phase | Time | Notes |
|-------|------|-------|
| Argument parsing | < 1ms | Simple string parsing |
| Environment validation | < 1ms | Check env vars exist |
| SlackClient initialization | < 1ms | Create object, set headers |
| Channel cache initialization | 1-10s | Depends on channel count |
| - Per API call | ~200ms | 200 channels per request |
| - Total API calls | N/200 | N = total channels |
| Server startup | < 100ms | Create server, register tools |
| **Total Startup** | **1-15s** | Mostly cache initialization |

### Runtime Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| `slack_search_channels` | < 1ms | In-memory cache lookup |
| `slack_post_message` | 100-500ms | Slack API call |
| `slack_reply_to_thread` | 100-500ms | Slack API call |
| `slack_add_reaction` | 100-500ms | Slack API call |
| `slack_get_channel_history` | 100-500ms | Slack API call |
| `slack_get_thread_replies` | 100-500ms | Slack API call |
| `slack_get_users` | 100-500ms | Slack API call |
| `slack_get_user_profile` | 100-500ms | Slack API call |

### Memory Usage

| Component | Memory | Notes |
|-----------|--------|-------|
| Base process | ~50MB | Node.js runtime |
| MCP SDK | ~10MB | SDK overhead |
| Express (HTTP mode) | ~5MB | Web server |
| Channel cache | 100KB-5MB | Depends on channel count |
| - Per channel | ~1-2KB | Channel metadata |
| **Total** | **65-70MB** | Typical workspace |

---

## Security Considerations

### 1. Token Management

**Slack Bot Token**:
- Stored in environment variable `SLACK_BOT_TOKEN`
- Never logged or exposed in responses
- Used for all Slack API authentication

**HTTP Auth Token**:
- Optional Bearer token for HTTP transport
- Validates all HTTP requests (except /health)
- Can be provided via CLI, env var, or auto-generated

### 2. Scope-Based Security

The bot can only perform actions allowed by its OAuth scopes:
- `channels:history` - Read public channel messages
- `channels:read` - List public channels
- `chat:write` - Send messages
- `reactions:write` - Add reactions
- `users:read` - List users
- `users.profile:read` - View user profiles
- `groups:history` - Read private channel messages (optional)
- `groups:read` - List private channels (optional)

**No destructive actions are possible** (no delete, no admin actions).

### 3. Input Validation

All tool inputs are validated using Zod schemas:
- Type checking (string, number, etc.)
- Required vs optional fields
- Prevents injection attacks through parameter validation

### 4. Error Message Safety

- Slack API errors are passed through as-is
- Internal errors don't expose sensitive information
- Stack traces are not included in responses

### 5. Session Isolation (HTTP Mode)

- Each session has its own transport instance
- Sessions are identified by UUID
- Session IDs are unpredictable (randomUUID)
- Sessions are properly cleaned up on termination

---

## Configuration Summary

### Required Environment Variables

```bash
SLACK_BOT_TOKEN="xoxb-..."     # OAuth bot token from Slack app
SLACK_TEAM_ID="T..."           # Workspace/team ID
```

### Optional Environment Variables

```bash
SLACK_CHANNEL_IDS="C1,C2,C3"   # Predefined channel list (skips full fetch)
AUTH_TOKEN="secret123"          # HTTP auth token (HTTP mode only)
```

### Command Line Options

```bash
--transport <stdio|http>        # Transport type (default: stdio)
--port <number>                 # HTTP port (default: 3000)
--token <string>                # HTTP auth token (overrides AUTH_TOKEN)
--help, -h                      # Show help message
```

---

## Deployment Patterns

### Pattern 1: Local Development (stdio)

```bash
# Terminal 1: Start MCP server
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_TEAM_ID="T..."
npm run build
node dist/index.js

# Terminal 2: Connect AI client
# (AI client reads from server's stdout, writes to stdin)
```

### Pattern 2: Remote Server (HTTP)

```bash
# Server deployment
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_TEAM_ID="T..."
export AUTH_TOKEN="secure-random-token"
node dist/index.js --transport http --port 3000

# AI client connects via HTTP
# POST https://your-server.com:3000/mcp
# Authorization: Bearer secure-random-token
```

### Pattern 3: Docker Container (HTTP)

```bash
# Run container
docker run -d \
  -e SLACK_BOT_TOKEN="xoxb-..." \
  -e SLACK_TEAM_ID="T..." \
  -e AUTH_TOKEN="secure-token" \
  -p 3000:3000 \
  hynzk6uuwdrdd9na/slack-mcp:latest \
  --transport http

# Container exposes port 3000
# Health check: http://localhost:3000/health
# MCP endpoint: http://localhost:3000/mcp
```

### Pattern 4: Docker Compose (Multi-Service)

```yaml
version: '3.8'
services:
  slack-mcp:
    image: hynzk6uuwdrdd9na/slack-mcp:latest
    environment:
      - SLACK_BOT_TOKEN=xoxb-...
      - SLACK_TEAM_ID=T...
      - AUTH_TOKEN=secure-token
    ports:
      - "3000:3000"
    command: ["--transport", "http"]
    restart: unless-stopped
    
  # Other services can connect to slack-mcp:3000
  # using the service name as hostname
```

---

## Future Enhancements

Based on the codebase, potential improvements include:

1. **Cache Refresh Mechanism**
   - TODO comment in code mentions TTL-based refresh
   - Could implement periodic cache updates
   - Could add manual cache refresh tool

2. **Additional Tools**
   - File upload support
   - User search/lookup
   - Channel creation/management
   - Message editing/deletion
   - Advanced search queries

3. **Improved Error Handling**
   - Retry logic for transient Slack API errors
   - Rate limit handling with backoff
   - Better error messages for common issues

4. **Performance Optimizations**
   - Lazy cache loading (load on first search)
   - Parallel cache population
   - Incremental cache updates

5. **Observability**
   - Structured logging
   - Metrics/telemetry
   - Request tracing
   - Performance monitoring

6. **Advanced Features**
   - WebSocket transport for low-latency
   - Webhook support for incoming messages
   - Multi-workspace support
   - Custom Slack app integration

---

## Conclusion

The Slack MCP Server is a well-architected bridge between AI models and Slack, providing:

- **Clean abstraction**: MCP protocol hides Slack API complexity
- **Performance**: Intelligent caching reduces API calls
- **Flexibility**: Multiple transport options for different use cases
- **Security**: Scope-based permissions and token validation
- **Reliability**: Proper error handling and session management

The logical flow follows a clear pattern:
1. **Initialization**: Setup, authentication, cache population
2. **Request handling**: Validation, routing, execution
3. **Tool execution**: SlackClient → Slack API → Response
4. **Transport**: stdio or HTTP with session management

This architecture enables AI models to seamlessly interact with Slack workspaces while maintaining security, performance, and reliability.
