import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';

// Mock fetch globally
(global as any).fetch = jest.fn();

// Mock the MCP SDK modules
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    registerTool: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn().mockImplementation(() => ({
    sessionId: 'test-session-id',
    onclose: null,
    handleRequest: jest.fn(),
  })),
}));

jest.mock('express', () => {
  const mockApp = {
    use: jest.fn(),
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    listen: jest.fn(),
  };
  const mockExpress = jest.fn(() => mockApp);
  (mockExpress as any).json = jest.fn();
  return mockExpress;
});

// Mock process.env
const originalEnv = process.env;
const originalArgv = process.argv;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_TEAM_ID: 'T123456',
  };
  process.argv = originalArgv;
});

afterEach(() => {
  process.env = originalEnv;
  process.argv = originalArgv;
  jest.clearAllMocks();
});

describe('SlackClient', () => {
  let SlackClient: any;
  let slackClient: any;
  const mockFetch = (global as any).fetch;

  beforeEach(async () => {
    const indexModule = await import('../index.js');
    SlackClient = indexModule.SlackClient;
    slackClient = new SlackClient('xoxb-test-token');
  });

  test('SlackClient constructor creates headers', () => {
    expect(slackClient).toHaveProperty('botHeaders');
    expect((slackClient as any).botHeaders).toEqual({
      Authorization: 'Bearer xoxb-test-token',
      'Content-Type': 'application/json',
    });
  });

  test('getChannels with predefined IDs', async () => {
    process.env.SLACK_CHANNEL_IDS = 'C123456,C789012';
    mockFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          channel: { id: 'C123456', name: 'general', is_archived: false },
        }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          channel: { id: 'C789012', name: 'random', is_archived: false },
        }),
      });

    const result = await slackClient.getChannels();

    expect(result).toEqual({
      ok: true,
      channels: [
        { id: 'C123456', name: 'general', is_archived: false },
        { id: 'C789012', name: 'random', is_archived: false },
      ],
      response_metadata: { next_cursor: '' },
    });
  });

  test('getChannels with API call', async () => {
    delete process.env.SLACK_CHANNEL_IDS;
    const mockResponse = {
      ok: true,
      channels: [
        { id: 'C123456', name: 'general', is_archived: false },
        { id: 'C789012', name: 'random', is_archived: false },
      ],
      response_metadata: { next_cursor: '' },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannels();

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/conversations.list'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('initializeChannelCache includes DMs and indexes by name, user id, and channel id', async () => {
    delete process.env.SLACK_CHANNEL_IDS;

    // 1st fetch: conversations.list — a public channel plus a 1:1 DM (no name).
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        channels: [
          { id: 'C123456', name: 'general', is_archived: false },
          { id: 'D999999', is_im: true, user: 'U999' },
        ],
        response_metadata: { next_cursor: '' },
      }),
    });

    // 2nd fetch: users.list — used to resolve the DM participant's name.
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        members: [
          { id: 'U999', name: 'alice', profile: { display_name: 'Alice', real_name: 'Alice Smith' } },
        ],
        response_metadata: { next_cursor: '' },
      }),
    });

    // Must not throw even though the DM channel has no `name` field.
    await slackClient.initializeChannelCache();

    // The DM is searchable by the other participant's display name...
    const byName = slackClient.searchChannelsByName('alice');
    expect(byName).toHaveLength(1);
    expect(byName[0].id).toBe('D999999');

    // ...by the participant's user id...
    const byUserId = slackClient.searchChannelsByName('U999');
    expect(byUserId).toHaveLength(1);
    expect(byUserId[0].id).toBe('D999999');

    // ...and by its own DM (channel) id — each without duplicate hits.
    const byDmId = slackClient.searchChannelsByName('D999999');
    expect(byDmId).toHaveLength(1);
    expect(byDmId[0].id).toBe('D999999');

    // Regular channels resolve by name and by channel id.
    const byChannelName = slackClient.searchChannelsByName('general');
    expect(byChannelName).toHaveLength(1);
    expect(byChannelName[0].id).toBe('C123456');
    const byChannelId = slackClient.searchChannelsByName('C123456');
    expect(byChannelId).toHaveLength(1);
    expect(byChannelId[0].id).toBe('C123456');
  });

  test('postMessage successful response', async () => {
    const mockResponse = {
      ok: true,
      channel: 'C123456',
      ts: '1234567890.123456',
      message: {
        text: 'Hello, world!',
        user: 'U123456',
        ts: '1234567890.123456',
      },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.postMessage('C123456', 'Hello, world!');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'C123456',
          text: 'Hello, world!',
        }),
      }
    );
  });

  test('postReply successful response', async () => {
    const mockResponse = {
      ok: true,
      channel: 'C123456',
      ts: '1234567890.123457',
      message: {
        text: 'Reply text',
        user: 'U123456',
        ts: '1234567890.123457',
        thread_ts: '1234567890.123456',
      },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.postReply('C123456', '1234567890.123456', 'Reply text');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'C123456',
          thread_ts: '1234567890.123456',
          text: 'Reply text',
        }),
      }
    );
  });

  test('addReaction successful response', async () => {
    const mockResponse = {
      ok: true,
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.addReaction('C123456', '1234567890.123456', 'thumbsup');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/reactions.add',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'C123456',
          timestamp: '1234567890.123456',
          name: 'thumbsup',
        }),
      }
    );
  });

  // Recent timestamps so the client-side `oldest` filter keeps the mock messages.
  const nowSec = Math.floor(Date.now() / 1000);
  const recentTs = (nowSec - 60).toString() + '.000000';

  test('getChannelHistory default (24h): does not send oldest, returns { ok, messages, truncated }', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        messages: [{ type: 'message', user: 'U123456', text: 'Hello', ts: recentTs }],
        response_metadata: { next_cursor: '' },
      }),
    });

    const result = await slackClient.getChannelHistory('C123456');

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].ts).toBe(recentTs);

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/conversations.history');
    expect(url.searchParams.get('channel')).toBe('C123456');
    expect(url.searchParams.get('limit')).toBe('200');
    expect(url.searchParams.get('inclusive')).toBe('true');
    // The fix: we never anchor at `oldest` (that's what dropped newest messages).
    expect(url.searchParams.get('oldest')).toBeNull();
    expect(url.searchParams.get('latest')).toBeNull();
  });

  test('getChannelHistory sends latest (not oldest) and filters older messages out', async () => {
    const oldMsg = { type: 'message', user: 'U1', text: 'old', ts: (nowSec - 40 * 86400).toString() + '.000000' };
    const newMsg = { type: 'message', user: 'U2', text: 'new', ts: recentTs };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        messages: [newMsg, oldMsg], // Slack returns newest-first
        response_metadata: { next_cursor: '' },
      }),
    });

    const oldest = nowSec - 7 * 86400; // 7 days ago
    const latest = nowSec;
    const result = await slackClient.getChannelHistory('C123456', oldest, latest);

    // Only the in-range message survives the client-side lower-bound filter.
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe('new');

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('latest')).toBe(latest.toFixed(6));
    expect(url.searchParams.get('oldest')).toBeNull();
    expect(url.searchParams.get('inclusive')).toBe('true');
  });

  test('getChannelHistory converts ISO/Slack latest formats', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, messages: [], response_metadata: { next_cursor: '' } }),
    });
    await slackClient.getChannelHistory('C123456', nowSec - 3600, '2021-01-02T00:00:00Z');
    let url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('latest')).toBe('1609545600.000000');

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, messages: [], response_metadata: { next_cursor: '' } }),
    });
    await slackClient.getChannelHistory('C123456', nowSec - 3600, '1609545600.654321');
    url = new URL(mockFetch.mock.calls[1][0]);
    expect(url.searchParams.get('latest')).toBe('1609545600.654321');
  });

  test('getChannelHistory pages newest-first and keeps the most recent messages', async () => {
    const oldest = nowSec - 7 * 86400;
    const m1 = { type: 'message', user: 'U1', text: 'newest', ts: (nowSec - 10).toString() + '.000000' };
    const m2 = { type: 'message', user: 'U2', text: 'newer', ts: (nowSec - 20).toString() + '.000000' };
    const belowOldest = { type: 'message', user: 'U3', text: 'too old', ts: (nowSec - 8 * 86400).toString() + '.000000' };

    // Page 1: recent messages + a cursor to more.
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        messages: [m1, m2],
        response_metadata: { next_cursor: 'CURSOR1' },
      }),
    });
    // Page 2: crosses the oldest bound -> loop stops.
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        messages: [belowOldest],
        response_metadata: { next_cursor: 'CURSOR2' },
      }),
    });

    const result = await slackClient.getChannelHistory('C123456', oldest);

    expect(result.truncated).toBe(false);
    expect(result.messages.map((m: any) => m.text)).toEqual(['newest', 'newer']);
    // Two pages fetched; the second uses the cursor and drops `latest`.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const page2 = new URL(mockFetch.mock.calls[1][0]);
    expect(page2.searchParams.get('cursor')).toBe('CURSOR1');
  });

  test('getChannelHistory reports truncated=true when the page cap is hit', async () => {
    // Every page is full of in-range messages and always offers another cursor.
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({
        ok: true,
        messages: [{ type: 'message', user: 'U1', text: 'x', ts: recentTs }],
        response_metadata: { next_cursor: 'MORE' },
      }),
    });

    const result = await slackClient.getChannelHistory('C123456', nowSec - 30 * 86400);

    expect(result.truncated).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(10); // MAX_PAGES safety cap
  });

  test('getChannelHistory propagates a Slack API error unchanged', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }),
    });

    const result = await slackClient.getChannelHistory('C123456');
    expect(result).toEqual({ ok: false, error: 'channel_not_found' });
  });

  test('getThreadReplies successful response', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Parent message',
          ts: '1234567890.123456',
        },
        {
          type: 'message',
          user: 'U789012',
          text: 'Reply message',
          ts: '1234567890.123457',
          thread_ts: '1234567890.123456',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getThreadReplies('C123456', '1234567890.123456');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/conversations.replies'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getUsers successful response', async () => {
    const mockResponse = {
      ok: true,
      members: [
        {
          id: 'U123456',
          name: 'testuser',
          real_name: 'Test User',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getUsers(100);

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/users.list'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getUserProfile successful response', async () => {
    const mockResponse = {
      ok: true,
      profile: {
        real_name: 'Test User',
        email: 'test@example.com',
        phone: '+1234567890',
      },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getUserProfile('U123456');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/users.profile.get'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });
});

describe('toSlackTimestamp helper', () => {
  test('converts ISO date string to Slack timestamp', async () => {
    // We need to test this indirectly through getChannelHistory since it's not exported
    // The tests above already cover this functionality
  });

  test('converts Unix timestamp number to Slack timestamp', async () => {
    // Tested indirectly through getChannelHistory tests above
  });

  test('preserves Slack timestamp format', async () => {
    // Tested indirectly through getChannelHistory tests above
  });
});

describe('createSlackServer', () => {
  test('createSlackServer returns server instance', async () => {
    const { createSlackServer, SlackClient } = await import('../index.js');

    const mockSlackClient = new SlackClient('xoxb-test-token');
    const server = createSlackServer(mockSlackClient);

    // Just test that the server is created and defined
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });
});

describe('parseArgs', () => {
  test('parseArgs with default values', async () => {
    process.argv = ['node', 'index.js'];
    const { parseArgs } = await import('../index.js');

    const result = parseArgs();

    expect(result).toEqual({
      transport: 'stdio',
      port: 3000,
      authToken: undefined,
    });
  });

  test('parseArgs with custom transport', async () => {
    process.argv = ['node', 'index.js', '--transport', 'http'];
    const { parseArgs } = await import('../index.js');

    const result = parseArgs();

    expect(result).toEqual({
      transport: 'http',
      port: 3000,
      authToken: undefined,
    });
  });

  test('parseArgs with custom port', async () => {
    process.argv = ['node', 'index.js', '--port', '8080'];
    const { parseArgs } = await import('../index.js');

    const result = parseArgs();

    expect(result).toEqual({
      transport: 'stdio',
      port: 8080,
      authToken: undefined,
    });
  });

  test('parseArgs with invalid transport', async () => {
    process.argv = ['node', 'index.js', '--transport', 'invalid'];
    const { parseArgs } = await import('../index.js');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs()).toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith('Error: --transport must be either "stdio" or "http"');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  test('parseArgs with invalid port', async () => {
    process.argv = ['node', 'index.js', '--port', 'invalid'];
    const { parseArgs } = await import('../index.js');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs()).toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith('Error: --port must be a valid port number (1-65535)');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});

describe('main', () => {
  test('main with missing env vars', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_TEAM_ID;

    const { main } = await import('../index.js');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(main()).rejects.toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Please set SLACK_BOT_TOKEN and SLACK_TEAM_ID environment variables'
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});

describe('HTTP Server', () => {
  test('express module can be imported', async () => {
    const express = await import('express');
    
    // Test that express module is available and mocked
    expect(express.default).toBeDefined();
    expect(typeof express.default).toBe('function');
  });

  test('SlackClient can be instantiated', async () => {
    const { SlackClient } = await import('../index.js');
    
    const mockSlackClient = new SlackClient('xoxb-test-token');
    
    // Test that SlackClient is created successfully
    expect(mockSlackClient).toBeDefined();
    expect(mockSlackClient).toHaveProperty('botHeaders');
  });

  test('index module exports expected functions', async () => {
    const indexModule = await import('../index.js');
    
    // Test that required exports are available
    expect(indexModule.SlackClient).toBeDefined();
    expect(indexModule.createSlackServer).toBeDefined();
    expect(indexModule.parseArgs).toBeDefined();
    expect(indexModule.main).toBeDefined();
  });
});