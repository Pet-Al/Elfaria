import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from '../src/config.js';
import { createDriver } from '../src/db/driver.js';
import { logger } from '../src/lib/logger.js';
import { buildSessions } from '../src/ml/dataset.js';
import type { ModelArtifact } from '../src/ml/recommender.js';
import { trainSgns } from '../src/ml/sgns.js';

/**
 * Offline trainer for the item2vec recommender (doc roadmap #6).
 *
 *   npm run train
 *
 * Reads the accumulated play events, slices them into listening sessions, trains
 * SGNS embeddings, and writes the artifact to RECOMMENDER_MODEL_PATH (default
 * ./data/recommender.json). The running bot loads that file on boot (and you can
 * re-run this on a schedule — e.g. a nightly CronJob — to keep it fresh).
 *
 * Vectors are rounded to 5 dp to keep the artifact compact without meaningfully
 * affecting cosine similarity.
 */

const ROUND = 1e5;

async function main(): Promise<void> {
  const db = await createDriver();
  await db.migrate();

  const { sessions, meta } = await buildSessions();
  logger.info(
    { sessions: sessions.length, tracks: meta.size },
    'built training sessions from play events',
  );

  if (sessions.length < 2) {
    logger.warn(
      'Not enough listening history to train yet (need at least a couple of ' +
        'multi-track sessions). Let the bot run and collect plays, then re-run.',
    );
    await db.close();
    process.exit(0);
  }

  const model = trainSgns(sessions, { minCount: 2 });
  if (model.vectors.size === 0) {
    logger.warn('No tracks met the minimum play count — nothing to write yet.');
    await db.close();
    process.exit(0);
  }

  const vectors: Record<string, number[]> = {};
  const metaOut: ModelArtifact['meta'] = {};
  for (const [uri, vec] of model.vectors) {
    vectors[uri] = Array.from(vec, (x) => Math.round(x * ROUND) / ROUND);
    const m = meta.get(uri);
    if (m) metaOut[uri] = m;
  }

  const artifact: ModelArtifact = {
    version: 1,
    dim: model.dim,
    trainedAt: new Date().toISOString(),
    count: model.vectors.size,
    vectors,
    meta: metaOut,
  };

  const path = resolve(config.recommender.modelPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(artifact));
  logger.info({ path, tracks: artifact.count, dim: artifact.dim }, 'wrote recommender model');

  await db.close();
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'recommender training failed');
  process.exit(1);
});
