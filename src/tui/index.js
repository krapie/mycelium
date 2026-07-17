import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';

export async function runTui() {
  if (!process.stdout.isTTY) {
    console.error('Mycelium TUI는 실제 터미널(TTY)에서 실행하세요.');
    process.exit(1);
  }
  const app = createApp();
  await app.show(sessionsView());
  app.render();
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
