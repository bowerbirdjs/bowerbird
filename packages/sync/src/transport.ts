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

/**
 * Browser side of the HTTP sync endpoint the MCP preview serves (`/__bowerbird/sync`): server
 * messages arrive over server-sent events, client messages go up as POSTs, in order.
 */
export function httpChannel(base: string): Channel<ServerMessage, ClientMessage> {
  const root = base.replace(/\/+$/, '');
  const source = new EventSource(`${root}/__bowerbird/sync`);
  let connection: string | undefined;
  let handler: ((m: ServerMessage) => void) | undefined;
  const closers: (() => void)[] = [];
  const queue: ClientMessage[] = [];
  let sending = Promise.resolve();
  const post = (message: ClientMessage) => {
    // Chained, so the server receives messages in the order they were sent.
    sending = sending
      .then(() =>
        fetch(`${root}/__bowerbird/sync/${connection}`, {
          method: 'POST',
          // A simple request (no preflight); the server parses JSON regardless.
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify(message),
        }),
      )
      .then(() => undefined)
      .catch(() => undefined);
  };
  source.addEventListener('connection', (event) => {
    connection = (event as MessageEvent<string>).data;
    for (const m of queue.splice(0)) post(m);
  });
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      handler?.(JSON.parse(event.data) as ServerMessage);
    } catch {
      // Ignore malformed events.
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) for (const c of closers) c();
  };
  return {
    send: (m) => (connection ? post(m) : queue.push(m)),
    receive: (h) => {
      handler = h;
    },
    closed: (h) => closers.push(h),
    close: () => {
      source.close();
      for (const c of closers) c();
    },
  };
}
