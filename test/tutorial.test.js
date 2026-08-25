import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();

const { injectDemoSessions, endTutorial, tutorialProjectDir } = await import('../src/tui/tutorial.js');

test('injectDemoSessions()/endTutorial() create and remove tutorialProjectDir() when nothing was there before', () => {
  const dir = tutorialProjectDir();
  assert.equal(existsSync(dir), false, 'sanity: nothing there yet');

  injectDemoSessions('swe');
  assert.equal(existsSync(dir), true, 'injectDemoSessions() created it');

  endTutorial();
  assert.equal(existsSync(dir), false, 'endTutorial() removed the directory it created');
});

// CodeRabbit review on #97: tutorialProjectDir() is a fixed, predictable
// path — if it happened to already exist as some unrelated real directory,
// endTutorial()'s cleanup used to destroy it unconditionally. Regression
// test for the ownership-marker fix (injectDemoSessions()/endTutorial()).
test('endTutorial() never removes a pre-existing directory at tutorialProjectDir(), even after a tutorial run reuses it', () => {
  const dir = tutorialProjectDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'real-user-file.txt'), 'not mycelium\'s to delete');

  injectDemoSessions('swe'); // finds the directory already there — must not claim ownership of it
  endTutorial();

  assert.equal(existsSync(dir), true, 'the pre-existing directory must survive');
  assert.equal(
    readFileSync(join(dir, 'real-user-file.txt'), 'utf8'),
    "not mycelium's to delete",
    'its real content must survive untouched',
  );
});
