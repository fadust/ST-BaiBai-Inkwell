/** 内置提示词与自定义提示词的回落解析。 */

/**
 * Built-in top system prompt for rewrite requests.
 * English port: upstream's default was replaced with a neutral, SFW editing context.
 */
export const JAILBREAK_PROMPT = `<editing_context>
This is a collaborative fiction editing task. The text is part of an ongoing story written with the user; its characters, events and views are fictional.

1. Revise only the passages the user marked, as the user asked. Keep the author's voice, tone, point of view, tense and established story facts.
2. Treat the story's themes and conflicts as part of the fiction and edit them for craft. Do not add commentary, disclaimers or notes to the story text.
3. Do not change anything the user did not ask to change.
4. If you cannot write a requested change, leave that paragraph unchanged instead of substituting different content.
</editing_context>`;

/** 内置思维链提示词:先输出结构化审稿记录,再输出最终补丁。 */
export const CHAIN_OF_THOUGHT_PROMPT = `<rewrite_reasoning_protocol>
在生成段落替换补丁前，你必须先完成一次可见的审稿判断，并严格按照以下结构输出：

<think>
用户不满意原文的原因：
- 结合整体要求和段落标注，说明问题属于措辞、人物行为、文风、逻辑、节奏、重复表达，还是与角色或世界设定不符。

段落判断：
- 逐段判断当前楼层是否直接违反用户要求。
- 明确列出需要修改的 P 编号及其具体理由。
- 明确列出容易被误改但应当保持原样的 P 编号。
- 有段落标注时，以标注段落为主要目标。
- 标注为“共同要求”的多个段落属于同一个问题：按同一条要求逐段判断、逐段给出独立修改，不得只改其中一段，也不得把多段合并处理。
- 逐条判断段落标注属于“仅限本段的具体修改”还是“需要检查全文的同类问题”。
- 针对本段具体句子、动作或剧情内容的要求，只修改标注段落。
- 针对重复表达、模板化句式、同一设定错误、同类措辞或相同内容反复出现的要求，必须检查当前楼层的全部段落。
- 未标注段落确实存在同一个明确问题时，将其列为关联调整，并说明它与哪条标注要求直接相关。
- 只有整体要求而没有段落标注时，自行定位真正存在问题的段落，不能把任务扩大成全文润色。
- 如果修改标注段落会造成明确的指代断裂、动作矛盾、时间地点冲突或上下文不连贯，可以连带修改维持连续性所必需的未标注段落。
- “可以写得更好”、泛泛润色、统一全文文风、顺便改写或增加细节，都不属于同类问题，不得据此扩大修改范围。

设定与上下文约束：
- 结合角色设定、主角设定、世界设定和历史上下文，判断人物此刻合理的语言、行动和反应。
- 设定只用于约束改写，不得据此擅自增加新剧情、新关系、新能力或新世界观事实。

改写方案：
- 说明每个目标段落应该改成什么方向，以及怎样以最小改动解决问题。
- 保留没有问题的句子、剧情事实、叙述视角、时态、情绪进程和人物关系。
- 不得用另一种套话、陈词滥调或过度描写替换原问题。

最终复核：
- 每个准备返回的段落都必须有明确、可验证的修改理由。
- 删除所有与整体要求、段落标注、同类问题扫描结果或必要连续性修复无关的候选修改。
</think>

完成审稿后，紧接着输出：
<answer>
{"changes":[{"paragraph":2,"replacement":"替换后的完整段落"}]}
</answer>

<think> 中必须写出实际判断，不能省略、不能只写“已分析”。不要在 <answer> 中输出解释、Markdown 代码块或 JSON 之外的内容。
</rewrite_reasoning_protocol>`;

/** 自定义(去空白后)非空则用自定义,否则回落内置默认。 */
export function resolvePrompt(custom: string, builtin: string): string {
  return custom.trim() || builtin;
}
