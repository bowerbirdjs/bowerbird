import { createAgentTools } from '@bowerbirdjs/agent';
import { type Actor, type Store, slugify } from '@bowerbirdjs/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export interface McpServerOptions {
  store: Store;
  name?: string;
  version?: string;
  /** Live preview URL, mentioned in get_context so the agent can tell the user where to look. */
  previewUrl?: () => string | undefined;
}

export const SERVER_INSTRUCTIONS =
  'Bowerbird is a visual page editor. Call get_context first, read pages with get_outline, and change them with apply. ' +
  'Changes are validated, attributed to you, and can be undone; people may be editing the same page at the same time.';

/**
 * An MCP server exposing the agent tools for a store. Uses the low-level server so tool input is
 * validated by Bowerbird itself (better error messages for agents) while clients still receive the
 * full JSON Schema of every operation.
 */
export function createMcpServer(options: McpServerOptions): Server {
  const { store } = options;
  const server = new Server(
    { name: options.name ?? 'bowerbird', version: options.version ?? '0.0.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  const actor = (): Actor => {
    const client = server.getClientVersion();
    return {
      kind: 'agent',
      // Prefixed, so a client can't pick a name that matches a person's actor id.
      id: `mcp-${slugify(client?.name ?? 'agent', 'agent')}`,
      ...(client?.name ? { name: client.name } : {}),
    };
  };
  const tools = createAgentTools({
    store,
    actor,
    contextNotes: () => {
      const url = options.previewUrl?.();
      return url ? [`Live preview (tell the user): ${url}`] : [];
    },
  });
  const listed = tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: 'input' }) as {
      type: 'object';
      [key: string]: unknown;
    },
    annotations: { title: t.title, ...t.annotations },
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const found = tools.find((t) => t.name === request.params.name);
    if (!found) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Unknown tool "${request.params.name}". Tools: ${tools.map((t) => t.name).join(', ')}.`,
          },
        ],
      };
    }
    const result = found.run(request.params.arguments ?? {});
    return {
      content: [{ type: 'text', text: result.text }],
      ...(result.isError ? { isError: true } : {}),
    };
  });
  return server;
}
