import { NextRequest, NextResponse } from 'next/server';
import { addSseSubscriber } from '@/lib/sse';
import { getTenantSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // 1. Initial connection comment
      controller.enqueue(encoder.encode(': connected\n\n'));

      // 2. Heartbeat comment every 20s (ADR-004) to prevent proxy/serverless timeouts
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, 20000);

      // 3. Register active subscriber (filtered by tenant)
      unsubscribe = addSseSubscriber(({ event, payload, id }) => {
        try {
          const message = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          if (unsubscribe) unsubscribe();
        }
      });
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
