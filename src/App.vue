<script setup lang="ts">
import { fetchModels, testChannel as testApiChannel } from '@/api/client';
import { CHAIN_OF_THOUGHT_PROMPT, JAILBREAK_PROMPT } from '@/api/prompts';
import {
  rewriteCurrentFloor,
  type RewriteChange,
  type RewriteResult,
} from '@/api/rewrite';
import { penSettings, type PenSettings, type QuickPhrase, type ReplaceRule } from '@/api/settings';
import {
  bookUpdatePromptOpen,
  canEditChannels,
  channels,
  newChannel,
  performBookUpdate,
  removeSharedChannel,
  requestBookUpdate,
  saveSharedChannel,
  sharingState,
  type ApiChannel,
} from '@/api/sharedChannels';
import { checkForUpdate, performUpdate, updateState } from '@/api/update';
import Collapsible from '@/components/Collapsible.vue';
import BbySelect from '@/components/BbySelect.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import PhrasePicker from '@/components/PhrasePicker.vue';
import { replaceText, replaceTextWithRules, type ReplacementResult } from '@/replacement';
import {
  classifyGenerationChat,
  isGenerationTargetOpen,
  type GenerationTarget,
} from '@/state/generationTask';
import { buildReviewRows, type ReviewRow } from '@/state/review';
import { buildFloorPreview } from '@/st/floorPreview';
import { deleteFloorsFrom, toggleFloorHidden } from '@/st/floorActions';
import { captureFloorShot, downloadBlob } from '@/st/floorShot';
import { applyFloorText, getFloorSourceText, openFloorInPen } from '@/st/openFloor';
import {
  closePen,
  cycleTheme,
  applyParagraphReplacements,
  lastOpenedAt,
  modalHost,
  THEMES,
  ui,
  type AppPage,
} from '@/state/ui';
import { getContext, getOpenChatId, getOpenChatIdentity } from '@/st/context';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

interface WorkspaceDraftSnapshot {
  selectedChannelId: string;
  contextRounds: number;
  carryWorldbook: boolean;
  carryCharDesc: boolean;
  carryUserDesc: boolean;
  generalNote: string;
  globalPhraseIds: number[];
  markedPhrases: Record<number, number[]>;
  paragraphNotes: Record<number, string>;
}

type GenerationOutcome =
  | { kind: 'success'; result: RewriteResult }
  | { kind: 'error'; message: string };

interface GenerationTask extends GenerationTarget {
  id: number;
  chatId: string;
  originalText: string;
  draft: WorkspaceDraftSnapshot;
  controller: AbortController;
  outcome: GenerationOutcome | null;
}

const expandedId = ref<number | null>(null);
const selectedChannelId = ref('');
const contextRounds = ref(1);
const carryWorldbook = ref(true);
const carryCharDesc = ref(true);
const carryUserDesc = ref(true);
const generalNote = ref('');
const globalPhraseIds = ref<number[]>([]);
const showKey = ref(false);
const channelDraft = ref<ApiChannel | null>(null);

/**
 * 思考强度候选：各家取值的并集，**不是**某一家的官方列表。
 * auto 是显式选项（值为空串 = 不发送该参数），不是「留空」。
 * 取值不做校验，原样发给端点（见 ApiChannel.reasoningEffort）。
 */
const REASONING_EFFORT_OPTIONS = [
  { value: '', label: 'auto' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];
const phraseDraft = ref<QuickPhrase | null>(null);
const testMessage = ref('');
const modelOptions = ref<string[]>([]);
const loadingModels = ref(false);
const modelMenuOpen = ref(false);
const modelQuery = ref('');
const toastText = ref('');
const markedPhrases = ref<Record<number, number[]>>({});
const paragraphNotes = ref<Record<number, string>>({});
const rewriteChanges = ref<RewriteChange[]>([]);
const reviewDecision = ref<Record<number, 'accept' | 'reject'>>({});
/* 审阅页内联手改:键是段落号,值是用户改过的结果文本(与 AI 版不同才登记) */
const editedResults = ref<Record<number, string>>({});
const editingResultId = ref<number | null>(null);
const resultDraft = ref('');
/* 工作台模式:标注=给 AI 下指令;多选=点选多段一次填同一组要求;编辑=不走 AI,直接手动改文 */
const workMode = ref<'annotate' | 'multi' | 'edit'>('annotate');
const editDrafts = ref<string[]>([]);
/* 多选模式的选中段落与共用要求草稿(应用后写入各段标注,自身即清空) */
const multiSelected = ref<number[]>([]);
const bulkPhraseIds = ref<number[]>([]);
const bulkNote = ref('');
const generationError = ref('');
const saving = ref(false);
const replacing = ref(false);
const contextSummary = ref('');
const generationTask = shallowRef<GenerationTask | null>(null);
const currentChatIdentity = ref(getOpenChatIdentity());
let generationSequence = 0;

const generating = computed(() => generationTask.value?.outcome === null);
const viewingGenerationTarget = computed(() =>
  isGenerationTargetOpen(
    generationTask.value,
    currentChatIdentity.value,
    ui.floor,
  ),
);
const generationButtonLabel = computed(() => {
  if (!generating.value) return ui.stage === 'annotate' ? 'Generate' : 'Regenerate';
  if (viewingGenerationTarget.value) return 'Generating…';
  return `#${generationTask.value?.floor ?? ''} generating`;
});

const phrases = computed(() =>
  [...penSettings.phrases].sort((left, right) => Number(right.favorite) - Number(left.favorite)),
);

/* —— 工作台:行标注是主体;整体要求与查找替换为顶部折叠区 —— */
const generalFilled = computed(() => !!generalNote.value.trim() || globalPhraseIds.value.length > 0);
const enabledRuleCount = computed(() => penSettings.replaceRules.filter(rule => rule.enabled).length);

const markedCount = computed(() => ui.paragraphs.filter(paragraph => isMarked(paragraph.id)).length);
const hasInstructions = computed(
  () =>
    markedCount.value > 0 ||
    !!generalNote.value.trim() ||
    globalPhraseIds.value.length > 0,
);
const nextTheme = computed(() => {
  const index = THEMES.findIndex(theme => theme.value === ui.theme);
  return THEMES[(index + 1) % THEMES.length];
});
const reviewRows = computed(() =>
  buildReviewRows(
    rewriteChanges.value,
    ui.paragraphs.map(paragraph => paragraph.text),
  ).map(row => ({
    ...row,
    marked: row.paragraphs.some(isMarked),
  })),
);
const acceptedCount = computed(
  () => rewriteChanges.value.filter(change => reviewDecision.value[change.paragraph] === 'accept').length,
);

function reviewRowDecision(row: ReviewRow): 'accept' | 'reject' | 'mixed' {
  const decisions = row.paragraphs.map(paragraph => reviewDecision.value[paragraph]);
  if (decisions.every(decision => decision === 'accept')) return 'accept';
  if (decisions.every(decision => decision === 'reject')) return 'reject';
  return 'mixed';
}

function setReviewRowDecision(row: ReviewRow, decision: 'accept' | 'reject'): void {
  for (const paragraph of row.paragraphs) {
    reviewDecision.value[paragraph] = decision;
  }
}

watch(
  () => ui.sessionRevision,
  () => {
    markedPhrases.value = {};
    paragraphNotes.value = {};
    expandedId.value = null;
    generalNote.value = '';
    globalPhraseIds.value = [];
    rewriteChanges.value = [];
    reviewDecision.value = {};
    editedResults.value = {};
    editingResultId.value = null;
    resultDraft.value = '';
    workMode.value = 'annotate';
    editDrafts.value = [];
    multiSelected.value = [];
    bulkPhraseIds.value = [];
    bulkNote.value = '';
    generationError.value = '';
    contextSummary.value = '';
    contextRounds.value = penSettings.defaultContextRounds;
    selectedChannelId.value =
      penSettings.defaultChannelId &&
      channels.some(channel => channel.id === penSettings.defaultChannelId)
        ? penSettings.defaultChannelId
        : '';
    ui.stage = 'annotate';
  },
  { immediate: true },
);

watch(
  () => penSettings.theme,
  theme => {
    if (ui.theme !== theme) ui.theme = theme;
  },
  { immediate: true },
);

watch(
  () => ui.theme,
  theme => {
    if (penSettings.theme !== theme) penSettings.theme = theme;
  },
);

watch(
  () => channels.map(channel => channel.id),
  ids => {
    if (selectedChannelId.value && !ids.includes(selectedChannelId.value)) {
      selectedChannelId.value = '';
    }
    if (penSettings.defaultChannelId && !ids.includes(penSettings.defaultChannelId)) {
      penSettings.defaultChannelId = '';
    }
  },
);

watch(
  () => penSettings.defaultContextRounds,
  value => {
    const normalized = Math.min(10, Math.max(0, Math.floor(Number(value) || 0)));
    if (value !== normalized) penSettings.defaultContextRounds = normalized;
  },
);

// 进入设置页时静默重查一次更新(force 绕开「会话只查一次」)
watch(
  () => ui.page,
  page => {
    if (page === 'settings') void checkForUpdate(true);
  },
);

const updateConfirmOpen = ref(false);

function openUpdateConfirm(): void {
  updateConfirmOpen.value = true;
}

async function confirmUpdate(): Promise<void> {
  updateConfirmOpen.value = false;
  try {
    await performUpdate();
    toastr?.success?.('Update succeeded, reloading page…', 'BaiBai Inkwell');
  } catch (error) {
    toastr?.error?.(`Update failed: ${error instanceof Error ? error.message : String(error)}`, 'BaiBai Inkwell');
  }
}

function isMarked(id: number): boolean {
  return (markedPhrases.value[id] ?? []).length > 0 || !!paragraphNotes.value[id]?.trim();
}

function markedNames(id: number): string[] {
  return (markedPhrases.value[id] ?? [])
    .map(phraseId => penSettings.phrases.find(phrase => phrase.id === phraseId)?.name)
    .filter((name): name is string => !!name);
}

function toggleExpand(id: number): void {
  if (ui.stage !== 'annotate' || viewingGenerationTarget.value) return;
  if (expandedId.value === id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = id;
}

/* 段落补充要求直连 paragraphNotes:输入即生效,hasInstructions 实时为真,
   不会在「生成」按钮的禁用态下吞掉第一次点击 */
const noteDraft = computed<string>({
  get: () => (expandedId.value == null ? '' : paragraphNotes.value[expandedId.value] ?? ''),
  set: value => {
    if (expandedId.value != null) paragraphNotes.value[expandedId.value] = value;
  },
});

function captureWorkspaceDraft(): WorkspaceDraftSnapshot {
  return {
    selectedChannelId: selectedChannelId.value,
    contextRounds: contextRounds.value,
    carryWorldbook: carryWorldbook.value,
    carryCharDesc: carryCharDesc.value,
    carryUserDesc: carryUserDesc.value,
    generalNote: generalNote.value,
    globalPhraseIds: [...globalPhraseIds.value],
    markedPhrases: Object.fromEntries(
      Object.entries(markedPhrases.value).map(([id, phraseIds]) => [id, [...phraseIds]]),
    ),
    paragraphNotes: { ...paragraphNotes.value },
  };
}

function restoreWorkspaceDraft(draft: WorkspaceDraftSnapshot): void {
  selectedChannelId.value =
    draft.selectedChannelId &&
    channels.some(channel => channel.id === draft.selectedChannelId)
      ? draft.selectedChannelId
      : '';
  contextRounds.value = draft.contextRounds;
  carryWorldbook.value = draft.carryWorldbook;
  carryCharDesc.value = draft.carryCharDesc;
  carryUserDesc.value = draft.carryUserDesc;
  generalNote.value = draft.generalNote;
  globalPhraseIds.value = [...draft.globalPhraseIds];
  markedPhrases.value = Object.fromEntries(
    Object.entries(draft.markedPhrases).map(([id, phraseIds]) => [id, [...phraseIds]]),
  );
  paragraphNotes.value = { ...draft.paragraphNotes };
  expandedId.value = null;
}

function formatContextSummary(result: RewriteResult): string {
  return [
    `${result.historyMessageCount} history messages`,
    result.contextParts.charCard ? 'Character settings' : '',
    result.contextParts.persona ? 'User persona' : '',
    result.contextParts.worldInfo ? 'World Info' : '',
  ].filter(Boolean).join(' · ');
}

function clearMark(id: number): void {
  markedPhrases.value[id] = [];
  paragraphNotes.value[id] = '';
}

function phraseInstruction(id: number): string {
  return penSettings.phrases.find(phrase => phrase.id === id)?.instruction ?? '';
}

function rememberSelectedChannel(): void {
  penSettings.defaultChannelId = selectedChannelId.value;
}

/* —— 底栏渠道:自绘菜单(原生 select 的展开列表是浏览器样式,改不了) —— */
const channelMenuOpen = ref(false);
const channelMenu = ref<HTMLElement | null>(null);

const selectedChannelLabel = computed(() => {
  if (!selectedChannelId.value) return 'Follow main API';
  const channel = channels.find(item => item.id === selectedChannelId.value);
  if (!channel) return 'Follow main API';
  return `${channel.name || 'Unnamed channel'} · ${channel.model || 'No model set'}`;
});

function toggleChannelMenu(): void {
  channelMenuOpen.value = !channelMenuOpen.value;
}

function pickChannel(id: string): void {
  selectedChannelId.value = id;
  rememberSelectedChannel();
  channelMenuOpen.value = false;
}

function onChannelMenuDocDown(event: PointerEvent): void {
  if (channelMenu.value && !event.composedPath().includes(channelMenu.value)) {
    channelMenuOpen.value = false;
  }
}

function onChannelMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') channelMenuOpen.value = false;
}

watch(channelMenuOpen, open => {
  // 组件在 shadow root 里,composedPath 能穿过 shadow 边界,据此判断点在外部
  if (open) {
    document.addEventListener('pointerdown', onChannelMenuDocDown, true);
    document.addEventListener('keydown', onChannelMenuKeydown, true);
  } else {
    document.removeEventListener('pointerdown', onChannelMenuDocDown, true);
    document.removeEventListener('keydown', onChannelMenuKeydown, true);
  }
});

/* —— 楼层列表(魔法棒入口):列出当前聊天可改写的楼层,新的在前 —— */
interface FloorRow {
  floor: number;
  name: string;
  isUser: boolean;
  /** 已隐藏楼层(is_system):不参与上下文,列表里以小幽灵标注 */
  hidden: boolean;
}

interface FloorPreviewRow extends FloorRow {
  preview: string;
}

const FLOOR_PAGE_SIZE = 20;
const floorRows = ref<FloorRow[]>([]);
const floorChatOpen = ref(false);
const floorPage = ref(0);
const floorQuery = ref('');
const floorSearchOpen = ref(false);
const floorSearchInput = ref<HTMLInputElement | null>(null);
const floorPanel = ref<HTMLElement | null>(null);

// 搜索框默认收成一个小图标,点击展开并自动聚焦;再点图标/Esc 清空并收起
async function toggleFloorSearch(): Promise<void> {
  if (floorSearchOpen.value) {
    closeFloorSearch();
    return;
  }
  floorSearchOpen.value = true;
  await nextTick();
  floorSearchInput.value?.focus();
}

function closeFloorSearch(): void {
  floorQuery.value = '';
  floorSearchOpen.value = false;
}

function onFloorSearchBlur(): void {
  if (!floorQuery.value.trim()) floorSearchOpen.value = false;
}

// 默认只列 AI 楼层;「显示 User 消息」开关打开后才带上用户楼层
const visibleFloorRows = computed(() =>
  penSettings.showUserFloors ? floorRows.value : floorRows.value.filter(row => !row.isUser),
);

// 搜索:纯数字时把该楼层号精确命中置顶,同时保留按关键词命中的结果
const filteredFloorRows = computed(() => {
  const query = floorQuery.value.trim().toLowerCase();
  if (!query) return visibleFloorRows.value;
  const chat = getContext()?.chat ?? [];
  const matched = visibleFloorRows.value.filter(row => {
    const rawText = chat[row.floor]?.mes;
    return (
      row.name.toLowerCase().includes(query) ||
      (typeof rawText === 'string' && rawText.toLowerCase().includes(query))
    );
  });
  if (!/^\d+$/.test(query)) return matched;
  const exact = visibleFloorRows.value.find(row => row.floor === Number(query));
  if (!exact) return matched;
  return [exact, ...matched.filter(row => row.floor !== exact.floor)];
});

const floorPageCount = computed(() =>
  Math.max(1, Math.ceil(filteredFloorRows.value.length / FLOOR_PAGE_SIZE)),
);
const pagedFloorRows = computed<FloorPreviewRow[]>(() => {
  const chat = getContext()?.chat ?? [];
  return filteredFloorRows.value
    .slice(floorPage.value * FLOOR_PAGE_SIZE, (floorPage.value + 1) * FLOOR_PAGE_SIZE)
    .map(row => ({
      ...row,
      preview: buildFloorPreview(chat[row.floor]?.mes ?? ''),
    }));
});
const floorPagerInfo = computed(() => {
  const head = floorQuery.value.trim() ? `${filteredFloorRows.value.length} matching ${filteredFloorRows.value.length === 1 ? 'message' : 'messages'}` : `${visibleFloorRows.value.length} ${visibleFloorRows.value.length === 1 ? 'message' : 'messages'}`;
  return `${head} · page ${floorPage.value + 1} / ${floorPageCount.value}`;
});

watch(floorQuery, () => {
  floorPage.value = 0;
});

watch(
  () => penSettings.showUserFloors,
  () => {
    floorPage.value = 0;
  },
);

watch(floorPage, () => {
  floorPanel.value?.scrollTo({ top: 0 });
});

// ST 的 chat 不是响应式的,computed 会缓存旧聊天;每次进入楼层页时重建
function refreshFloorRows(): void {
  const context = getContext();
  const chatId = getOpenChatId(context);
  floorChatOpen.value = !!chatId;
  if (!chatId) {
    floorRows.value = [];
    ui.floor = null;
    ui.floorLabel = '';
    ui.speaker = '';
    ui.originalText = '';
    ui.chatId = '';
    ui.paragraphs = [];
    floorPage.value = 0;
    floorQuery.value = '';
    floorSearchOpen.value = false;
    return;
  }

  if (ui.chatId && ui.chatId !== chatId) {
    ui.floor = null;
    ui.floorLabel = '';
    ui.speaker = '';
    ui.originalText = '';
    ui.chatId = '';
    ui.paragraphs = [];
  }

  const chat = context?.chat ?? [];
  const rows: FloorRow[] = [];
  chat.forEach((message, index) => {
    if (!message || message.mes == null) return;
    rows.push({
      floor: index,
      name: message.name || (message.is_user ? context?.name1 : context?.name2) || (message.is_user ? 'User' : 'Char'),
      isUser: message.is_user === true,
      hidden: message.is_system === true,
    });
  });
  floorRows.value = rows.reverse();
  floorPage.value = 0;
  floorQuery.value = '';
  floorSearchOpen.value = false;
}

watch(
  () => [ui.open, ui.page] as const,
  ([open, page]) => {
    if (open && page === 'floors') refreshFloorRows();
  },
  { immediate: true },
);

function enterFloor(floor: number): void {
  const ok = openFloorInPen(floor);
  if (!ok) showToast('Cannot open this message');
}

async function onToggleFloorHidden(floor: number): Promise<void> {
  try {
    const nowHidden = await toggleFloorHidden(floor);
    refreshFloorRows();
    showToast(nowHidden ? `Message ${floor} hidden` : `Message ${floor} shown`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Operation failed');
  }
}

async function onDeleteFloor(floor: number): Promise<void> {
  try {
    const deleted = await deleteFloorsFrom(floor);
    if (!deleted) return;
    // 被删范围包含当前正在改写的楼层时,工作区内容已失效,一并清掉
    if (ui.floor != null && ui.floor >= floor) {
      ui.floor = null;
      ui.floorLabel = '';
      ui.speaker = '';
      ui.originalText = '';
      ui.chatId = '';
      ui.paragraphs = [];
    }
    refreshFloorRows();
    showToast(`Deleted message ${floor} and the ${deleted} after it`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Delete failed');
  }
}

/* —— 楼层截图:深度 0 重渲染 + 酒馆助手 iframe 实况合成,导出 PNG —— */
const shootingFloor = ref<number | null>(null);

async function onShootFloor(floor: number): Promise<void> {
  if (shootingFloor.value != null) return;
  shootingFloor.value = floor;
  showToast(`Capturing screenshot of message ${floor}…`);
  try {
    const { blob, outcome } = await captureFloorShot(floor);
    downloadBlob(blob, outcome.suggestedName);
    if (outcome.frontendBlocks > outcome.iframesCaptured) {
      const missed = outcome.frontendBlocks - outcome.iframesCaptured;
      toastr?.warning?.(
        outcome.floorInDom
          ? `Screenshot saved, but ${missed} front-end widgets did not render and are shown as code blocks`
          : `Screenshot saved, but the message was not loaded in the chat, so ${missed} front-end widgets are shown as code blocks`,
        'BaiBai Inkwell',
      );
    } else {
      showToast(`Screenshot of message ${floor} saved`);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Screenshot failed');
  } finally {
    shootingFloor.value = null;
  }
}

function goToWorkspace(): void {
  ui.page = ui.floor == null ? 'floors' : 'workspace';
}

// 移动端:再点一下当前页的导航按钮即关闭整窗(对齐柏宝书,省得去够右上角的 ×);非当前页正常切页。
function onMobileNavClick(page: AppPage): void {
  if (ui.page === page) {
    closePen();
    return;
  }
  if (page === 'workspace') goToWorkspace();
  else ui.page = page;
}

function isCurrentGenerationTask(taskId: number): boolean {
  return generationTask.value?.id === taskId;
}

function discardGenerationTask(taskId: number, notify = false): void {
  const task = generationTask.value;
  if (!task || task.id !== taskId) return;
  task.controller.abort();
  generationTask.value = null;
  if (notify) showToast('Chat switched; this generation result was discarded');
}

async function reconcileGenerationTask(expectedTaskId?: number): Promise<void> {
  const task = generationTask.value;
  if (!task || (expectedTaskId !== undefined && task.id !== expectedTaskId)) return;

  currentChatIdentity.value = getOpenChatIdentity();
  const location = classifyGenerationChat(task.chatIdentity, currentChatIdentity.value);
  if (location === 'home') return;
  if (location === 'other') {
    discardGenerationTask(task.id, true);
    return;
  }
  if (!task.outcome) return;

  const currentText = getFloorSourceText(task.floor);
  if (currentText == null) {
    generationTask.value = null;
    toastr?.warning?.(`Target message #${task.floor} no longer exists; result discarded`, 'BaiBai Inkwell');
    return;
  }
  if (currentText !== task.originalText) {
    generationTask.value = null;
    toastr?.warning?.(`Message #${task.floor} changed during generation; result discarded`, 'BaiBai Inkwell');
    return;
  }
  if (!openFloorInPen(task.floor)) {
    generationTask.value = null;
    toastr?.warning?.(`Cannot reopen target message #${task.floor}`, 'BaiBai Inkwell');
    return;
  }

  await nextTick();
  if (!isCurrentGenerationTask(task.id)) return;
  currentChatIdentity.value = getOpenChatIdentity();
  const locationAfterOpen = classifyGenerationChat(task.chatIdentity, currentChatIdentity.value);
  if (locationAfterOpen === 'home') return;
  if (locationAfterOpen === 'other') {
    discardGenerationTask(task.id, true);
    return;
  }
  restoreWorkspaceDraft(task.draft);
  generationError.value = '';
  contextSummary.value = '';

  if (task.outcome.kind === 'success') {
    rewriteChanges.value = task.outcome.result.changes;
    reviewDecision.value = Object.fromEntries(
      task.outcome.result.changes.map(change => [change.paragraph, 'accept' as const]),
    );
    contextSummary.value = formatContextSummary(task.outcome.result);
    ui.stage = 'review';
  } else {
    rewriteChanges.value = [];
    reviewDecision.value = {};
    generationError.value = task.outcome.message;
    ui.stage = 'annotate';
    showToast('Generation failed');
  }

  generationTask.value = null;
}

let chatChangedHandler: (() => void) | null = null;
let chatChangedEvent: unknown;

onMounted(() => {
  const context = getContext();
  currentChatIdentity.value = getOpenChatIdentity(context);
  const event = context?.eventTypes?.CHAT_CHANGED;
  const on = context?.eventSource?.on;
  if (!event || typeof on !== 'function') return;
  chatChangedEvent = event;
  chatChangedHandler = () => {
    window.setTimeout(() => {
      currentChatIdentity.value = getOpenChatIdentity();
      void reconcileGenerationTask();
    }, 0);
  };
  on.call(context.eventSource, event, chatChangedHandler);
});

onUnmounted(() => {
  const context = getContext();
  if (chatChangedHandler && chatChangedEvent && typeof context?.eventSource?.off === 'function') {
    context.eventSource.off(chatChangedEvent, chatChangedHandler);
  }
  generationTask.value?.controller.abort();
});

async function startReview(): Promise<void> {
  if (generationTask.value || saving.value || replacing.value) return;
  if (!hasInstructions.value) {
    showToast('Add a line annotation or an overall request first');
    return;
  }
  if (ui.floor == null || !ui.originalText.trim()) {
    showToast('Current message unavailable');
    return;
  }
  contextRounds.value = Math.min(10, Math.max(0, Math.floor(Number(contextRounds.value) || 0)));

  const context = getContext();
  const chatId = getOpenChatId(context);
  const chatIdentity = getOpenChatIdentity(context);
  if (!chatId || !chatIdentity) {
    showToast('Current chat unavailable');
    return;
  }

  const floor = ui.floor;
  const originalText = ui.originalText;
  const draft = captureWorkspaceDraft();
  const selectedChannel = selectedChannelId.value
    ? channels.find(channel => channel.id === selectedChannelId.value) ?? null
    : null;
  const controller = new AbortController();
  const task: GenerationTask = {
    id: ++generationSequence,
    chatId,
    chatIdentity,
    floor,
    originalText,
    draft,
    controller,
    outcome: null,
  };
  currentChatIdentity.value = chatIdentity;
  const annotations = ui.paragraphs
    .filter(paragraph => isMarked(paragraph.id))
    .map(paragraph => ({
      paragraph: paragraph.id,
      text: paragraph.text,
      instructions: [
        ...(markedPhrases.value[paragraph.id] ?? []).map(phraseInstruction),
        paragraphNotes.value[paragraph.id] ?? '',
      ].filter(Boolean),
    }));
  const generalInstructions = [
    ...globalPhraseIds.value.map(phraseInstruction),
    generalNote.value,
  ].filter(Boolean);

  generationError.value = '';
  contextSummary.value = '';
  generationTask.value = task;
  try {
    const result = await rewriteCurrentFloor({
      floor,
      originalText,
      contextRounds: draft.contextRounds,
      includeWorldInfo: draft.carryWorldbook,
      includeCharacterDescription: draft.carryCharDesc,
      includeUserDescription: draft.carryUserDesc,
      channel: selectedChannel ? JSON.parse(JSON.stringify(selectedChannel)) as ApiChannel : null,
      signal: controller.signal,
      generalInstructions,
      annotations,
    });
    if (!isCurrentGenerationTask(task.id)) return;
    generationTask.value = {
      ...task,
      outcome: { kind: 'success', result },
    };
    await reconcileGenerationTask(task.id);
  } catch (error) {
    if (!isCurrentGenerationTask(task.id)) return;
    if (error instanceof DOMException && error.name === 'AbortError') {
      generationTask.value = null;
      return;
    } else {
      generationTask.value = {
        ...task,
        outcome: {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
      await reconcileGenerationTask(task.id);
    }
  }
}

function cancelGeneration(): void {
  const task = generationTask.value;
  if (!task || task.outcome) return;
  task.controller.abort();
  generationTask.value = null;
  showToast('Generation cancelled');
}

function backToAnnotate(): void {
  if (viewingGenerationTarget.value) return;
  ui.stage = 'annotate';
}

/* 离开标注页就退回标注模式,手改草稿与多选状态随之丢弃(都只活在标注页里) */
watch(
  () => ui.stage,
  stage => {
    if (stage !== 'annotate') {
      workMode.value = 'annotate';
      multiSelected.value = [];
      bulkPhraseIds.value = [];
      bulkNote.value = '';
    }
  },
);

/* textarea 随内容自动增高;v-model 更新值后 updated 钩子会再量一次 */
function growTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const vAutogrow = {
  mounted: (el: HTMLTextAreaElement) => growTextarea(el),
  updated: (el: HTMLTextAreaElement) => growTextarea(el),
};

function setWorkMode(mode: 'annotate' | 'multi' | 'edit'): void {
  if (mode === workMode.value) return;
  if (mode === 'edit') {
    expandedId.value = null;
    editDrafts.value = ui.paragraphs.map(paragraph => paragraph.text);
  }
  if (mode === 'multi') {
    expandedId.value = null;
    multiSelected.value = [];
    bulkPhraseIds.value = [];
    bulkNote.value = '';
  }
  workMode.value = mode;
}

/* —— 多选批量标注:点选若干段落,把同一组要求一次写入每段的标注 —— */
function isMultiSelected(id: number): boolean {
  return multiSelected.value.includes(id);
}

function toggleMultiSelect(id: number): void {
  if (viewingGenerationTarget.value) return;
  multiSelected.value = isMultiSelected(id)
    ? multiSelected.value.filter(item => item !== id)
    : [...multiSelected.value, id];
}

const bulkFilled = computed(() => bulkPhraseIds.value.length > 0 || !!bulkNote.value.trim());

/* 应用即写入 markedPhrases/paragraphNotes(与单段标注同一份数据,生成流程不感知多选)。
   语句去重合并,补充要求追加成新行,不覆盖各段已有标注 */
function applyBulkAnnotation(): void {
  if (!multiSelected.value.length || !bulkFilled.value) return;
  const note = bulkNote.value.trim();
  for (const id of multiSelected.value) {
    if (bulkPhraseIds.value.length) {
      const merged = new Set([...(markedPhrases.value[id] ?? []), ...bulkPhraseIds.value]);
      markedPhrases.value[id] = [...merged];
    }
    if (note) {
      const existing = paragraphNotes.value[id]?.trim();
      paragraphNotes.value[id] = existing ? `${existing}\n${note}` : note;
    }
  }
  const count = multiSelected.value.length;
  multiSelected.value = [];
  bulkPhraseIds.value = [];
  bulkNote.value = '';
  workMode.value = 'annotate';
  showToast(`Request applied to ${count} ${count === 1 ? 'paragraph' : 'paragraphs'}`);
}

function cancelMultiSelect(): void {
  workMode.value = 'annotate';
  multiSelected.value = [];
  bulkPhraseIds.value = [];
  bulkNote.value = '';
}

function discardManualEdit(): void {
  workMode.value = 'annotate';
  editDrafts.value = [];
}

const editDirty = computed(() =>
  ui.paragraphs.some(
    (paragraph, index) => (editDrafts.value[index] ?? paragraph.text).trim() !== paragraph.text,
  ),
);

/* 手动保存:只把改过的段落交给 applyParagraphReplacements,未动行的空白/缩进原样保留;
   段落清空即删除该行(与审阅页接受「删除行」同一语义) */
async function saveManualEdit(): Promise<void> {
  if (saving.value || replacing.value || generating.value || viewingGenerationTarget.value) return;
  if (ui.floor == null) {
    showToast('Current message unavailable');
    return;
  }
  const replacements = new Map<number, string>();
  ui.paragraphs.forEach((paragraph, index) => {
    const draft = (editDrafts.value[index] ?? paragraph.text).trim();
    if (draft !== paragraph.text) replacements.set(paragraph.id, draft);
  });
  if (!replacements.size) {
    showToast('Nothing changed');
    return;
  }
  const nextText = applyParagraphReplacements(ui.originalText, replacements);
  if (!nextText.trim()) {
    showToast('Cannot save the message as empty');
    return;
  }

  const floor = ui.floor;
  const originalText = ui.originalText;
  const chatId = ui.chatId;
  const hadMarks = hasInstructions.value;
  saving.value = true;
  try {
    const result = await applyFloorText(floor, originalText, nextText, chatId);
    if (result === 'chat-changed') {
      showToast('The chat has switched; changes cannot be saved');
      return;
    }
    if (result === 'floor-changed') {
      showToast('Message content has changed; reopen Inkwell');
      return;
    }
    if (result !== 'saved') {
      showToast('Cannot save the current message');
      return;
    }
    // 重开楼层让段落与最新内容对齐;行号可能已变,原有标注由会话重置一并清掉
    if (ui.floor === floor && ui.chatId === chatId) {
      openFloorInPen(floor);
    }
    showToast(hadMarks ? 'Changes saved; existing annotations were reset because line numbers changed' : 'Changes saved to the message');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Failed to save message');
  } finally {
    saving.value = false;
  }
}

/* —— 审阅页内联手改 AI 结果 —— */
function rowEditedResult(row: ReviewRow): string | null {
  if (row.deleted || row.paragraphs.length !== 1) return null;
  return editedResults.value[row.paragraphs[0] ?? -1] ?? null;
}

function displayRowResult(row: ReviewRow): string {
  return rowEditedResult(row) ?? row.result;
}

function isEditingRow(row: ReviewRow): boolean {
  return (
    !row.deleted &&
    row.paragraphs.length === 1 &&
    editingResultId.value === row.paragraphs[0]
  );
}

function startResultEdit(row: ReviewRow): void {
  if (row.deleted || row.paragraphs.length !== 1) return;
  const paragraph = row.paragraphs[0] ?? -1;
  editingResultId.value = paragraph;
  resultDraft.value = editedResults.value[paragraph] ?? row.result;
}

function finishResultEdit(): void {
  const paragraph = editingResultId.value;
  if (paragraph == null) return;
  editingResultId.value = null;
  const change = rewriteChanges.value.find(item => item.paragraph === paragraph);
  if (!change) return;
  const draft = resultDraft.value.trim();
  if (draft === change.replacement) {
    delete editedResults.value[paragraph];
    return;
  }
  editedResults.value[paragraph] = draft;
  // 手改即采纳:用户动手改了,意图就是应用这条
  reviewDecision.value[paragraph] = 'accept';
}

function revertResultEdit(row: ReviewRow): void {
  if (row.paragraphs.length !== 1) return;
  const paragraph = row.paragraphs[0] ?? -1;
  delete editedResults.value[paragraph];
  if (editingResultId.value === paragraph) resultDraft.value = row.result;
}

const editedAcceptedCount = computed(
  () =>
    rewriteChanges.value.filter(
      change =>
        reviewDecision.value[change.paragraph] === 'accept' &&
        editedResults.value[change.paragraph] !== undefined,
    ).length,
);

const applyButtonLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (acceptedCount.value === 0) return 'Discard all';
  const base = `Apply ${acceptedCount.value} ${acceptedCount.value === 1 ? 'line' : 'lines'}`;
  return editedAcceptedCount.value > 0 ? `${base} (${editedAcceptedCount.value} manual edits)` : base;
});

async function finishReview(): Promise<void> {
  if (generating.value || saving.value || replacing.value) return;
  if (ui.floor == null || !rewriteChanges.value.length) return;
  if (acceptedCount.value === 0) {
    closePen();
    toastr?.info?.('Discarded all rewrite results; the original message is unchanged', 'BaiBai Inkwell');
    return;
  }
  const accepted = new Map(
    rewriteChanges.value
      .filter(change => reviewDecision.value[change.paragraph] === 'accept')
      .map(change => [change.paragraph, editedResults.value[change.paragraph] ?? change.replacement] as const),
  );
  const nextText = applyParagraphReplacements(ui.originalText, accepted);

  saving.value = true;
  try {
    const result = await applyFloorText(ui.floor, ui.originalText, nextText, ui.chatId);
    if (result === 'chat-changed') {
      showToast('The chat has switched; results cannot be applied');
      return;
    }
    if (result === 'floor-changed') {
      showToast('Message content has changed; reopen Inkwell');
      return;
    }
    if (result !== 'saved') {
      showToast('Cannot save the current message');
      return;
    }
    closePen();
    toastr?.info?.(`Rewrite results saved to message #${ui.floor}`, 'BaiBai Inkwell');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Failed to save message');
  } finally {
    saving.value = false;
  }
}

function showToast(message: string): void {
  toastText.value = message;
  window.setTimeout(() => {
    if (toastText.value === message) toastText.value = '';
  }, 2200);
}

const excludeParamsText = computed<string>({
  get: () => channelDraft.value?.excludeParams.join(', ') ?? '',
  set: value => {
    if (!channelDraft.value) return;
    channelDraft.value.excludeParams = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  },
});

const filteredModelOptions = computed<string[]>(() => {
  const query = modelQuery.value.trim().toLowerCase();
  const options = query
    ? modelOptions.value.filter(model => model.toLowerCase().includes(query))
    : modelOptions.value;
  return options.slice(0, 200);
});

function openModelMenu(): void {
  modelQuery.value = '';
  modelMenuOpen.value = true;
}

function pickModel(model: string): void {
  if (channelDraft.value) channelDraft.value.model = model;
  modelMenuOpen.value = false;
  modelQuery.value = '';
}

function closeModelMenuSoon(): void {
  window.setTimeout(() => {
    modelMenuOpen.value = false;
    modelQuery.value = '';
  }, 150);
}

function openChannel(channel?: ApiChannel): void {
  if (!sharingState.ready) {
    showToast('Channels are loading');
    return;
  }
  if (!canEditChannels()) {
    requestBookUpdate();
    return;
  }
  testMessage.value = '';
  modelOptions.value = [];
  loadingModels.value = false;
  modelMenuOpen.value = false;
  modelQuery.value = '';
  showKey.value = false;
  channelDraft.value = channel
    ? JSON.parse(JSON.stringify(channel))
    : newChannel();
}

function saveChannel(): void {
  if (!channelDraft.value) return;
  if (!channelDraft.value.name.trim()) {
    showToast('Enter a channel name');
    return;
  }
  saveSharedChannel(channelDraft.value);
  selectedChannelId.value = channelDraft.value.id;
  rememberSelectedChannel();
  channelDraft.value = null;
  showToast('Channel saved');
}

function removeChannel(): void {
  if (!channelDraft.value) return;
  removeSharedChannel(channelDraft.value.id);
  channelDraft.value = null;
  selectedChannelId.value = channels[0]?.id ?? '';
  rememberSelectedChannel();
  showToast('Channel deleted');
}

async function testChannel(): Promise<void> {
  if (!channelDraft.value) return;
  testMessage.value = 'Testing…';
  const result = await testApiChannel(channelDraft.value);
  testMessage.value = result.message;
}

async function loadModels(): Promise<void> {
  if (!channelDraft.value || loadingModels.value) return;
  loadingModels.value = true;
  testMessage.value = 'Fetching models…';
  try {
    modelOptions.value = await fetchModels(channelDraft.value);
    if (!channelDraft.value.model && modelOptions.value[0]) {
      channelDraft.value.model = modelOptions.value[0];
    }
    testMessage.value = modelOptions.value.length
      ? `Fetched ${modelOptions.value.length} models`
      : 'The endpoint returned no usable models';
  } catch (error) {
    testMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loadingModels.value = false;
  }
}

function openPhrase(phrase?: QuickPhrase): void {
  phraseDraft.value = phrase
    ? JSON.parse(JSON.stringify(phrase))
    : { id: Date.now(), name: '', instruction: '', favorite: false };
}

function savePhrase(): void {
  if (!phraseDraft.value?.name.trim() || !phraseDraft.value.instruction.trim()) {
    showToast('Enter a name and an instruction');
    return;
  }
  const index = penSettings.phrases.findIndex(phrase => phrase.id === phraseDraft.value?.id);
  if (index >= 0) penSettings.phrases[index] = phraseDraft.value;
  else penSettings.phrases.push(phraseDraft.value);
  phraseDraft.value = null;
  showToast('Quick phrase saved');
}

function removePhrase(): void {
  if (!phraseDraft.value) return;
  const index = penSettings.phrases.findIndex(phrase => phrase.id === phraseDraft.value?.id);
  if (index >= 0) penSettings.phrases.splice(index, 1);
  phraseDraft.value = null;
}

/* —— 查找替换:快速替换当前楼层,或按顺序执行已启用的全局规则 —— */
const ruleDraft = ref<ReplaceRule | null>(null);

const quickFind = ref('');
const quickReplacement = ref('');
const quickIsRegex = ref(false);

async function applyReplacement(result: ReplacementResult): Promise<void> {
  if (replacing.value || viewingGenerationTarget.value || saving.value) return;
  if (ui.floor == null) {
    showToast('Current message unavailable');
    return;
  }
  if (!result.count || result.text === ui.originalText) {
    showToast(result.count ? 'Replacement made no change' : 'No matches in the current message');
    return;
  }

  const floor = ui.floor;
  const originalText = ui.originalText;
  const chatId = ui.chatId;
  replacing.value = true;
  try {
    const applyResult = await applyFloorText(floor, originalText, result.text, chatId);
    if (applyResult === 'chat-changed') {
      showToast('The chat has switched; replacement cannot run');
      return;
    }
    if (applyResult === 'floor-changed') {
      showToast('Message content has changed; reopen Inkwell');
      return;
    }
    if (applyResult !== 'saved') {
      showToast('Cannot save the current message');
      return;
    }

    if (ui.floor === floor && ui.chatId === chatId) {
      openFloorInPen(floor);
    }
    showToast(`Replaced ${result.count} ${result.count === 1 ? 'occurrence' : 'occurrences'}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Replace failed');
  } finally {
    replacing.value = false;
  }
}

async function runQuickReplace(): Promise<void> {
  try {
    await applyReplacement(
      replaceText(ui.originalText, {
        pattern: quickFind.value,
        replacement: quickReplacement.value,
        isRegex: quickIsRegex.value,
      }),
    );
  } catch (error) {
    showToast(error instanceof Error ? `Invalid regular expression: ${error.message}` : 'Replace failed');
  }
}

function saveQuickAsRule(): void {
  openRule({
    id: Date.now(),
    name: '',
    pattern: quickFind.value,
    replacement: quickReplacement.value,
    isRegex: quickIsRegex.value,
    enabled: true,
  });
}

function openRule(rule?: ReplaceRule): void {
  ruleDraft.value = rule
    ? JSON.parse(JSON.stringify(rule))
    : { id: Date.now(), name: '', pattern: '', replacement: '', isRegex: false, enabled: true };
}

function saveRule(): void {
  if (!ruleDraft.value?.name.trim() || !ruleDraft.value.pattern) {
    showToast('Enter a rule name and match text');
    return;
  }
  const index = penSettings.replaceRules.findIndex(rule => rule.id === ruleDraft.value?.id);
  if (index >= 0) penSettings.replaceRules[index] = ruleDraft.value;
  else penSettings.replaceRules.push(ruleDraft.value);
  ruleDraft.value = null;
  showToast('Replacement rule saved');
}

function removeRule(): void {
  if (!ruleDraft.value) return;
  const index = penSettings.replaceRules.findIndex(rule => rule.id === ruleDraft.value?.id);
  if (index >= 0) penSettings.replaceRules.splice(index, 1);
  ruleDraft.value = null;
}

async function runReplace(): Promise<void> {
  const enabledRules = penSettings.replaceRules.filter(rule => rule.enabled);
  try {
    await applyReplacement(replaceTextWithRules(ui.originalText, enabledRules));
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Failed to run rules');
  }
}

/* —— 自定义提示词:列表(破限/思维链),点开在弹窗里编辑大文本 —— */
type PromptKey = keyof PenSettings['prompts'];
interface PromptMeta {
  key: PromptKey;
  label: string;
  hint: string;
  builtin: string;
}
const PROMPT_METAS: PromptMeta[] = [
  {
    key: 'jailbreak',
    label: 'System prompt',
    hint: 'Added as a top system message to rewrite requests. Leave empty to use the built-in default.',
    builtin: JAILBREAK_PROMPT,
  },
  {
    key: 'chainOfThought',
    label: 'Editorial review prompt',
    hint: 'Appended after the editing task. Requests a brief review of the changes, then paragraph patches. Leave empty to use the built-in default.',
    builtin: CHAIN_OF_THOUGHT_PROMPT,
  },
];

// 正在编辑的提示词;draft 是草稿,点「完成」才写回 penSettings(取消则丢弃)。
const editingPrompt = ref<PromptMeta | null>(null);
const promptDraft = ref('');

// 该提示词是否已自定义(非空即视为已覆盖内置)
function isCustomPrompt(key: PromptKey): boolean {
  return penSettings.prompts[key].trim().length > 0;
}

function openPrompt(meta: PromptMeta): void {
  editingPrompt.value = meta;
  // 已自定义→载入用户内容;未自定义→预填内置模板,方便直接在其上改
  promptDraft.value = penSettings.prompts[meta.key].trim() || meta.builtin;
}
function closePrompt(): void {
  editingPrompt.value = null;
  promptDraft.value = '';
}
function savePrompt(): void {
  const meta = editingPrompt.value;
  if (!meta) return;
  // 草稿与内置完全一致→存空串(回落内置),避免把模板冗余存进设置、也便于显示「默认」
  const v = promptDraft.value.trim();
  penSettings.prompts[meta.key] = v === meta.builtin.trim() ? '' : promptDraft.value;
  closePrompt();
  showToast('Prompts saved');
}
// 「恢复默认」:把草稿重置回内置模板(保存后即回落内置)
function resetPrompt(): void {
  if (editingPrompt.value) promptDraft.value = editingPrompt.value.builtin;
}

let pressedOnOverlay = false;

function onOverlayPointerDown(event: PointerEvent): void {
  pressedOnOverlay = event.target === event.currentTarget;
}

function onOverlayClick(event: MouseEvent): void {
  const justOpened = performance.now() - lastOpenedAt < 350;
  if (!justOpened && pressedOnOverlay && event.target === event.currentTarget) {
    closePen();
  }
  pressedOnOverlay = false;
}
</script>

<template>
  <div class="bby-root" :data-theme="ui.theme">
    <div ref="modalHost"></div>
    <Transition name="bby-fade">
      <div
        v-if="ui.open"
        class="bby-overlay"
        tabindex="-1"
        @pointerdown="onOverlayPointerDown"
        @click="onOverlayClick"
        @keydown.esc="closePen"
      >
        <section class="bby-window" role="dialog" aria-modal="true" aria-label="BaiBai Inkwell">
          <div class="bby-mobile-grabber"><span></span></div>

          <header class="bby-header">
            <span class="bby-brand-name">BaiBai Inkwell</span>
            <div class="bby-header-actions">
              <button class="bby-icon-button" type="button" :title="`Switch theme: ${nextTheme.label}`" @click="cycleTheme">
                <Icon :name="nextTheme.icon" />
              </button>
              <button class="bby-icon-button" type="button" title="Close" @click="closePen">
                <Icon name="close" />
              </button>
            </div>
          </header>

          <nav class="bby-main-nav" aria-label="Main navigation">
            <button type="button" :class="{ 'is-active': ui.page === 'floors' }" @click="ui.page = 'floors'">
              <Icon name="list" /> Messages
            </button>
            <button type="button" :class="{ 'is-active': ui.page === 'workspace' }" :disabled="ui.floor == null" @click="goToWorkspace">
              <Icon name="workspace" /> Workbench
            </button>
            <button type="button" :class="{ 'is-active': ui.page === 'settings' }" @click="ui.page = 'settings'">
              <Icon name="settings" /> Settings
              <span v-if="updateState.available" class="bby-nav-dot" aria-label="Update available"></span>
            </button>
          </nav>

          <div class="bby-page-stage">
          <Transition name="bby-page">
            <div v-if="ui.page === 'workspace'" key="workspace" class="bby-page-shell">
              <div v-if="ui.stage === 'annotate'" class="bby-work-tabs bby-status-strip">
                <span class="bby-strip-meta">
                  <span class="bby-floor-number">{{ ui.floorLabel }}</span>
                  <span v-if="workMode === 'annotate'">Annotated <b>{{ markedCount }}</b> {{ markedCount === 1 ? 'line' : 'lines' }}</span>
                  <span v-else-if="workMode === 'multi'">Selected <b>{{ multiSelected.length }}</b> paragraphs</span>
                  <span v-else>Edit the original by hand, without AI</span>
                </span>
                <div class="bby-segmented bby-mode-switch" role="tablist" aria-label="Workbench mode">
                  <button
                    type="button"
                    class="bby-seg"
                    :class="{ 'is-on': workMode === 'annotate' }"
                    :disabled="generating || saving || replacing"
                    @click="setWorkMode('annotate')"
                  >
                    Annotate
                  </button>
                  <button
                    type="button"
                    class="bby-seg"
                    :class="{ 'is-on': workMode === 'multi' }"
                    :disabled="generating || viewingGenerationTarget || saving || replacing"
                    @click="setWorkMode('multi')"
                  >
                    Multi-select
                  </button>
                  <button
                    type="button"
                    class="bby-seg"
                    :class="{ 'is-on': workMode === 'edit' }"
                    :disabled="generating || viewingGenerationTarget || saving || replacing"
                    @click="setWorkMode('edit')"
                  >
                    <Icon name="pen" /> Edit
                  </button>
                </div>
              </div>

              <div v-else class="bby-work-tabs bby-review-bar">
                <div class="bby-floor-meta">
                  <span class="bby-floor-number">{{ ui.floorLabel }}</span>
                  <strong>{{ ui.speaker }}</strong>
                </div>
                <div class="bby-doc-status">
                  <span>AI suggestions <b>{{ reviewRows.length }}</b> {{ reviewRows.length === 1 ? 'item' : 'items' }} · selected <b>{{ acceptedCount }}</b> {{ acceptedCount === 1 ? 'line' : 'lines' }}</span>
                  <button class="bby-text-action" type="button" @click="backToAnnotate">
                    <Icon name="undo" /> Back to annotations
                  </button>
                </div>
              </div>

              <main v-if="ui.stage === 'annotate'" class="bby-document" aria-label="Full message">
                <Collapsible v-if="workMode === 'annotate'" title="Overall request" class="bby-work-fold">
                  <template #badge>
                    <i v-if="generalFilled" class="bby-tab-dot"></i>
                  </template>
                  <section class="bby-general-editor">
                    <p class="bby-field-hint">A request that applies to the whole current message; sent to the AI with the line annotations.</p>
                    <PhrasePicker v-if="phrases.length" v-model="globalPhraseIds" :phrases="phrases" />
                    <textarea
                      v-model="generalNote"
                      class="bby-input bby-general-note"
                      placeholder="Optional: a request that applies to the whole current message"
                    ></textarea>
                    <div class="bby-carry-options">
                      <label class="bby-switch-row bby-carry-row">
                        <span>Context rounds to include</span>
                        <input v-model.number="contextRounds" class="bby-input bby-rounds-input" type="number" min="0" max="10" step="1" />
                      </label>
                      <label class="bby-switch-row bby-carry-row">
                        <span>Include World Info</span>
                        <input v-model="carryWorldbook" type="checkbox" class="bby-checkbox" />
                      </label>
                      <label class="bby-switch-row bby-carry-row">
                        <span>Include character description</span>
                        <input v-model="carryCharDesc" type="checkbox" class="bby-checkbox" />
                      </label>
                      <label class="bby-switch-row bby-carry-row">
                        <span>Include User persona</span>
                        <input v-model="carryUserDesc" type="checkbox" class="bby-checkbox" />
                      </label>
                    </div>
                  </section>
                </Collapsible>

                <Collapsible title="Find and replace" class="bby-work-fold">
                  <template #badge>
                    <em v-if="enabledRuleCount" class="bby-tab-count">{{ enabledRuleCount }}</em>
                  </template>
                  <section class="bby-replace-panel">
                    <div class="bby-quick-replace">
                      <div class="bby-quick-fields">
                        <input
                          v-model="quickFind"
                          class="bby-input bby-mono"
                          type="text"
                          placeholder="Find (regex supports /pattern/gi)"
                        />
                        <input
                          v-model="quickReplacement"
                          class="bby-input bby-mono"
                          type="text"
                          placeholder="Replace with (leave empty to delete)"
                        />
                      </div>
                      <div class="bby-quick-actions">
                        <label class="bby-quick-regex">
                          <input v-model="quickIsRegex" type="checkbox" class="bby-checkbox" />
                          <span>Regex</span>
                        </label>
                        <button
                          class="bby-button bby-btn-sm"
                          type="button"
                          :disabled="replacing || !quickFind"
                          @click="saveQuickAsRule"
                        >
                          <Icon name="plus" /> Save as rule
                        </button>
                        <button
                          class="bby-button bby-primary bby-btn-sm"
                          type="button"
                          :disabled="replacing || viewingGenerationTarget || saving || !quickFind"
                          @click="runQuickReplace"
                        >
                          <Icon name="replace" /> {{ replacing ? 'Replacing…' : 'Replace' }}
                        </button>
                      </div>
                    </div>

                    <div class="bby-rule-lib">
                      <div class="bby-rule-lib-head">
                        <span class="bby-field-label">Rule library</span>
                        <button class="bby-text-action bby-rule-add" type="button" title="Add rule" @click="openRule()">
                          <Icon name="plus" />
                        </button>
                      </div>
                      <ul v-if="penSettings.replaceRules.length" class="bby-rule-list">
                        <li
                          v-for="rule in penSettings.replaceRules"
                          :key="rule.id"
                          class="bby-rule"
                          :class="{ 'is-off': !rule.enabled }"
                        >
                          <input
                            v-model="rule.enabled"
                            type="checkbox"
                            class="bby-checkbox"
                            :title="rule.enabled ? 'Disable this rule' : 'Enable this rule'"
                          />
                          <button class="bby-rule-open" type="button" @click="openRule(rule)">
                            <span class="bby-rule-main">
                              <strong>{{ rule.name }}</strong>
                              <small>
                              <code>{{ rule.pattern }}</code>
                              <span class="bby-rule-sep">→</span>
                              <code>{{ rule.replacement || 'Delete' }}</code>
                            </small>
                            </span>
                            <span v-if="rule.isRegex" class="bby-tag">Regex</span>
                            <Icon name="chevron" />
                          </button>
                        </li>
                      </ul>
                      <p v-else class="bby-rule-empty">No rules yet. Save common clean-ups as rules, then tick them to reuse.</p>

                      <div class="bby-rule-run">
                        <span class="bby-replace-summary">
                          {{ enabledRuleCount ? `${enabledRuleCount} ${enabledRuleCount === 1 ? 'rule' : 'rules'} enabled` : 'No rules enabled' }}
                        </span>
                        <button
                          class="bby-button bby-btn-sm"
                          type="button"
                          :disabled="replacing || viewingGenerationTarget || saving || !enabledRuleCount"
                          @click="runReplace"
                        >
                          <Icon name="replace" /> {{ replacing ? 'Running…' : 'Run rules' }}
                        </button>
                      </div>
                    </div>
                  </section>
                </Collapsible>

                <div class="bby-sheet">
                <article
                  v-for="(paragraph, index) in ui.paragraphs"
                  :key="paragraph.id"
                  class="bby-para"
                  :class="{
                    'is-open': workMode === 'annotate' && expandedId === paragraph.id,
                    'is-marked': workMode !== 'edit' && isMarked(paragraph.id),
                    'is-selected': workMode === 'multi' && isMultiSelected(paragraph.id),
                  }"
                >
                  <textarea
                    v-if="workMode === 'edit'"
                    v-model="editDrafts[index]"
                    v-autogrow
                    class="bby-para-text bby-para-edit"
                    rows="1"
                    spellcheck="false"
                    aria-label="Edit this line by hand"
                  ></textarea>
                  <template v-else-if="workMode === 'multi'">
                    <button
                      class="bby-para-text bby-para-selectable"
                      type="button"
                      :disabled="viewingGenerationTarget"
                      :aria-pressed="isMultiSelected(paragraph.id)"
                      @click="toggleMultiSelect(paragraph.id)"
                    >
                      <span class="bby-para-check" aria-hidden="true"><Icon name="check" /></span>
                      <span class="bby-para-select-text">{{ paragraph.text }}</span>
                    </button>
                    <div v-if="isMarked(paragraph.id)" class="bby-para-tags">
                      <span v-for="name in markedNames(paragraph.id)" :key="name" class="bby-tag">{{ name }}</span>
                      <span v-if="paragraphNotes[paragraph.id]?.trim()" class="bby-tag">+ Add request</span>
                    </div>
                  </template>
                  <template v-else>
                  <button
                    class="bby-para-text"
                    type="button"
                    :disabled="viewingGenerationTarget"
                    @click="toggleExpand(paragraph.id)"
                  >
                    {{ paragraph.text }}
                  </button>

                  <div v-if="expandedId !== paragraph.id && isMarked(paragraph.id)" class="bby-para-tags">
                    <span v-for="name in markedNames(paragraph.id)" :key="name" class="bby-tag">{{ name }}</span>
                    <span v-if="paragraphNotes[paragraph.id]?.trim()" class="bby-tag">+ Add request</span>
                  </div>

                  <Transition name="bby-expand">
                    <div v-if="expandedId === paragraph.id" class="bby-para-editor">
                      <div class="bby-para-editor-head">
                        <span>Rewrite request</span>
                        <button class="bby-icon-mini bby-danger-hover" type="button" title="Clear this line's annotation" @click="clearMark(paragraph.id)">
                          <Icon name="trash" />
                        </button>
                      </div>
                      <PhrasePicker
                        v-if="phrases.length"
                        :model-value="markedPhrases[paragraph.id] ?? []"
                        :phrases="phrases"
                        @update:model-value="markedPhrases[paragraph.id] = $event"
                      />
                      <textarea
                        v-model="noteDraft"
                        class="bby-input bby-note"
                        placeholder="Describe how this line should change"
                      ></textarea>
                      <button class="bby-text-action" type="button" @click="ui.page = 'settings'">
                        <Icon name="settings" /> Manage quick phrases
                      </button>
                    </div>
                  </Transition>
                  </template>
                </article>
                </div>

                <p v-if="generationError" class="bby-error-message">{{ generationError }}</p>
              </main>

              <main v-else class="bby-document bby-review-document" aria-label="Rewrite results">
                <p v-if="contextSummary" class="bby-context-summary">{{ contextSummary }}</p>
                <p v-if="generationError" class="bby-error-message">{{ generationError }}</p>
                <div
                  v-for="row in reviewRows"
                  :key="row.key"
                  class="bby-review-row"
                  :class="{ 'is-rejected': reviewRowDecision(row) === 'reject' }"
                >
                  <div class="bby-review-row-head">
                    <span class="bby-floor-number">{{ row.label }}</span>
                    <span class="bby-tag">
                      {{ row.deleted ? row.paragraphs.length > 1 ? `Delete ${row.paragraphs.length} lines` : 'Delete line' : row.marked ? 'Annotated line' : 'Related adjustment' }}
                    </span>
                    <span v-if="rowEditedResult(row) !== null" class="bby-tag bby-tag-edited">Edited by hand</span>
                    <button
                      v-if="!row.deleted"
                      class="bby-icon-mini bby-row-edit"
                      type="button"
                      title="Edit this result by hand"
                      @click="startResultEdit(row)"
                    >
                      <Icon name="pen" />
                    </button>
                  </div>
                  <div class="bby-review-columns">
                    <div>
                      <span class="bby-review-label">Original</span>
                      <p>{{ row.original }}</p>
                    </div>
                    <div>
                      <span class="bby-review-label">Rewrite results</span>
                      <template v-if="isEditingRow(row)">
                        <textarea
                          v-model="resultDraft"
                          v-autogrow
                          class="bby-input bby-result-edit"
                          rows="1"
                          spellcheck="false"
                          aria-label="Edit this rewrite result by hand"
                          @blur="finishResultEdit"
                          @keydown.esc="finishResultEdit"
                        ></textarea>
                        <div class="bby-result-edit-actions">
                          <button class="bby-text-action" type="button" @mousedown.prevent @click="finishResultEdit">
                            <Icon name="check" /> Done
                          </button>
                          <button
                            v-if="rowEditedResult(row) !== null"
                            class="bby-text-action"
                            type="button"
                            @mousedown.prevent
                            @click="revertResultEdit(row)"
                          >
                            <Icon name="undo" /> Restore AI version
                          </button>
                        </div>
                      </template>
                      <p v-else :class="{ 'bby-deleted-text': row.deleted || displayRowResult(row) === '' }">
                        {{ row.deleted ? row.paragraphs.length > 1 ? `(delete ${row.paragraphs.length} consecutive lines)` : '(delete whole line)' : displayRowResult(row) === '' ? '(clear whole line)' : displayRowResult(row) }}
                      </p>
                    </div>
                  </div>
                  <div class="bby-decide">
                    <button
                      type="button"
                      :class="{ 'is-active': reviewRowDecision(row) === 'reject' }"
                      @click="setReviewRowDecision(row, 'reject')"
                    >
                      {{ row.paragraphs.length > 1 ? 'Discard group' : 'Discard line' }}
                    </button>
                    <button
                      type="button"
                      :class="{ 'is-active': reviewRowDecision(row) === 'accept' }"
                      @click="setReviewRowDecision(row, 'accept')"
                    >
                      {{ row.paragraphs.length > 1 ? 'Apply group' : 'Apply line' }}
                    </button>
                  </div>
                </div>
              </main>

              <section
                v-if="ui.stage === 'annotate' && workMode === 'multi'"
                class="bby-bulk-editor"
                aria-label="Batch annotation request"
              >
                <div class="bby-para-editor-head">
                  <span>{{ multiSelected.length ? `${multiSelected.length} ${multiSelected.length === 1 ? 'paragraph' : 'paragraphs'} selected; enter a shared request` : 'Select paragraphs above first' }}</span>
                </div>
                <PhrasePicker v-if="phrases.length" v-model="bulkPhraseIds" :phrases="phrases" />
                <textarea
                  v-model="bulkNote"
                  class="bby-input bby-note bby-bulk-note"
                  placeholder="Describe how the selected paragraphs should change"
                ></textarea>
              </section>

              <footer class="bby-action-bar">
                <div v-if="ui.stage === 'review' || workMode === 'annotate'" ref="channelMenu" class="bby-channel-menu">
                  <button
                    class="bby-channel-ghost"
                    type="button"
                    :aria-expanded="channelMenuOpen"
                    title="Rewrite channel"
                    @click="toggleChannelMenu"
                  >
                    <Icon name="plug" />
                    <span class="bby-channel-ghost-name">{{ selectedChannelLabel }}</span>
                    <Icon name="chevron" class="bby-channel-ghost-chevron" :class="{ 'is-open': channelMenuOpen }" />
                  </button>
                  <Transition name="bby-menu">
                    <ul v-if="channelMenuOpen" class="bby-menu" role="listbox">
                      <li>
                        <button type="button" :class="{ 'is-active': !selectedChannelId }" @click="pickChannel('')">
                          <Icon name="check" class="bby-menu-check" />
                          <span class="bby-menu-name">Follow main API</span>
                        </button>
                      </li>
                      <li v-for="channel in channels" :key="channel.id">
                        <button type="button" :class="{ 'is-active': selectedChannelId === channel.id }" @click="pickChannel(channel.id)">
                          <Icon name="check" class="bby-menu-check" />
                          <span class="bby-menu-name">{{ channel.name || 'Unnamed channel' }}</span>
                          <span class="bby-menu-model">{{ channel.model || 'No model set' }}</span>
                        </button>
                      </li>
                    </ul>
                  </Transition>
                </div>
                <span v-else></span>
                <div class="bby-action-buttons">
                  <button v-if="generating" class="bby-button" type="button" @click="cancelGeneration">
                    {{ viewingGenerationTarget ? 'Cancel' : `Cancel #${generationTask?.floor}` }}
                  </button>
                  <template v-if="ui.stage === 'annotate'">
                    <template v-if="workMode === 'edit'">
                      <button class="bby-button" type="button" :disabled="saving || replacing" @click="discardManualEdit">
                        <Icon name="undo" /> Discard changes
                      </button>
                      <button
                        class="bby-button bby-primary"
                        type="button"
                        :disabled="saving || replacing || generating || !editDirty"
                        @click="saveManualEdit"
                      >
                        <Icon name="check" /> {{ saving ? 'Saving…' : 'Save to message' }}
                      </button>
                    </template>
                    <template v-else-if="workMode === 'multi'">
                      <button class="bby-button" type="button" @click="cancelMultiSelect">
                        <Icon name="undo" /> Cancel
                      </button>
                      <button
                        class="bby-button bby-primary"
                        type="button"
                        :disabled="!multiSelected.length || !bulkFilled"
                        @click="applyBulkAnnotation"
                      >
                        <Icon name="check" /> Apply to {{ multiSelected.length }} paragraphs
                      </button>
                    </template>
                    <button
                      v-else
                      class="bby-button bby-primary"
                      type="button"
                      :disabled="generating || replacing || !hasInstructions"
                      @click="startReview"
                    >
                      <Icon :name="viewingGenerationTarget ? 'refresh' : 'bolt'" :class="{ 'bby-spin': viewingGenerationTarget }" />
                      {{ generationButtonLabel }}
                    </button>
                  </template>
                  <template v-else>
                    <button class="bby-button" type="button" :disabled="generating || replacing" @click="startReview">
                      <Icon name="refresh" :class="{ 'bby-spin': viewingGenerationTarget }" /> {{ generationButtonLabel }}
                    </button>
                    <button class="bby-button bby-primary" type="button" :disabled="generating || saving || replacing" @click="finishReview">
                      <Icon :name="acceptedCount === 0 ? 'trash' : 'check'" />
                      {{ applyButtonLabel }}
                    </button>
                  </template>
                </div>
              </footer>
            </div>

            <main v-else-if="ui.page === 'floors'" key="floors" class="bby-settings bby-page-shell">
              <header class="bby-settings-page-head">
                <h2>Choose a message</h2>
                <div v-if="floorChatOpen" class="bby-floor-head-actions">
                  <button
                    class="bby-floor-search-toggle"
                    :class="{ 'is-active': floorSearchOpen }"
                    type="button"
                    title="Search messages"
                    @mousedown.prevent
                    @click="toggleFloorSearch"
                  >
                    <Icon name="search" />
                  </button>
                  <label class="bby-floor-user-toggle">
                    <input v-model="penSettings.showUserFloors" type="checkbox" class="bby-checkbox" />
                    <span>Show User messages</span>
                  </label>
                </div>
              </header>
              <div ref="floorPanel" class="bby-floor-scroll">
                <Transition name="bby-expand">
                  <div v-if="floorChatOpen && floorSearchOpen" class="bby-floor-search">
                    <Icon name="search" />
                    <input
                      ref="floorSearchInput"
                      v-model="floorQuery"
                      class="bby-input"
                      type="text"
                      placeholder="Search message number or keyword"
                      @blur="onFloorSearchBlur"
                      @keydown.esc.stop="closeFloorSearch"
                    />
                  </div>
                </Transition>
                <div class="bby-floor-list">
                  <p v-if="!floorChatOpen" class="bby-field-hint">Open a chat first, then choose the message to rewrite.</p>
                  <template v-else>
                    <div
                      v-for="row in pagedFloorRows"
                      :key="row.floor"
                      class="bby-floor-open"
                      :class="{ 'is-user': row.isUser, 'is-hidden': row.hidden }"
                      role="button"
                      tabindex="0"
                      @click="enterFloor(row.floor)"
                      @keydown.enter.prevent="enterFloor(row.floor)"
                    >
                      <span class="bby-floor-main">
                        <span class="bby-floor-tags">
                          <span class="bby-floor-tag bby-floor-tag-num">#{{ row.floor }}</span>
                          <span class="bby-floor-tag bby-floor-role">{{ row.isUser ? 'User' : 'Char' }}</span>
                          <Icon v-if="row.hidden" name="ghost" class="bby-floor-ghost" title="Hidden message (excluded from context)" />
                          <span class="bby-floor-actions">
                            <button
                              class="bby-floor-action"
                              type="button"
                              :title="shootingFloor === row.floor ? 'Capturing…' : 'Screenshot this message'"
                              :disabled="shootingFloor != null"
                              @click.stop="onShootFloor(row.floor)"
                            >
                              <Icon
                                :name="shootingFloor === row.floor ? 'refresh' : 'camera'"
                                :class="{ 'bby-spin': shootingFloor === row.floor }"
                              />
                            </button>
                            <button
                              class="bby-floor-action"
                              type="button"
                              :title="row.hidden ? 'Show message' : 'Hide message'"
                              @click.stop="onToggleFloorHidden(row.floor)"
                            >
                              <Icon :name="row.hidden ? 'eyeOff' : 'eye'" />
                            </button>
                            <button
                              class="bby-floor-action"
                              type="button"
                              title="Delete this message and all after it"
                              @click.stop="onDeleteFloor(row.floor)"
                            >
                              <Icon name="trash" />
                            </button>
                          </span>
                        </span>
                        <small>{{ row.preview }}</small>
                      </span>
                    </div>
                    <p v-if="!floorRows.length" class="bby-field-hint">No messages to rewrite in this chat.</p>
                    <p v-else-if="!visibleFloorRows.length" class="bby-field-hint">No AI messages in this chat.</p>
                    <p v-else-if="!filteredFloorRows.length" class="bby-field-hint">No matching messages.</p>
                  </template>
                </div>
              </div>
              <div v-if="floorChatOpen && floorPageCount > 1" class="bby-floor-pager">
                <span class="bby-floor-pager-info">{{ floorPagerInfo }}</span>
                <div class="bby-floor-pager-buttons">
                  <button class="bby-icon-mini" type="button" title="Previous" :disabled="floorPage === 0" @click="floorPage--">
                    <Icon name="chevronLeft" />
                  </button>
                  <button class="bby-icon-mini" type="button" title="Next" :disabled="floorPage >= floorPageCount - 1" @click="floorPage++">
                    <Icon name="chevronRight" />
                  </button>
                </div>
              </div>
            </main>

            <main v-else key="settings" class="bby-settings bby-page-shell">
              <header class="bby-settings-page-head">
                <h2>Settings</h2>
                <div class="bby-ver-group">
                  <button class="bby-ver" type="button" :disabled="updateState.checking"
                    :title="updateState.checking ? 'Checking for updates' : 'Click to check for updates'"
                    @click="checkForUpdate(true)">
                    v{{ updateState.current || '—' }}
                  </button>
                  <button v-if="updateState.available" class="bby-button bby-primary bby-btn-sm" type="button"
                    :disabled="updateState.updating" :title="`Update to v${updateState.latest}`" @click="openUpdateConfirm">
                    {{ updateState.updating ? 'Updating…' : 'Update' }}
                  </button>
                </div>
              </header>

              <div class="bby-settings-sections">
                <Collapsible title="Basic settings">
                  <label class="bby-modal-field">
                    <span class="bby-modal-label">Default channel</span>
                    <select v-model="penSettings.defaultChannelId" class="bby-input bby-select">
                      <option value="">Follow main API</option>
                      <option v-for="channel in channels" :key="channel.id" :value="channel.id">
                        {{ channel.name }} · {{ channel.model }}
                      </option>
                    </select>
                  </label>
                  <label class="bby-modal-field bby-setting-gap">
                    <span class="bby-modal-label">Default context rounds</span>
                    <input v-model.number="penSettings.defaultContextRounds" class="bby-input" type="number" min="0" max="10" step="1" />
                    <span class="bby-field-hint">Each round includes the previous AI message and the user input right after it.</span>
                  </label>
                  <div class="bby-field bby-setting-gap">
                    <div class="bby-field-head"><span class="bby-modal-label">Theme</span></div>
                    <div class="bby-segmented bby-segmented-wrap">
                      <button
                        v-for="theme in THEMES"
                        :key="theme.value"
                        type="button"
                        class="bby-seg"
                        :class="{ 'is-on': ui.theme === theme.value }"
                        @click="ui.theme = theme.value"
                      >
                        <Icon :name="theme.icon" /> {{ theme.label }}
                      </button>
                    </div>
                  </div>
                </Collapsible>

                <Collapsible title="Secondary API">
                  <div v-if="sharingState.mode === 'legacy-readonly'" class="bby-channel-compat">
                    <p class="bby-field-hint">
                      Old BaiBai-Book version detected{{ sharingState.bookVersion ? ` v${sharingState.bookVersion}` : '' }}. After updating to v1.1.3, both extensions can edit the same channel list.
                    </p>
                    <button class="bby-button bby-primary bby-btn-sm" type="button" @click="requestBookUpdate">
                      <Icon name="refresh" /> Update BaiBai-Book
                    </button>
                  </div>
                  <div class="bby-channel-bar">
                    <span class="bby-field-label">Channels</span>
                    <button class="bby-button bby-primary bby-btn-sm" type="button" :disabled="!canEditChannels()" @click="openChannel()">
                      <Icon name="plus" /> Add channel
                    </button>
                  </div>
                  <ul v-if="channels.length" class="bby-channel-list">
                    <li v-for="channel in channels" :key="channel.id" class="bby-channel-item">
                      <button class="bby-channel-open" type="button" @click="openChannel(channel)">
                        <span class="bby-channel-name">{{ channel.name || 'Unnamed channel' }}</span>
                        <span class="bby-channel-model">{{ channel.model || 'No model set' }}</span>
                      </button>
                    </li>
                  </ul>
                  <p v-else-if="!sharingState.ready" class="bby-field-hint">Loading channels…</p>
                  <p v-else class="bby-field-hint">No channels yet. Add a secondary API, or just follow the main API.</p>
                </Collapsible>

                <Collapsible title="Quick phrases">
                  <div class="bby-section-action">
                    <span class="bby-field-label">Annotation templates</span>
                    <button class="bby-button bby-primary bby-btn-sm" type="button" @click="openPhrase()">
                      <Icon name="plus" /> Add phrase
                    </button>
                  </div>
                  <div v-if="phrases.length" class="bby-phrase-list">
                    <button v-for="phrase in phrases" :key="phrase.id" type="button" @click="openPhrase(phrase)">
                      <span class="bby-phrase-favorite" :class="{ 'is-on': phrase.favorite }">★</span>
                      <span>
                        <strong>{{ phrase.name }}</strong>
                        <small>{{ phrase.instruction }}</small>
                      </span>
                      <Icon name="chevron" />
                    </button>
                  </div>
                  <p v-else class="bby-field-hint">No quick phrases yet.</p>
                </Collapsible>

                <Collapsible title="Custom prompts">
                  <ul class="bby-prompt-list">
                    <li v-for="meta in PROMPT_METAS" :key="meta.key" class="bby-prompt-item">
                      <button class="bby-prompt-open" type="button" @click="openPrompt(meta)">
                        <span class="bby-prompt-name">{{ meta.label }}</span>
                        <span class="bby-prompt-state" :class="{ 'is-custom': isCustomPrompt(meta.key) }">
                          {{ isCustomPrompt(meta.key) ? 'Customized' : 'Default' }}
                        </span>
                        <Icon name="pen" class="bby-prompt-edit" />
                      </button>
                    </li>
                  </ul>
                </Collapsible>
              </div>
            </main>
          </Transition>
          </div>

          <nav class="bby-mobile-nav" aria-label="Mobile navigation">
            <button :class="{ 'is-active': ui.page === 'floors' }" type="button" title="Messages" aria-label="Messages" @click="onMobileNavClick('floors')">
              <Icon name="list" />
            </button>
            <button :class="{ 'is-active': ui.page === 'workspace' }" type="button" :disabled="ui.floor == null" title="Workbench" aria-label="Workbench" @click="onMobileNavClick('workspace')">
              <Icon name="workspace" />
            </button>
            <button :class="{ 'is-active': ui.page === 'settings' }" type="button" title="Settings" aria-label="Settings" @click="onMobileNavClick('settings')">
              <Icon name="settings" />
              <span v-if="updateState.available" class="bby-nav-dot" aria-label="Update available"></span>
            </button>
          </nav>
        </section>
      </div>
    </Transition>

    <ModalMask :open="!!channelDraft" @close="channelDraft = null">
      <div v-if="channelDraft" class="bby-modal" role="dialog" aria-modal="true" aria-label="Edit channel">
        <header class="bby-modal-head">
          <span class="bby-modal-title">Edit channel</span>
          <button class="bby-icon-mini" type="button" title="Close" @click="channelDraft = null"><Icon name="close" /></button>
        </header>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Channel name</span>
          <input v-model="channelDraft.name" class="bby-input" placeholder="Channel name" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">API URL</span>
          <input v-model="channelDraft.url" class="bby-input" placeholder="e.g. https://api.openai.com/v1" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">API key</span>
          <div class="bby-model-row">
            <input v-model="channelDraft.key" class="bby-input" :type="showKey ? 'text' : 'password'" placeholder="API key" />
            <button class="bby-icon-mini" type="button" :title="showKey ? 'Hide key' : 'Show key'" @click="showKey = !showKey">
              <Icon :name="showKey ? 'eyeOff' : 'eye'" />
            </button>
          </div>
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Model</span>
          <div class="bby-model-row">
            <div class="bby-combo">
              <input
                v-model="channelDraft.model"
                class="bby-input"
                :placeholder="modelOptions.length ? 'Search or enter a model name…' : 'Model name, e.g. gpt-4o-mini'"
                @focus="openModelMenu"
                @input="modelQuery = channelDraft.model; modelMenuOpen = true"
                @blur="closeModelMenuSoon"
              />
              <span
                v-if="modelOptions.length"
                class="bby-combo-caret"
                :class="{ 'is-open': modelMenuOpen }"
                aria-hidden="true"
              />
              <ul v-if="modelMenuOpen && modelOptions.length" class="bby-combo-menu">
                <li v-if="!filteredModelOptions.length" class="bby-combo-empty">No matching models</li>
                <li
                  v-for="model in filteredModelOptions"
                  :key="model"
                  class="bby-combo-item"
                  :class="{ 'is-active': model === channelDraft.model }"
                  @mousedown.prevent="pickModel(model)"
                >
                  {{ model }}
                </li>
              </ul>
            </div>
            <button
              class="bby-icon-mini"
              type="button"
              :title="loadingModels ? 'Fetching…' : 'Fetch models'"
              :disabled="loadingModels"
              @click="loadModels"
            >
              <Icon name="refresh" :class="{ 'bby-spin': loadingModels }" />
            </button>
          </div>
        </label>
        <div class="bby-channel-row">
          <label class="bby-mini-field">
            <span>Temperature</span>
            <input v-model.number="channelDraft.temperature" class="bby-input" type="number" step="0.1" min="0" max="2" />
          </label>
          <label class="bby-mini-field">
            <span>Max tokens</span>
            <input v-model.number="channelDraft.maxTokens" class="bby-input" type="number" step="256" min="256" />
          </label>
          <label class="bby-mini-field">
            <span>Timeout (seconds)</span>
            <input v-model.number="channelDraft.timeoutSec" class="bby-input" type="number" step="10" min="1" />
          </label>
          <!-- 思考强度：自绘下拉（跟随主题；原生 select 的弹出层由系统渲染，主题管不到）。
               auto 是显式选项，值为空串 = 不发送该参数 -->
          <div class="bby-mini-field">
            <span>Reasoning effort</span>
            <BbySelect
              v-model="channelDraft.reasoningEffort"
              :options="REASONING_EFFORT_OPTIONS"
              aria-label="Reasoning effort"
            />
          </div>
        </div>
        <span class="bby-field-hint">If unsure, choose auto; max is recommended for DeepSeek models</span>
        <label class="bby-switch-row">
          <span class="bby-modal-label">Streaming</span>
          <input v-model="channelDraft.stream" type="checkbox" class="bby-checkbox" />
        </label>
        <label class="bby-switch-row">
          <span class="bby-modal-label">Send prefill</span>
          <input v-model="channelDraft.prefill" type="checkbox" class="bby-checkbox" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Excluded parameters</span>
          <input v-model="excludeParamsText" class="bby-input" placeholder="Comma-separated, e.g. temperature, max_tokens" />
        </label>
        <p v-if="testMessage" class="bby-channel-test">{{ testMessage }}</p>
        <footer class="bby-modal-foot">
          <button class="bby-button bby-danger" type="button" @click="removeChannel"><Icon name="trash" /> Delete</button>
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button" type="button" @click="testChannel"><Icon name="plug" /> Test channel</button>
          <button class="bby-button bby-primary" type="button" @click="saveChannel">Done</button>
        </footer>
      </div>
    </ModalMask>

    <ModalMask :open="bookUpdatePromptOpen" @close="bookUpdatePromptOpen = false">
      <div class="bby-modal" role="dialog" aria-modal="true" aria-label="Update BaiBai-Book">
        <header class="bby-modal-head">
          <span class="bby-modal-title">Update BaiBai-Book</span>
          <button class="bby-icon-mini" type="button" title="Close" @click="bookUpdatePromptOpen = false"><Icon name="close" /></button>
        </header>
        <p class="bby-field-hint">
          Current BaiBai-Book{{ sharingState.bookVersion ? ` version is v${sharingState.bookVersion}` : ' version cannot be determined' }}. Update to v1.1.3 to share and edit channels live with BaiBai Inkwell. The page reloads automatically after the update, and existing channels are migrated automatically.
        </p>
        <p v-if="sharingState.updateError" class="bby-channel-test">Update failed:{{ sharingState.updateError }}</p>
        <footer class="bby-modal-foot">
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button" type="button" :disabled="sharingState.updating" @click="bookUpdatePromptOpen = false">Not now</button>
          <button class="bby-button bby-primary" type="button" :disabled="sharingState.updating" @click="performBookUpdate">
            <Icon name="refresh" /> {{ sharingState.updating ? 'Updating…' : 'Update and reload' }}
          </button>
        </footer>
      </div>
    </ModalMask>

    <ModalMask :open="updateConfirmOpen" @close="updateConfirmOpen = false">
      <div class="bby-modal" role="dialog" aria-modal="true" aria-label="New version available">
        <header class="bby-modal-head">
          <span class="bby-modal-title">New version available</span>
          <button class="bby-icon-mini" type="button" title="Close" @click="updateConfirmOpen = false"><Icon name="close" /></button>
        </header>
        <p class="bby-field-hint">
          Current version v{{ updateState.current || '—' }}, latest version v{{ updateState.latest }}. Update now? The page reloads automatically after the update.
        </p>
        <footer class="bby-modal-foot">
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button" type="button" :disabled="updateState.updating" @click="updateConfirmOpen = false">Not now</button>
          <button class="bby-button bby-primary" type="button" :disabled="updateState.updating" @click="confirmUpdate">
            <Icon name="refresh" /> {{ updateState.updating ? 'Updating…' : 'Update and reload' }}
          </button>
        </footer>
      </div>
    </ModalMask>

    <ModalMask :open="!!phraseDraft" @close="phraseDraft = null">
      <div v-if="phraseDraft" class="bby-modal" role="dialog" aria-modal="true" aria-label="Edit quick phrase">
        <header class="bby-modal-head">
          <span class="bby-modal-title">Edit quick phrase</span>
          <button class="bby-icon-mini" type="button" title="Close" @click="phraseDraft = null"><Icon name="close" /></button>
        </header>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Name</span>
          <input v-model="phraseDraft.name" class="bby-input" placeholder="e.g. Stronger emotion" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Instruction</span>
          <textarea v-model="phraseDraft.instruction" class="bby-input bby-phrase-area"></textarea>
        </label>
        <label class="bby-switch-row">
          <span class="bby-modal-label">Pin to top</span>
          <input v-model="phraseDraft.favorite" type="checkbox" class="bby-checkbox" />
        </label>
        <footer class="bby-modal-foot">
          <button class="bby-button bby-danger" type="button" @click="removePhrase"><Icon name="trash" /> Delete</button>
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button bby-primary" type="button" @click="savePhrase">Done</button>
        </footer>
      </div>
    </ModalMask>

    <ModalMask :open="!!ruleDraft" @close="ruleDraft = null">
      <div v-if="ruleDraft" class="bby-modal" role="dialog" aria-modal="true" aria-label="Edit replacement rule">
        <header class="bby-modal-head">
          <span class="bby-modal-title">Edit replacement rule</span>
          <button class="bby-icon-mini" type="button" title="Close" @click="ruleDraft = null"><Icon name="close" /></button>
        </header>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Rule name</span>
          <input v-model="ruleDraft.name" class="bby-input" placeholder="e.g. Unify character name" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Match</span>
          <input v-model="ruleDraft.pattern" class="bby-input bby-mono" placeholder="Text, regex or /pattern/gi" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">Replace with</span>
          <input v-model="ruleDraft.replacement" class="bby-input bby-mono" placeholder="Leave empty to delete the match" />
        </label>
        <label class="bby-switch-row">
          <span class="bby-modal-label">Use regular expression</span>
          <input v-model="ruleDraft.isRegex" type="checkbox" class="bby-checkbox" />
        </label>
        <p v-if="ruleDraft.isRegex" class="bby-field-hint">Plain expressions or /expression/gi are supported; all matches are replaced, and $1, $2 refer to capture groups.</p>
        <footer class="bby-modal-foot">
          <button class="bby-button bby-danger" type="button" @click="removeRule"><Icon name="trash" /> Delete</button>
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button bby-primary" type="button" @click="saveRule">Done</button>
        </footer>
      </div>
    </ModalMask>

    <ModalMask :open="!!editingPrompt" @close="closePrompt">
      <div v-if="editingPrompt" class="bby-modal bby-modal-wide" role="dialog" aria-modal="true" :aria-label="`Edit ${editingPrompt.label}`">
        <header class="bby-modal-head">
          <span class="bby-modal-title">Edit{{ editingPrompt.label }}</span>
          <button class="bby-icon-mini" type="button" title="Close" @click="closePrompt"><Icon name="close" /></button>
        </header>
        <p class="bby-field-hint">{{ editingPrompt.hint }}</p>
        <textarea
          v-model="promptDraft"
          class="bby-input bby-prompt-area"
          spellcheck="false"
          rows="16"
        ></textarea>
        <footer class="bby-modal-foot">
          <button class="bby-button bby-danger" type="button" @click="resetPrompt">
            <Icon name="refresh" /> Restore default
          </button>
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button" type="button" @click="closePrompt">Cancel</button>
          <button class="bby-button bby-primary" type="button" @click="savePrompt">Done</button>
        </footer>
      </div>
    </ModalMask>

    <Transition name="bby-toast">
      <div v-if="toastText" class="bby-toast">{{ toastText }}</div>
    </Transition>
  </div>
</template>
