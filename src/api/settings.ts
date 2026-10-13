import { getContext } from '@/st/context';
import type { ThemeName } from '@/state/ui';
import { reactive, watch } from 'vue';
import { LEGACY_QUICK_PHRASES, LEGACY_REVIEW_PROMPT, LEGACY_SYSTEM_PROMPT } from '@/localization/legacyDefaults';

export interface QuickPhrase {
  id: number;
  name: string;
  instruction: string;
  favorite: boolean;
}

export interface PenPrompts {
  /** 破限提示词:置顶 system 附加在改写请求里;空串=用内置默认。 */
  jailbreak: string;
  /** 思维链提示词:在最终改写任务之后追加;空串=用内置默认。 */
  chainOfThought: string;
}

/** 查找替换规则:对楼层全文做确定性替换,不经过 AI。 */
export interface ReplaceRule {
  id: number;
  name: string;
  /** 匹配内容;isRegex 时按正则解析。 */
  pattern: string;
  /** 替换为;空串 = 删除匹配内容。 */
  replacement: string;
  isRegex: boolean;
  /** 勾选后对当前楼层生效。 */
  enabled: boolean;
}

export interface PenSettings {
  defaultChannelId: string;
  defaultContextRounds: number;
  theme: ThemeName;
  /** 楼层列表是否显示用户消息;默认 false,只列 AI 楼层。 */
  showUserFloors: boolean;
  quickPhraseDefaultsVersion: number;
  phrases: QuickPhrase[];
  prompts: PenPrompts;
  replaceRules: ReplaceRule[];
}

const SETTINGS_KEY = 'baibai_pen';
const QUICK_PHRASE_DEFAULTS_VERSION = 1;

export const DEFAULT_QUICK_PHRASES: readonly QuickPhrase[] = [
  {
    id: 1,
    name: 'Vary the food',
    instruction: 'Choose a different food; stop having the characters eat the same thing repeatedly.',
    favorite: false,
  },
  {
    id: 2,
    name: 'No food reassurance cliché',
    instruction: 'Avoid lines such as “Slow down, nobody is going to steal your food,” including close variations.',
    favorite: false,
  },
  {
    id: 3,
    name: 'Fewer meal scenes',
    instruction: 'The characters are not obsessed with eating. Stop bringing up meals so often.',
    favorite: false,
  },
  {
    id: 4,
    name: 'No swaggering self-reference',
    instruction: 'Use a natural first-person voice instead of swaggering self-titles such as “your old man” or “this badass”.',
    favorite: false,
  },
  {
    id: 5,
    name: 'No pebble-in-a-pond metaphor',
    instruction: 'Avoid describing an effect as a stone dropped into a lake or pond, including ripple metaphors and close variations.',
    favorite: false,
  },
  {
    id: 6,
    name: 'No “not X, but Y” framing',
    instruction: 'Avoid the “not X, but Y” sentence pattern and equivalent contrastive phrasing.',
    favorite: false,
  },
  {
    id: 7,
    name: 'Vary the clothing',
    instruction: 'Choose something other than clothes described as faded or washed pale, and do not dress the characters in military boots.',
    favorite: false,
  },
  {
    id: 8,
    name: 'No dominance clichés',
    instruction: 'Avoid “unquestionable” or “brooked no argument,” controlling or possessive language, beast imagery, low growls, and predator/prey or hunter/quarry comparisons.',
    favorite: false,
  },
  {
    id: 9,
    name: 'Vary the aftermath of intimacy',
    instruction: 'Do not have the characters fall asleep immediately after sex. Let them do something else that fits the scene.',
    favorite: false,
  },
  {
    id: 10,
    name: 'Keep emotional resilience',
    instruction: 'Do not make the characters collapse into despair at every setback; their emotional resilience is stronger than that.',
    favorite: false,
  },
];

function cloneDefaultQuickPhrases(): QuickPhrase[] {
  return DEFAULT_QUICK_PHRASES.map(phrase => ({ ...phrase }));
}

const LEGACY_PLACEHOLDER_REPLACE_RULES: readonly ReplaceRule[] = [
  {
    id: 1,
    name: '统一省略号',
    pattern: '\\.{3,}',
    replacement: '……',
    isRegex: true,
    enabled: true,
  },
  {
    id: 2,
    name: '清理行尾空白',
    pattern: '[ \\t]+$',
    replacement: '',
    isRegex: true,
    enabled: false,
  },
];

function isLegacyPlaceholderReplaceRule(rule: ReplaceRule): boolean {
  return LEGACY_PLACEHOLDER_REPLACE_RULES.some(
    placeholder =>
      rule.id === placeholder.id &&
      rule.name === placeholder.name &&
      rule.pattern === placeholder.pattern &&
      rule.replacement === placeholder.replacement &&
      rule.isRegex === placeholder.isRegex,
  );
}

function normalizeReplaceRules(raw: unknown): ReplaceRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const rule = item as Partial<ReplaceRule>;
      return {
        id: typeof rule.id === 'number' ? rule.id : Date.now() + Math.random(),
        name: typeof rule.name === 'string' ? rule.name : '',
        pattern: typeof rule.pattern === 'string' ? rule.pattern : '',
        replacement: typeof rule.replacement === 'string' ? rule.replacement : '',
        isRegex: rule.isRegex === true,
        enabled: rule.enabled !== false,
      };
    })
    .filter(item => item.name.trim() && item.pattern)
    .filter(item => !isLegacyPlaceholderReplaceRule(item));
}

function normalizeQuickPhrases(raw: unknown): QuickPhrase[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const phrase = item as Partial<QuickPhrase>;
      return {
        id: typeof phrase.id === 'number' ? phrase.id : Date.now() + Math.random(),
        name: typeof phrase.name === 'string' ? phrase.name : '',
        instruction: typeof phrase.instruction === 'string' ? phrase.instruction : '',
        favorite: phrase.favorite === true,
      };
    })
    .filter(item => item.name.trim() && item.instruction.trim());
}

function localizeQuickPhrases(phrases: QuickPhrase[]): QuickPhrase[] {
  return phrases.map(phrase => {
    const legacy = LEGACY_QUICK_PHRASES.find(item => item.id === phrase.id);
    const english = DEFAULT_QUICK_PHRASES.find(item => item.id === phrase.id);
    return legacy && english && phrase.name === legacy.name && phrase.instruction === legacy.instruction
      ? { ...english, favorite: phrase.favorite }
      : phrase;
  });
}

function normalizePrompt(value: unknown, legacy: string): string {
  if (typeof value !== 'string') return '';
  return value.trim() === legacy.trim() ? '' : value;
}

function defaults(): PenSettings {
  return {
    defaultChannelId: '',
    defaultContextRounds: 1,
    theme: 'day',
    showUserFloors: false,
    quickPhraseDefaultsVersion: QUICK_PHRASE_DEFAULTS_VERSION,
    phrases: cloneDefaultQuickPhrases(),
    prompts: { jailbreak: '', chainOfThought: '' },
    replaceRules: [],
  };
}

export function normalizePenSettings(raw: unknown): PenSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<PenSettings>) : {};
  const theme =
    value.theme === 'day' ||
      value.theme === 'night' ||
      value.theme === 'pastel' ||
      value.theme === 'green' ||
      value.theme === 'st'
      ? value.theme
      : 'day';
  return {
    defaultChannelId: typeof value.defaultChannelId === 'string' ? value.defaultChannelId : '',
    defaultContextRounds:
      typeof value.defaultContextRounds === 'number' && Number.isFinite(value.defaultContextRounds)
        ? Math.min(10, Math.max(0, Math.floor(value.defaultContextRounds)))
        : 1,
    theme,
    showUserFloors: value.showUserFloors === true,
    quickPhraseDefaultsVersion: QUICK_PHRASE_DEFAULTS_VERSION,
    phrases:
      value.quickPhraseDefaultsVersion === QUICK_PHRASE_DEFAULTS_VERSION ||
      (Array.isArray(value.phrases) && value.phrases.length > 0)
        ? localizeQuickPhrases(normalizeQuickPhrases(value.phrases))
        : cloneDefaultQuickPhrases(),
    prompts: {
      jailbreak: normalizePrompt(value.prompts?.jailbreak, LEGACY_SYSTEM_PROMPT),
      chainOfThought: normalizePrompt(value.prompts?.chainOfThought, LEGACY_REVIEW_PROMPT),
    },
    // 旧版本曾内置两条界面占位规则；加载时清理，之后规则库只保留用户规则。
    replaceRules: Array.isArray(value.replaceRules)
      ? normalizeReplaceRules(value.replaceRules)
      : [],
  };
}

export const penSettings = reactive<PenSettings>(defaults());

let ready = false;

function persist(): void {
  const context = getContext();
  if (!context?.extensionSettings) return;
  context.extensionSettings[SETTINGS_KEY] = JSON.parse(JSON.stringify(penSettings));
  context.saveSettingsDebounced?.();
}

export async function initializePenSettings(): Promise<void> {
  if (ready) return;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const context = getContext();
    if (context?.extensionSettings) {
      Object.assign(penSettings, normalizePenSettings(context.extensionSettings[SETTINGS_KEY]));
      context.extensionSettings[SETTINGS_KEY] = JSON.parse(JSON.stringify(penSettings));
      context.saveSettingsDebounced?.();
      ready = true;
      return;
    }
    await new Promise(resolve => window.setTimeout(resolve, 250));
  }
  ready = true;
}

watch(
  penSettings,
  () => {
    if (ready) persist();
  },
  { deep: true },
);
