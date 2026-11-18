import { createAgentTools } from '@bowerbirdjs/agent';
import { type Actor, checkReadLocale, type Store, slugify } from '@bowerbirdjs/core';
import { renderDocument } from '@bowerbirdjs/html';
import type { LayoutProvider } from '@bowerbirdjs/layout';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export interface McpServerOptions {
  store: Store;
  name?: string;
  version?: string;
  /** Live preview URL, mentioned in get_context so the agent can tell the user where to look. */
  previewUrl?: () => string | undefined;
  /** Enables get_layout (and screenshot) for agents, e.g. `createPlaywrightLayoutProvider`. */
  layout?: LayoutProvider;
}

/** MCP Apps view of a page (rendered inline by hosts that support MCP Apps). */
export const PAGE_VIEW_URI = 'ui://bowerbird/page';
const MCP_APP_MIME = 'text/html;profile=mcp-app';
const SHOW_PAGE = {
  name: 'show_page',
  description:
    'Shows a page to the user. In chat apps that support MCP Apps the rendered page appears inline; otherwise you get the preview link.',
};

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
    { capabilities: { tools: {}, resources: {} }, instructions: SERVER_INSTRUCTIONS },
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
    ...(options.layout ? { layout: options.layout } : {}),
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

  // MCP Apps: hosts that support interactive views render this page inline in the chat when an
  // agent calls show_page. Other hosts just get the text result. Each call's result names its own
  // resource (`ui://bowerbird/page?page=…`), so cached or prefetched views show the right page;
  // the bare URI shows the page shown last.
  type Shown = { page: string; theme?: string; locale?: string };
  let shown: Shown | undefined;
  const pageTool = {
    name: SHOW_PAGE.name,
    title: 'Show page',
    description: SHOW_PAGE.description,
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'string', description: 'Page id (default: the home page).' },
        theme: { type: 'string', description: 'Theme to preview, e.g. "dark".' },
        locale: { type: 'string', description: 'Language to show (default: the default one).' },
      },
    },
    annotations: { title: 'Show page', readOnlyHint: true },
    _meta: { ui: { resourceUri: PAGE_VIEW_URI }, 'ui/resourceUri': PAGE_VIEW_URI },
  };
  const homePage = () => {
    const pages = Object.values(store.doc.pages);
    return pages.find((p) => p.path === '/') ?? pages[0];
  };
  const pageById = (id: string) =>
    Object.hasOwn(store.doc.pages, id) ? store.doc.pages[id] : undefined;
  const viewUri = (s: Shown) =>
    `${PAGE_VIEW_URI}?${new URLSearchParams(Object.entries(s).filter(([, v]) => v !== undefined) as [string, string][])}`;
  const renderShown = (view: Shown | undefined) => {
    const page = (view && pageById(view.page)) ?? homePage();
    if (!page) return '<!doctype html><p>No pages yet.</p>';
    const locale =
      view?.locale && store.doc.locales?.others.includes(view.locale) ? view.locale : undefined;
    return renderDocument(store.doc, store.registry, page.id, {
      ...(view?.theme && /^[a-z0-9-]+$/.test(view.theme) ? { theme: view.theme } : {}),
      ...(locale ? { locale } : {}),
    });
  };
  /** `ui://bowerbird/page?page=home&locale=de` → what to show; the bare URI → the last shown. */
  const parseViewUri = (uri: string): Shown | undefined | null => {
    if (uri === PAGE_VIEW_URI) return shown;
    if (!uri.startsWith(`${PAGE_VIEW_URI}?`)) return null;
    const q = new URLSearchParams(uri.slice(PAGE_VIEW_URI.length + 1));
    const page = q.get('page');
    if (!page) return null;
    const theme = q.get('theme');
    const locale = q.get('locale');
    return { page, ...(theme ? { theme } : {}), ...(locale ? { locale } : {}) };
  };
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: PAGE_VIEW_URI,
        name: 'Page view',
        description: 'The page an agent last showed with show_page, rendered as published HTML.',
        mimeType: MCP_APP_MIME,
      },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const view = parseViewUri(request.params.uri);
    if (view === null) throw new Error(`Unknown resource ${request.params.uri}`);
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: MCP_APP_MIME,
          text: renderShown(view),
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...listed, pageTool] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === SHOW_PAGE.name) {
      const args = (request.params.arguments ?? {}) as {
        page?: unknown;
        theme?: unknown;
        locale?: unknown;
      };
      const pages = Object.values(store.doc.pages);
      const page = typeof args.page === 'string' ? pageById(args.page) : homePage();
      const fail = (text: string) => ({ isError: true, content: [{ type: 'text', text }] });
      if (!page) {
        return fail(
          `No page "${String(args.page)}". Pages: ${pages.map((p) => p.id).join(', ') || '(none)'}.`,
        );
      }
      let locale: string | undefined;
      if (typeof args.locale === 'string') {
        const checked = checkReadLocale(store.doc.locales, args.locale);
        if (checked.error) return fail(checked.error);
        locale = checked.locale;
      }
      shown = {
        page: page.id,
        ...(typeof args.theme === 'string' ? { theme: args.theme } : {}),
        ...(locale ? { locale } : {}),
      };
      const url = options.previewUrl?.();
      const resourceUri = viewUri(shown);
      return {
        content: [
          {
            type: 'text',
            text: `Showing page ${page.id} ("${page.title}", ${page.path}${locale ? `, ${locale}` : ''}).${url ? ` Live preview: ${url}${page.path}` : ''}`,
          },
        ],
        structuredContent: shown,
        _meta: { ui: { resourceUri } },
      };
    }
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
    const result = await found.run(request.params.arguments ?? {});
    return {
      content: [
        { type: 'text', text: result.text },
        ...(result.images ?? []).map((img) => ({
          type: 'image' as const,
          data: img.data,
          mimeType: img.mimeType,
        })),
      ],
      ...(result.isError ? { isError: true } : {}),
    };
  });
  return server;
}
