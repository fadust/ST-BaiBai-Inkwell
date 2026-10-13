// Exact historical defaults: only untouched built-ins may be migrated.
import type { QuickPhrase } from '@/api/settings';

export const LEGACY_QUICK_PHRASES: readonly QuickPhrase[] = [
  {
    id: 1,
    name: '吃点别的',
    instruction: '吃点别的东西，不要老吃这个',
    favorite: false,
  },
  {
    id: 2,
    name: '禁慢点吃',
    instruction: '不要出现“慢点吃，没人跟你抢”之类的句式',
    favorite: false,
  },
  {
    id: 3,
    name: '别老吃饭',
    instruction: '角色没有这么爱吃饭，不要老是提起吃饭',
    favorite: false,
  },
  {
    id: 4,
    name: '禁老子',
    instruction: '不要使用老子自称',
    favorite: false,
  },
  {
    id: 5,
    name: '禁投石',
    instruction: '不要出现石子投入湖面这样的描写，包括其变体也不要',
    favorite: false,
  },
  {
    id: 6,
    name: '禁不是而是',
    instruction: '不要使用“不是而是”的句式',
    favorite: false,
  },
  {
    id: 7,
    name: '禁发白衬衫和军靴',
    instruction: '不要写衣服写得发白，换一个，也不要穿军靴',
    favorite: false,
  },
  {
    id: 8,
    name: '禁不容置疑等',
    instruction: '不要出现不容置疑，掌控欲，占有欲，野兽，低吼，猎物猎手等词',
    favorite: false,
  },
  {
    id: 9,
    name: '别做完就睡',
    instruction: '不要性爱之后马上睡觉，除了睡觉还有很多事情可以做',
    favorite: false,
  },
  {
    id: 10,
    name: '禁绝望',
    instruction: '不要动不动就崩溃绝望，角色的心理没有这么脆弱',
    favorite: false,
  },
];

export const LEGACY_REVIEW_PROMPT = "<rewrite_reasoning_protocol>\r\n在生成段落替换补丁前，你必须先完成一次可见的审稿判断，并严格按照以下结构输出：\r\n\r\n<think>\r\n用户不满意原文的原因：\r\n- 结合整体要求和段落标注，说明问题属于措辞、人物行为、文风、逻辑、节奏、重复表达，还是与角色或世界设定不符。\r\n\r\n段落判断：\r\n- 逐段判断当前楼层是否直接违反用户要求。\r\n- 明确列出需要修改的 P 编号及其具体理由。\r\n- 明确列出容易被误改但应当保持原样的 P 编号。\r\n- 有段落标注时，以标注段落为主要目标。\r\n- 标注为“共同要求”的多个段落属于同一个问题：按同一条要求逐段判断、逐段给出独立修改，不得只改其中一段，也不得把多段合并处理。\r\n- 逐条判断段落标注属于“仅限本段的具体修改”还是“需要检查全文的同类问题”。\r\n- 针对本段具体句子、动作或剧情内容的要求，只修改标注段落。\r\n- 针对重复表达、模板化句式、同一设定错误、同类措辞或相同内容反复出现的要求，必须检查当前楼层的全部段落。\r\n- 未标注段落确实存在同一个明确问题时，将其列为关联调整，并说明它与哪条标注要求直接相关。\r\n- 只有整体要求而没有段落标注时，自行定位真正存在问题的段落，不能把任务扩大成全文润色。\r\n- 如果修改标注段落会造成明确的指代断裂、动作矛盾、时间地点冲突或上下文不连贯，可以连带修改维持连续性所必需的未标注段落。\r\n- “可以写得更好”、泛泛润色、统一全文文风、顺便改写或增加细节，都不属于同类问题，不得据此扩大修改范围。\r\n\r\n设定与上下文约束：\r\n- 结合角色设定、主角设定、世界设定和历史上下文，判断人物此刻合理的语言、行动和反应。\r\n- 设定只用于约束改写，不得据此擅自增加新剧情、新关系、新能力或新世界观事实。\r\n\r\n改写方案：\r\n- 说明每个目标段落应该改成什么方向，以及怎样以最小改动解决问题。\r\n- 保留没有问题的句子、剧情事实、叙述视角、时态、情绪进程和人物关系。\r\n- 不得用另一种套话、陈词滥调或过度描写替换原问题。\r\n\r\n最终复核：\r\n- 每个准备返回的段落都必须有明确、可验证的修改理由。\r\n- 删除所有与整体要求、段落标注、同类问题扫描结果或必要连续性修复无关的候选修改。\r\n</think>\r\n\r\n完成审稿后，紧接着输出：\r\n<answer>\r\n{\"changes\":[{\"paragraph\":2,\"replacement\":\"替换后的完整段落\"}]}\r\n</answer>\r\n\r\n<think> 中必须写出实际判断，不能省略、不能只写“已分析”。不要在 <answer> 中输出解释、Markdown 代码块或 JSON 之外的内容。\r\n</rewrite_reasoning_protocol>";
export const LEGACY_SYSTEM_PROMPT = "<editing_context>\r\nThis is a collaborative fiction editing task. The text is part of an ongoing story written with the user; its characters, events and views are fictional.\r\n\r\n1. Revise only the passages the user marked, as the user asked. Keep the author's voice, tone, point of view, tense and established story facts.\r\n2. Treat the story's themes and conflicts as part of the fiction and edit them for craft. Do not add commentary, disclaimers or notes to the story text.\r\n3. Do not change anything the user did not ask to change.\r\n4. If you cannot write a requested change, leave that paragraph unchanged instead of substituting different content.\r\n</editing_context>";
