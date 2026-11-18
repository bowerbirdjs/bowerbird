import type { Channel, ClientMessage, ServerMessage } from './protocol.js';

/**
 * Two connected channels in one process (for tests, demos and same-page editors). Messages are
 * delivered asynchronously and copied, like a real network would.
 */
export function memoryChannelPair(): {
  client: Channel<ServerMessage, ClientMessage>;
  server: Channel<ClientMessage, ServerMessage>;
} {
  let toClient: ((m: ServerMessage) => void) | undefined;
  let toServer: ((m: ClientMessage) => void) | undefined;
  const closers: (() => void)[] = [];
  let open = true;
  // Like a socket: messages sent before closing still arrive; nothing is sent after.
  const deliver = <T>(handler: ((m: T) => void) | undefined, message: T) => {
    if (!open) return;
    const copy = structuredClone(message);
    queueMicrotask(() => handler?.(copy));
  };
  const close = () => {
    if (!open) return;
    open = false;
    for (const c of closers) c();
  };
  return {
    client: {
      send: (m) => deliver(toServer, m),
      receive: (h) => {
        toClient = h;
      },
      closed: (h) => closers.push(h),
      close,
    },
    server: {
      send: (m) => deliver(toClient, m),
      receive: (h) => {
        toServer = h;
      },
      closed: (h) => closers.push(h),
      close,
    },
  };
}

/** Minimal WebSocket shape (browser `WebSocket`, or `ws` on Node). */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
}

/** Wraps a WebSocket as a channel (JSON messages). Works for either end. */
export function socketChannel<In, Out>(socket: SocketLike): Channel<In, Out> {
  return {
    send: (m) => socket.send(JSON.stringify(m)),
    receive: (handler) =>
      socket.addEventListener('message', (event) => {
        try {
          handler(JSON.parse(String(event.data)) as In);
        } catch {
          // Ignore malformed frames.
        }
      }),
    closed: (handler) => socket.addEventListener('close', handler),
    close: () => socket.close(),
  };
}

export interface HttpChannelOptions {
  /** Wait before reconnecting after the connection fails (ms; doubles up to 30 s). Default 1000. */
  retryMs?: number;
}

/**
 * Browser side of the HTTP sync endpoint the MCP preview serves: server messages arrive over
 * server-sent events, client messages go up as POSTs, in order. `url` is the sync URL the MCP
 * server prints (`http://localhost:4321/__bowerbird/sync?key=…`).
 *
 * Reconnects by itself (after a dropped stream, a failed POST or a server restart); a
 * `SyncedStore` then says hello again and resends the changes the server hasn't confirmed.
 */
export function httpChannel(
  url: string,
  options: HttpChannelOptions = {},
): Channel<ServerMessage, ClientMessage> {
  const target = new URL(url, typeof location === 'undefined' ? undefined : location.href);
  if (!target.pathname.endsWith('/__bowerbird/sync'))
    target.pathname = `${target.pathname.replace(/\/+$/, '')}/__bowerbird/sync`;
  const streamUrl = target.toString();
  const postUrl = `${target.origin}${target.pathname}`;
  const firstDelay = options.retryMs ?? 1000;
  let delay = firstDelay;
  let source: EventSource | undefined;
  let connection: string | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let handler: ((m: ServerMessage) => void) | undefined;
  const openers: (() => void)[] = [];
  const closers: (() => void)[] = [];
  let sending = Promise.resolve();

  /** The current connection is gone (the server forgets it, so it can't come back). */
  const lost = () => {
    if (connection === undefined) return;
    connection = undefined;
    for (const c of closers) c();
  };
  const reconnect = () => {
    source?.close();
    source = undefined;
    lost();
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      open();
    }, delay);
    delay = Math.min(delay * 2, 30_000);
  };
  const open = () => {
    if (stopped) return;
    const es = new EventSource(streamUrl);
    source = es;
    es.addEventListener('connection', (event) => {
      if (source !== es) return;
      lost();
      connection = (event as MessageEvent<string>).data;
      delay = firstDelay;
      for (const o of openers) o();
    });
    es.onmessage = (event: MessageEvent<string>) => {
      if (source !== es) return;
      try {
        handler?.(JSON.parse(event.data) as ServerMessage);
      } catch {
        // Ignore malformed events.
      }
    };
    es.onerror = () => {
      if (source !== es) return;
      // While CONNECTING the browser retries by itself; either way this connection is over.
      if (es.readyState === EventSource.CLOSED) reconnect();
      else lost();
    };
  };
  const post = (message: ClientMessage) => {
    const id = connection;
    // Nothing to send to while disconnected; the store resends what matters after reconnecting.
    if (!id) return;
    // Chained, so the server receives messages in the order they were sent.
    sending = sending
      .then(() =>
        fetch(`${postUrl}/${id}`, {
          method: 'POST',
          // A simple request (no preflight); the server parses JSON regardless.
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify(message),
        }),
      )
      .then(
        (res) => {
          if (!res.ok && connection === id) reconnect();
        },
        () => {
          if (connection === id) reconnect();
        },
      );
  };
  open();
  return {
    send: post,
    receive: (h) => {
      handler = h;
    },
    opened: (h) => {
      openers.push(h);
      if (connection) h();
    },
    closed: (h) => closers.push(h),
    close: () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
      source = undefined;
      lost();
    },
  };
}
