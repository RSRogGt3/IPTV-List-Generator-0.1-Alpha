import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSuggestedPlaylist, resolveGeminiModel } from './aiRouting';

test('resolveGeminiModel routes explicit modes to mandated Gemini 4 / 3.1 models', () => {
  assert.equal(resolveGeminiModel('fast', 'Hallo').model, 'gemini-3.1-flash-lite');
  assert.equal(resolveGeminiModel('search', 'Bundesliga').model, 'gemini-4-hydrogen');
  assert.equal(resolveGeminiModel('search', 'Bundesliga').useSearch, true);
  assert.equal(resolveGeminiModel('interactive', 'Playlist').model, 'gemini-4-argon');
  assert.equal(resolveGeminiModel('reasoning', 'VLAN').model, 'gemini-4-carbon');
});

test('resolveGeminiModel auto-routes based on German prompt intent', () => {
  const searchRoute = resolveGeminiModel('auto', 'Was läuft heute auf Sky Bundesliga?');
  assert.equal(searchRoute.model, 'gemini-4-hydrogen');
  assert.equal(searchRoute.useSearch, true);

  const reasoningRoute = resolveGeminiModel(
    'auto',
    'Analysiere die Subnetz-Architektur und meine IP-Konflikte im Detail.'
  );
  assert.equal(reasoningRoute.model, 'gemini-4-carbon');

  const interactiveRoute = resolveGeminiModel(
    'auto',
    'Erstelle mir bitte eine neue Sport und Film Playlist für das Wochenende.'
  );
  assert.equal(interactiveRoute.model, 'gemini-4-argon');

  const fastRoute = resolveGeminiModel('auto', 'Welcher Port ist Standard für RTSP?');
  assert.equal(fastRoute.model, 'gemini-3.1-flash-lite');
});

test('extractSuggestedPlaylist parses fenced playlist_json and filters unknown channel IDs', () => {
  const raw = `Hier ist dein Vorschlag:

\`\`\`playlist_json
{
  "name": "Wochenend Sport Mix",
  "description": "Sky und Prime Sport",
  "channelIds": ["sky-bundesliga-1", "unknown-id", "amazon-prime-sport"]
}
\`\`\``;

  const valid = new Set(['sky-bundesliga-1', 'amazon-prime-sport']);
  const result = extractSuggestedPlaylist(raw, valid);

  assert.equal(result.cleanText, 'Hier ist dein Vorschlag:');
  assert.ok(result.suggestedPlaylist);
  assert.equal(result.suggestedPlaylist.name, 'Wochenend Sport Mix');
  assert.deepEqual(result.suggestedPlaylist.channelIds, [
    'sky-bundesliga-1',
    'amazon-prime-sport',
  ]);
});
