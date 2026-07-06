import { IncomingMessage } from 'http';
import * as http from 'http';
import * as https from 'https';

export class SseClient {
  private url: string;
  private onMessageCallback: (data: string) => void = () => {};

  constructor(url: string) {
    this.url = url;
  }

  public onMessage(callback: (data: string) => void) {
    this.onMessageCallback = callback;
  }

  public start() {
    console.log(`[SSE Client] Connecting to TxLINE stream at ${this.url}`);
    const client = this.url.startsWith('https') ? https : http;
    
    const request = client.get(this.url, (response: IncomingMessage) => {
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
  }
}
