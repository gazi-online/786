// Global SSE subscriber registry for serverless / Next.js route handlers
type Subscriber = (data: { event: string; payload: unknown; id: string }) => void;

// In-memory set of connected SSE subscribers
const subscribers = new Set<Subscriber>();

/**
 * Register an active SSE subscriber callback.
 */
export function addSseSubscriber(subscriber: Subscriber) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/**
 * Broadcast an event to all connected dashboard SSE clients.
 */
export function broadcastSseEvent(event: string, payload: unknown) {
  const id = Date.now().toString();
  for (const subscriber of subscribers) {
    try {
      subscriber({ event, payload, id });
    } catch {
      subscribers.delete(subscriber);
    }
  }
}

