import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('uses standalone channels when BaiBai-Book is installed but disabled', async () => {
  const channel = { id: 'nano', name: 'NanoGPT', url: 'https://example.com/v1', key: '', model: 'test',
    temperature: 1, maxTokens: 2000, timeoutSec: 60, stream: false, prefill: false, excludeParams: [], reasoningEffort: '' };
  const settings = { disabledExtensions: ['third-party/ST-BaiBai-Book'],
    baibai_api_channels: { schemaVersion: 1, revision: 0, channels: [channel] } };
  vi.stubGlobal('SillyTavern', { getContext: () => ({ extensionSettings: settings }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ name: 'third-party/ST-BaiBai-Book', type: 'global' }] })));
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  const shared = await import('./sharedChannels');
  await shared.initializeSharedChannels();
  expect(shared.sharingState.mode).toBe('standalone');
  expect(shared.canEditChannels()).toBe(true);
  expect(shared.channels).toEqual([channel]);
  expect(shared.bookUpdatePromptOpen.value).toBe(false);
});
