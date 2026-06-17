import { callLLM, MODELS } from './ai';

const SYSTEM = `You are the synthesizer for the Distillery Labs Ideation Club. You receive an array of captured ideas (JSON) from one session, each with its lane and its parent (lineage).

Produce a clean markdown harvest:
- GROUP by lane.
- Within each lane, show parents first, then nest the ideas they spawned beneath them (preserve lineage with indentation: "    ↳ child idea").
- Surface CROSS-LANE THREADS: where ideas in different lanes rhyme or connect, call them out in a short closing section "Threads worth pulling."
- Lead with a one-line headline: how many ideas, how many lanes, the single most generative thread of the night.
- Plain, warm, momentum-building language. This doc is what we show art champions and the community to recruit them — make it feel alive, not like minutes.

Output a clean markdown document. No preamble outside the doc itself.`;

export type IdeaForHarvest = {
  id: string;
  text: string;
  lane: string;
  parent_text: string | null;
  prior_art: string | null;
  branch: string | null;
};

export async function generateHarvest(ideas: IdeaForHarvest[]): Promise<string> {
  const raw = await callLLM({
    system: SYSTEM,
    user: JSON.stringify(ideas),
    model: MODELS.harvest,
    temperature: 0.6,
    maxTokens: 2000,
  });
  return raw.trim();
}
