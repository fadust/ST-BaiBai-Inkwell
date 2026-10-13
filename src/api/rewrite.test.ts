import { describe, expect, it } from 'vitest';

import { formatAnnotations, parseChanges } from '@/api/rewrite';
import { CHAIN_OF_THOUGHT_PROMPT } from '@/api/prompts';

describe('formatAnnotations', () => {
  it('groups paragraphs sharing identical instructions into one common-requirement block', () => {
    const text = formatAnnotations([
      { paragraph: 3, text: '甲段', instructions: ['对话改自然一些'] },
      { paragraph: 5, text: '乙段', instructions: ['对话改自然一些'] },
      { paragraph: 8, text: '丙段', instructions: ['删掉环境描写'] },
    ]);

    expect(text).toContain('Paragraphs 3, 5 (shared requirements):');
    expect(text).toContain('Paragraph 3 original: 甲段');
    expect(text).toContain('Paragraph 5 original: 乙段');
    expect(text).toContain('Paragraph 8:\nOriginal: 丙段');
    // 共同要求只出现一次,不逐段重复
    expect(text.match(/对话改自然一些/g)).toHaveLength(1);
  });

  it('keeps solo annotations in the original single-paragraph format', () => {
    const text = formatAnnotations([
      { paragraph: 2, text: '原句', instructions: ['加强情绪', '保留比喻'] },
    ]);

    expect(text).toBe('Paragraph 2:\nOriginal: 原句\nRequirements:\n  - 加强情绪\n  - 保留比喻');
  });

  it('does not merge paragraphs whose instruction sets differ', () => {
    const text = formatAnnotations([
      { paragraph: 1, text: '甲', instructions: ['要求A'] },
      { paragraph: 2, text: '乙', instructions: ['要求A', '要求B'] },
    ]);

    expect(text).not.toContain('shared requirements');
    expect(text).toContain('Paragraph 1:');
    expect(text).toContain('Paragraph 2:');
  });
});

describe('parseChanges', () => {
  it('repairs a missing closing quote in a replacement string', () => {
    const originalText = Array.from({ length: 42 }, (_, index) => `原段落 ${index + 1}`).join(
      '\n\n',
    );
    const raw =
      '{"changes":[{"paragraph":42,"replacement":"“车里有早报。”他把钥匙揣进花衬衫宽大的口袋里，手指在门框上敲了两下，“你要是能在太平山绕完两个弯之前走到车里，晚上那顿潮州打冷，算我的。”}]}';

    expect(parseChanges(raw, originalText)).toEqual([
      {
        paragraph: 42,
        replacement:
          '“车里有早报。”他把钥匙揣进花衬衫宽大的口袋里，手指在门框上敲了两下，“你要是能在太平山绕完两个弯之前走到车里，晚上那顿潮州打冷，算我的。”',
      },
    ]);
  });

  it('still rejects repaired JSON without a string replacement', () => {
    const raw = '{"changes":[{"paragraph":1,"replacement":123,}]}';

    expect(() => parseChanges(raw, '原段落')).toThrow('The AI returned no valid paragraph changes');
  });

  it('rejects a replacement containing a line break', () => {
    const raw = '{"changes":[{"paragraph":1,"replacement":"第一行\\n第二行"}]}';

    expect(() => parseChanges(raw, '原段落')).toThrow('The AI returned no valid paragraph changes');
  });

  it('extracts JSON from answer tags without reading braces in the think block', () => {
    const raw = `<think>
候选判断：P1 的原句包含 {不应被当作 JSON 的内容}，需要按整体要求修改。
</think>
<answer>
{"changes":[{"paragraph":1,"replacement":"修改后的段落"}]}
</answer>`;

    expect(parseChanges(raw, '原段落')).toEqual([
      {
        paragraph: 1,
        replacement: '修改后的段落',
      },
    ]);
  });
});

describe('default reasoning prompt', () => {
  it('requires a visible review and an answer-wrapped patch', () => {
    expect(CHAIN_OF_THOUGHT_PROMPT).toContain('<think>');
    expect(CHAIN_OF_THOUGHT_PROMPT).toContain('may look tempting to edit but must remain unchanged');
    expect(CHAIN_OF_THOUGHT_PROMPT).toContain('<answer>');
  });
});
