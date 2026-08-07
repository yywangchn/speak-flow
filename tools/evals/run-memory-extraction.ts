import dataset from './memory-extraction.dataset.json';
import {
  type ExtractedMemory,
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  parseExtractedMemories,
} from '../../apps/speak-flow/src/memory-extraction';

type EvaluationCase = {
  id: string;
  input: string;
  expectedKeys: string[];
  expectedContent?: Record<string, string[]>;
  sensitive?: boolean;
};

const apiKey = process.env['DEEPSEEK_API_KEY'];
if (!apiKey)
  throw new Error('DEEPSEEK_API_KEY is required to run memory evaluation.');

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let parseFailures = 0;
  let passed = 0;
  let sensitivePassed = 0;
  let sensitiveTotal = 0;
  let totalLatency = 0;

  for (const testCase of dataset as EvaluationCase[]) {
    const startedAt = performance.now();
    let actualMemories: ExtractedMemory[] = [];
    let error: unknown;
    try {
      actualMemories = await extractMemories(testCase.input);
    } catch (value) {
      error = value;
      parseFailures += 1;
    }
    totalLatency += performance.now() - startedAt;

    const expected = new Set(testCase.expectedKeys);
    const actualKeys = actualMemories.map(({ key }) => key);
    const actual = new Set(actualKeys);
    const keysAreUnique = actual.size === actualKeys.length;
    truePositives += [...actual].filter((key) => expected.has(key)).length;
    falsePositives += [...actual].filter((key) => !expected.has(key)).length;
    falseNegatives += [...expected].filter((key) => !actual.has(key)).length;

    const contentMatches = memoriesMatchExpectedContent(
      actualMemories,
      testCase.expectedContent ?? {},
    );
    const categoriesMatch = actualMemories.every(
      ({ key, category }) => key.split('.')[0] === category,
    );
    const isPass =
      !error &&
      setsEqual(expected, actual) &&
      keysAreUnique &&
      contentMatches &&
      categoriesMatch;
    if (isPass) passed += 1;
    if (testCase.sensitive) {
      sensitiveTotal += 1;
      if (!error && !actual.size) sensitivePassed += 1;
    }

    console.log(`${isPass ? 'PASS' : 'FAIL'} ${testCase.id}`);
    if (!isPass) {
      console.log(`  expected: ${JSON.stringify([...expected])}`);
      console.log(`  actual:   ${JSON.stringify([...actual])}`);
      if (!contentMatches)
        console.log(
          '  content:  extracted content did not match expected values',
        );
      if (!categoriesMatch)
        console.log('  category: did not match the memory key namespace');
      if (!keysAreUnique)
        console.log('  keys:     duplicate memory keys returned');
      if (error)
        console.log(
          `  error:    ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }

  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  console.log('\nResults');
  console.log(
    `Passed: ${passed}/${dataset.length} (${percentage(passed / dataset.length)})`,
  );
  console.log(`Key precision: ${percentage(precision)}`);
  console.log(`Key recall: ${percentage(recall)}`);
  console.log(
    `Sensitive rejection: ${sensitivePassed}/${sensitiveTotal} (${percentage(ratio(sensitivePassed, sensitiveTotal))})`,
  );
  console.log(`JSON/request failures: ${parseFailures}`);
  console.log(
    `Average latency: ${Math.round(totalLatency / dataset.length)}ms`,
  );

  process.exitCode = passed === dataset.length ? 0 : 1;
}

async function extractMemories(input: string): Promise<ExtractedMemory[]> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      stream: false,
      messages: [
        { role: 'system', content: MEMORY_EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`DeepSeek returned ${response.status}`);
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = result.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('DeepSeek returned no extraction content.');
  return parseExtractedMemories(raw);
}

function memoriesMatchExpectedContent(
  memories: readonly ExtractedMemory[],
  expectedContent: Readonly<Record<string, readonly string[]>>,
): boolean {
  return Object.entries(expectedContent).every(([key, fragments]) => {
    const content = memories.find((memory) => memory.key === key)?.content;
    return (
      typeof content === 'string' &&
      fragments.every((fragment) =>
        content.toLowerCase().includes(fragment.toLowerCase()),
      )
    );
  });
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 1;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
