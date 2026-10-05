import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();

const { knowledgeReviewMessage } = await import('../src/tui/views/sessions-actions.js');
const { setLocale } = await import('../src/tui/i18n.js');

test('the knowledge review toast only claims an AGENTS.md injection that happened (#142)', () => {
  setLocale('en');
  assert.match(knowledgeReviewMessage(1, 2), /1 folder\(s\) and injected it into AGENTS.md in 2 directories/);
  assert.match(knowledgeReviewMessage(1, 0), /no project directory found for AGENTS.md/);
  assert.doesNotMatch(knowledgeReviewMessage(1, 0), /injected/);
  assert.equal(knowledgeReviewMessage(0, 0), 'No changes applied');
});

test('the Korean toast follows the same rule', () => {
  setLocale('ko');
  try {
    assert.match(knowledgeReviewMessage(1, 1), /디렉토리 1곳의 AGENTS.md에 주입했습니다/);
    assert.match(knowledgeReviewMessage(1, 0), /프로젝트 디렉토리를 찾지 못했습니다/);
  } finally {
    setLocale('en');
  }
});
