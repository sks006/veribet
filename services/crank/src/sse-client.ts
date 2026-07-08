import { IncomingMessage } from 'http';
import * as http from 'http';
import * as https from 'https';

export class SseClient {
  private url: string;
  private headers: Record<string, string>;
  private onMessageCallback: (data: string) => void = () => {};

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url;
    this.headers = headers;
  }

  public onMessage(callback: (data: string) => void) {
    this.onMessageCallback = callback;
  }

  public start() {
    console.log(`[SSE Client] Connecting to TxLINE stream at ${this.url}`);
    const client = this.url.startsWith('https') ? https : http;
    
    const urlObj = new URL(this.url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...this.headers
      }
    };

    const request = client.request(options, (response: IncomingMessage) => {
      let buffer = '';
      response.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataContent = line.slice(5).trim();
            if (dataContent) {
              this.onMessageCallback(dataContent);
            }
          }
        }
      });

      response.on('end', () => {
        console.log('[SSE Client] TxLINE stream connection closed. Reconnecting in 5s...');
        setTimeout(() => this.start(), 5000);
      });
    });

    request.on('error', (err: Error) => {
      console.error(`[SSE Client] Error: ${err.message}. Reconnecting in 5s...`);
      setTimeout(() => this.start(), 5000);
    });

    request.end();
  }
}
