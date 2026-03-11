/**
 * Server-Sent Events (SSE) broadcaster for real-time ledger updates.
 */

import type { Request, Response } from "express";

export type SSEEvent = {
  type: string;
  data: unknown;
};

export class SSEBroadcaster {
  private clients: Set<Response> = new Set();

  /** SSE endpoint handler. */
  handler = (req: Request, res: Response): void => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial connected event
    res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);

    this.clients.add(res);

    req.on("close", () => {
      this.clients.delete(res);
    });

    req.on("error", () => {
      this.clients.delete(res);
    });
  };

  /** Broadcast an event to all connected SSE clients. */
  broadcast(event: SSEEvent): void {
    const message = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const client of this.clients) {
      client.write(message);
    }
  }

  /** Get the number of connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }
}
