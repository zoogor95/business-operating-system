import { connect } from 'node:net';
import { Injectable } from '@nestjs/common';
import { requireEnv } from '../env';

// Only checks the SMTP server is reachable; sending mail arrives with BOS-016.
@Injectable()
export class MailService {
  private readonly host = requireEnv('SMTP_HOST');
  private readonly port = Number(requireEnv('SMTP_PORT'));

  /** Resolves once the SMTP server sends its `220` greeting. */
  ping(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      socket.setTimeout(timeoutMs, () => {
        socket.destroy(new Error('SMTP greeting timed out'));
      });
      socket.once('error', reject);
      socket.once('data', (data) => {
        const greeting = data.toString().trim();
        socket.end('QUIT\r\n');
        if (greeting.startsWith('220')) {
          resolve();
        } else {
          reject(new Error(`Unexpected SMTP greeting: ${greeting}`));
        }
      });
    });
  }
}
