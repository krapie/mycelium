import { createApp } from './app.js';
import { sessionsView } from './views/sessions.js';
import { t } from './i18n.js';

export async function runTui() {
  if (!process.stdout.isTTY) {
    console.error(t('app.needsTty'));
    process.exit(1);
  }
  const app = createApp();
  await app.show(sessionsView());
  app.render();
}

if (import.meta.url === `file://${process.argv[1]}`) runTui();
